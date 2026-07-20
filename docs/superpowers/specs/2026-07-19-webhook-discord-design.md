# Webhook do Discord — Design

**Data:** 2026-07-19

**Origem:** item 6 do `docs/ROADMAP.md` ("esforço mínimo, valor social enorme").

## Objetivo

Quando o Coletor processa uma partida nova, postar automaticamente um resumo no canal
do Discord de cada grupo com membro na partida — placar do ponto de vista do grupo,
MVP do grupo, mapa e link pra abrir a partida no Resenha. Reforça o hábito de olhar o
site logo depois de jogar, sem precisar entrar manualmente pra ver o resultado.

## Escopo

**Dentro:** disparo automático a partir do fluxo principal de ingestão (`cmd_fetch` no
Coletor), configuração do webhook por grupo (admin, via UI), idempotência (não duplica
aviso em reprocessamento), tolerância a falha (POST pro Discord nunca derruba o ingest).

**Fora (v1):** Partidas Pro e uploads manuais não disparam webhook ainda (podem ser
adicionados depois seguindo o mesmo padrão). Sem retry automático se o POST falhar —
só loga; se quiser reenviar, precisa reprocessar a partida manualmente.

## Modelo de dados

### `groups.discord_webhook_url` (nova coluna)

```sql
alter table groups add column discord_webhook_url text;
```

Nullable. Grupo sem valor configurado não recebe nenhum aviso (skip silencioso).

### `discord_notifications` (nova tabela)

```sql
create table discord_notifications (
  match_id uuid not null references matches(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (match_id, group_id)
);
```

Uma linha por (partida, grupo) já notificado — chave primária composta garante que não
duplica. Antes de mandar o webhook, o Coletor verifica se a linha já existe; se sim, pula.

## Fluxo (Coletor, Python)

Em `cmd_fetch`, logo depois que `ingest_demo` devolve o `match_id` com sucesso:

1. **Descobrir grupos com membro na partida** — mesma lógica de "visibilidade por
   participação" já usada no servidor (`matchVisibility.js`), replicada em SQL no
   Coletor: `select distinct gm.group_id from group_members gm join match_players mp
   on mp.steam_id64 = gm.steam_id64 where mp.match_id = %s`.
2. Pra cada `group_id` encontrado:
   a. Busca `discord_webhook_url` do grupo. Se nulo, **pula** (sem log de erro — é
      esperado que nem todo grupo configure).
   b. Verifica em `discord_notifications` se `(match_id, group_id)` já existe. Se sim,
      **pula** (já notificado, provavelmente reprocessamento).
   c. Calcula o **placar do ponto de vista do grupo**: entre os `match_players` da
      partida cujo `steam_id64` está em `group_members` daquele grupo, acha o `team`
      majoritário (empate 50/50 impossível em 5v5 real, mas se acontecer usa o time do
      primeiro membro por ordem de steam_id64 — caso extremo, não trava o fluxo).
      Score do grupo = `score_a`/`score_b` correspondente a esse time; resultado
      (vitória/derrota/empate) por comparação dos dois placares.
   d. Calcula o **MVP do grupo**: maior `rating` entre os `match_players` daquele grupo
      nessa partida (não o MVP geral da partida).
   e. Monta o embed do Discord (ver formato abaixo) e faz `POST` síncrono pro
      `discord_webhook_url` via `urllib.request` (sem dependência nova).
   f. Em caso de sucesso (2xx), insere a linha em `discord_notifications`. Em caso de
      falha (timeout, 4xx, 5xx), **loga o erro e segue pro próximo grupo** — nunca
      lança exceção que interrompa `cmd_fetch`.

## Formato do embed

Payload do Discord Webhook API (`POST` com JSON, campo `embeds`):

```json
{
  "embeds": [{
    "title": "Vitória 13×9 no Mirage",
    "color": 5763719,
    "description": "MVP do grupo: **fulano** (1.45 rating)",
    "url": "https://resenha-phi.vercel.app/partidas/<match_id>",
    "footer": { "text": "Resenha" }
  }]
}
```

- `title`: `"{Vitória|Derrota|Empate} {placar_grupo}×{placar_adversário} no {Mapa}"`.
- `color`: verde (`5763719`) se vitória, vermelho (`15548997`) se derrota, cinza
  (`9807270`) se empate — códigos decimais RGB do padrão de embed do Discord.
- `description`: nome (nick) e rating do MVP do grupo.
- `url`: link direto pra página da Partida no Resenha (torna o título clicável). O
  Coletor **não tem hoje** uma config de URL do site (`Config` em `coletor/config.py`
  só tem `database_url`/`steam_api_key`/`faceit_api_key`/`r2_*`) — precisa adicionar
  `self.app_url = env.get("APP_URL")` (mesmo nome de variável já usado no `site/server`
  pra validar o `return_to` do login Steam) e o Secret `APP_URL` no `coletor.yml`.
- Mapa vem de `matches.map` (nome amigável — reaproveitar o mapeamento de nomes já
  usado no client, ou usar o nome cru do CS2 tipo `de_mirage` se não houver mapeamento
  em Python; **decisão de implementação, não bloqueia o design**).

## Configuração pelo admin (server + client)

**Servidor** — novo endpoint em `groups.js`:

```
PUT /api/groups/:id/discord-webhook
Body: { url: string | null }
```

Exige `requireGroupMember` + checagem de `role = 'admin'` na tabela `group_members`
(mesmo padrão de `POST /api/groups/:id/convites`). Valida que `url` é uma URL
`https://discord.com/api/webhooks/...` (ou `null` pra remover) antes de salvar —
rejeita qualquer outra coisa com 400, pra não guardar lixo/URL maliciosa no banco.

**Client** — nova seção na aba "Minha conta" (`Perfil.jsx`), visível só quando
`jogador.souAdminDoGrupo`, ao lado da seção de convite existente: campo de texto pra
colar o webhook + botão salvar, mostrando o estado atual (configurado/não configurado).

## Erros e casos extremos

- **Grupo sem webhook configurado:** skip silencioso, sem log de erro (comportamento normal).
- **Webhook inválido/apagado no Discord** (POST retorna 404): loga o erro no Coletor,
  não trava o fetch, não insere em `discord_notifications` (então, se o admin
  reconfigurar o webhook depois, o próximo *reprocessamento* dessa partida específica
  tentaria de novo — mas reprocessamento não é automático, então na prática o aviso
  daquela partida específica se perde; aceitável pro escopo).
- **Partida sem `match_players` de nenhum grupo** (ex.: só adversários, ninguém do
  Resenha rastreado — não deveria acontecer dado que a partida só existe porque um
  jogador rastreado jogou nela, mas por segurança o laço simplesmente não encontra
  grupos e não manda nada).
- **Empate:** cor cinza, título "Empate Xx X no Mapa".

## Testes

- **Coletor (`pytest`):** função nova (ex.: `descobrir_grupos_da_partida`,
  `calcular_placar_do_grupo`, `montar_embed_discord`) testável isoladamente com dados
  fake — sem precisar de rede real. Teste de integração do fluxo completo com
  `urllib.request` mockado (padrão já usado nos testes existentes do Coletor).
- **Servidor (`vitest`):** endpoint `PUT /api/groups/:id/discord-webhook` — 403 pra
  não-admin, 400 pra URL inválida, 200 + persiste pra URL válida e para `null`.
