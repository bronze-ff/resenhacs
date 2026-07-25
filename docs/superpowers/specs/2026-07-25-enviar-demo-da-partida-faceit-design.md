# Enviar demo de uma Partida FACEIT já registrada

## Problema

Partidas vindas da API da FACEIT entram no sistema sem demo. O Coletor monta a
Partida com `montar_parsed_stats_only` (`coletor/src/coletor/faceit.py:104`) e
grava direto via `store_parsed`, **sem passar por `transform.enrich`**. O
resultado é uma Partida pela metade:

- `damage` vem fixo em `0` da API (`faceit.py:140`) → ADR aparece como `0` (a UI
  calcula `damage / roundsPlayed` em `site/client/src/pages/Partida.jsx:478`);
- `rating` e `kast_pct` ficam `NULL` → a UI mostra `–`
  (`Partida.jsx:523`, `Partida.jsx:1351`);
- não existem rounds, kills, highlights, economia, utilitária, kill positions,
  Replay 2D nem base pra Clipes.

O Jogador consegue baixar o `.dem` dessa partida manualmente no site da FACEIT.
Hoje ele pode subir esse arquivo pela página "Enviar Demo"
(`site/client/src/pages/EnviarDemo.jsx`), mas o envio é **solto**: nasce sem
vínculo com a Partida que já está no sistema.

Existe uma dedupe por conteúdo — `matches.fingerprint`, sha256 de
`mapa|placar|steam_ids+K/D ordenados` (`coletor/src/coletor/db.py:9`) — que faz
`store_parsed` atualizar a linha existente quando o fingerprint bate
(`db.py:29`). Na prática isso significa que o enriquecimento *às vezes* já
acontece por acidente. Mas depende de os K/D do parser baterem exatamente com os
da API; qualquer divergência (team kill contado diferente, jogador que caiu,
round de reconexão) produz uma **Partida duplicada** em vez de enriquecer. E
nada impede alguém que não jogou de subir um arquivo qualquer.

## Objetivo

Permitir que um participante de uma Partida FACEIT stats-only envie a demo
daquela partida, com vínculo explícito, e o sistema a processe **na mesma linha**
— mesmo `id`, mesma URL — substituindo os stats da API pelos do parser e
destravando tudo que depende do parse.

## Decisões de escopo

- **Entrada pela página da Partida**, não pela página genérica. O envio nasce
  amarrado a um `match_id`.
- **Validação estrita**: mapa igual **e** os 10 `steam_id64` do parse iguais aos
  10 de `match_players`. Sem tolerância, sem janela de horário.
- **Estado visível na própria Partida**, sem página nova e sem polling.
- **Só FACEIT stats-only.** Recuperar Partida Premier `pending`/`failed` (demo
  expirada antes do Coletor baixar) usaria o mesmo mecanismo com validação por
  share code, mas nunca aconteceu na prática — YAGNI.
- A página "Enviar Demo" genérica **continua existindo e inalterada**.

## Arquitetura

### 1. Migration — vínculo e trava de concorrência

`uploads_pendentes` (criada em `0026_uploads_pendentes.sql`, alterada por `0038`
e `0045`) ganha:

```sql
alter table uploads_pendentes
  add column match_alvo_id uuid references matches(id) on delete cascade;

create unique index uploads_pendentes_alvo_ativo_idx
  on uploads_pendentes (match_alvo_id)
  where status in ('pendente', 'processando');
```

`match_alvo_id` é a Partida que o envio pretende enriquecer — distinto do
`match_id` que já existe na tabela, que é o *resultado* do processamento.
`NULL` = envio genérico (comportamento atual, intocado).

O índice parcial faz o banco garantir **um envio ativo por Partida**. Sem isso,
dois participantes poderiam subir 300MB cada em paralelo pra mesma partida.

E a coluna que dá nome ao badge:

```sql
alter table matches add column tem_demo boolean not null default false;

update matches m set tem_demo = true
  where exists (select 1 from rounds r where r.match_id = m.id);
```

O backfill é obrigatório: sem ele toda Partida já processada (Premier, upload
manual, pro) ficaria com `tem_demo = false`, exibindo o badge errado e — pras
FACEIT que já foram enriquecidas por acidente via fingerprint — reabrindo o
botão de envio numa Partida que já tem demo. "Tem rounds" é o teste de fato de
que a demo foi parseada (`rounds`, `0001_schema_inicial.sql:46`).

### 2. Servidor — `site/server/src/routes/upload.js`

`POST /api/upload/upload-url` passa a aceitar `matchId` opcional. Quando
presente, antes de emitir a URL pré-assinada, três checagens — nenhuma delas
confiando em dado do cliente:

1. **Participação** —
   `exists(select 1 from match_players where match_id = $1 and steam_id64 = <viewer>)`.
   Mesma prova que `partidaVisivelExpr` (`site/server/src/friendships.js:17`)
   já usa pra visibilidade. Falha → **403**.
2. **Partida elegível** — `matches.source = 'faceit'` e
   `matches.tem_demo = false`. Falha → **409**.
3. **Sem envio ativo** — o insert com o índice parcial resolve; violação de
   unicidade vira **409** ("já existe um envio em andamento pra esta partida").

Nesse caminho `shareCode`, `playedAt` e `plataformaManual` são **ignorados** —
herdam da Partida alvo. Reduz a superfície pra dado mentiroso vindo do cliente.
As validações já existentes de extensão `.dem` e teto de 400MB
(`upload.js:35-93`) continuam valendo.

`GET /api/matches/:id` passa a devolver:

```json
"demoUpload": { "status": "pendente|processando|falhou", "erro": null, "enviadoPorVoce": true }
```

Ausente quando não há envio relevante. `erro` só é preenchido pra quem enviou.

### 3. Cliente — `site/client/src/pages/Partida.jsx`

Botão **"Enviar demo desta partida"**, visível só quando as três condições
valem: o viewer está entre os participantes, a Partida é stats-only
(`tem_demo === false`), e não há envio ativo.

Antes do PUT no R2, uma checagem barata no browser: lê `file.slice(0, 8192)`,
procura um nome de mapa (`de_*`) no cabeçalho da demo e compara com
`matches.map`. Divergiu → barra na hora, com mensagem clara. Não achou nome de
mapa nenhum → **segue com o envio**; a validação de verdade é a do Coletor.

Isso é economia de tempo do Jogador, não garantia de segurança: no CS2 o
cabeçalho é protobuf (`PBDEMS2`), sem offset fixo pro nome do mapa, então a
busca por string é heurística.

Banner de estado na Partida:

- `pendente`/`processando` → "Demo em processamento — os dados completos
  aparecem em até 30 minutos" (visível pra todos que veem a Partida);
- `falhou` → motivo legível + botão de enviar outra (só pra quem enviou).

### 4. Coletor — `cmd_processar_uploads_pendentes`

Em `coletor/src/coletor/main.py:397`, quando o envio tem `match_alvo_id`, entra
um **portão entre o parse e a gravação**:

- mapa do parse == `matches.map` da Partida alvo;
- `set(steam_ids do parse) == set(match_players.steam_id64 da Partida alvo)`.

**Falhou** → `status='falhou'` com motivo legível (`"o mapa da demo não confere
com o desta partida"` / `"os jogadores da demo não são os desta partida"`) e
**apaga o arquivo do R2**. Isso diverge do tratamento de falha atual, que mantém
o arquivo pra retry — correto pra falha transitória (rede, timeout), errado
aqui: demo errada não fica certa na segunda tentativa.

**Passou** → grava na linha alvo. `store_parsed` ganha um parâmetro
`match_id_alvo` que curto-circuita o `select id from matches where fingerprint`
(`db.py:29`) e vai direto pro caminho de UPDATE da linha informada,
recalculando o fingerprint com os dados novos.

Dois cuidados na substituição — sem eles a Partida *perde* dado ao ser
"melhorada":

- `_write_players` (`db.py:122`) reescreve `match_players`;
  `faceit_elo_before`/`faceit_elo_after` (`0030_faceit_fase_b.sql:24`) precisam
  ser preservados;
- `matches.faceit_match_id` e `matches.plataforma_manual` idem.

`ingest_demo` marca `matches.tem_demo = true` ao finalizar.

### 5. Badge

`origemPartida` (`site/client/src/lib/format.js:83`) hoje deriva `AUTO` de
"`source` não é `'upload'`". A Partida enriquecida continua com
`source = 'faceit'` — trocar pra `'upload'` faria ela perder o badge FACEIT do
`PlataformaBadge`. Então o badge passa a olhar `tem_demo`: verdadeira → `DEMO`,
falsa → `AUTO`. O badge de plataforma (PREMIER/FACEIT) fica ao lado, inalterado.

`Feed.jsx:60` usa o mesmo helper, então a listagem acompanha sem mudança
adicional — desde que o endpoint do Feed passe a devolver `tem_demo`.

## Testes

**Servidor** (`site/server/src/routes/upload.js`):
- 403 quando o viewer não está em `match_players` da Partida alvo;
- 409 quando `tem_demo = true`;
- 409 quando já existe envio `pendente`/`processando` pra aquela Partida;
- 200 no caminho feliz, com `match_alvo_id` gravado e `shareCode`/`playedAt`
  enviados pelo cliente sendo ignorados.

**Coletor** (`cmd_processar_uploads_pendentes`):
- mapa divergente → `falhou` + arquivo removido do R2 + Partida alvo intocada;
- roster divergente → `falhou`, mesma consequência;
- caminho feliz → a Partida alvo é atualizada (mesmo `id`), `tem_demo` vira
  true, `faceit_elo_before/after`, `faceit_match_id` e `plataforma_manual`
  sobrevivem, e **nenhuma Partida nova é criada**;
- envio sem `match_alvo_id` continua passando pela dedupe por fingerprint como
  hoje (regressão).

**Cliente**:
- botão só aparece pra participante, em Partida stats-only, sem envio ativo;
- pré-check de cabeçalho: mapa divergente barra; cabeçalho ilegível deixa passar.

## Fora de escopo

- Partida Premier `pending`/`failed` com demo expirada.
- Substituir/reenviar demo de Partida que já tem `tem_demo = true`.
- Página "meus envios" / histórico de uploads.
- Qualquer portão de cobrança. A feature apenas faz a Partida passar a ter os
  dados; se gerar Clipe virar feature paga, o portão é lá, não aqui.
- Mudanças no fluxo de Partidas Pro (`partidas_pro_fila`) e na página "Enviar
  Demo" genérica.
