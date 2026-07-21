# Amizades substituem grupos — Design

**Data:** 2026-07-21
**Status:** aprovado, aguardando plano de implementação

## Problema

O sistema Resenha (stats de CS2 pra grupo fechado de amigos) força, logo após o
login com Steam, uma etapa de "criar ou entrar num grupo" que confunde quem nunca
usou — a pessoa não sabe o que é "grupo" nesse contexto e não entende por que
precisa disso antes de ver qualquer coisa. Além disso, `group_id` é a espinha
dorsal de isolamento de dados de todo o sistema, o que espalha a complexidade de
multi-tenancy por 18 arquivos do server e por todo o Coletor.

Na prática o "grupo" hoje é uma panelinha única de amigos. O modelo de amizade
mútua (estilo Steam) expressa isso de forma mais natural e elimina a etapa de
onboarding confusa: a pessoa só loga com a Steam e, se quiser, adiciona amigos.

## Objetivo

Substituir o conceito de **grupo** por **amizade mútua entre jogadores**. Um
jogador vê os dados (partidas, ranking, recordes) de si mesmo e dos amigos que
aceitou. Novo usuário loga com Steam e cai direto no sistema, sem etapa de grupo.

## Decisões travadas (do brainstorming)

- **Amizade é mútua**: os dois lados confirmam (`pending` → `accepted`). Exceção:
  auto-friend via Steam (abaixo) cria `accepted` direto.
- **Visibilidade de partida**: basta 1 amigo meu ter jogado pra eu ver a partida
  **inteira** (scoreboard completo, replay 2D, etc) — não anonimiza os outros.
- **Escopo de ranking/recordes**: eu + meus amigos **diretos** (não transitivo).
- **Migração**: todo mundo hoje em `group_members` vira amigo mútuo (`accepted`)
  de todo mundo — união de todos os grupos numa panelinha só. Apenas contas reais
  (quem está em `group_members`), nunca adversários raspados da tabela `players`.
- **Auto-friend Steam**: ao logar, amigo Steam que já tem conta no Resenha vira
  amizade `accepted` automática (aceite implícito), sem passar por `pending`.
- **Times**: aba removida (não vale manter escopada por amizade).
- **Ranking Público / perfil público**: removido inteiro. Contradiz a filosofia
  do sistema ("feito pra resenha do grupo, não pra internet") e é a única fonte da
  complexidade de "viewer null". Sem ele, a visibilidade vira puramente
  "eu + meus amigos", sem exceção.
- **Escopo**: server + client + Coletor + migração de banco, num projeto só.

## Modelo de dados

### Nova tabela `friendships`

```sql
create table friendships (
  player_a      text not null references players(steam_id64),
  player_b      text not null references players(steam_id64),
  status        text not null default 'pending',  -- 'pending' | 'accepted'
  requested_by  text not null references players(steam_id64),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  primary key (player_a, player_b),
  check (player_a < player_b)                       -- ordem canônica: sem A↔B duplicado
);
create index idx_friendships_b on friendships (player_b);
```

- Ordem canônica `player_a < player_b` garante uma única linha por par, não importa
  quem pediu. `requested_by` guarda a direção do pedido (pra distinguir "recebido"
  de "enviado" na UI de pendentes).
- Uma amizade `accepted` significa que **ambos** veem os dados um do outro.

### Helper canônico de par

Um helper puro (`parCanonico(steamId1, steamId2) -> [menor, maior]`) usado por
toda inserção/consulta pra evitar espalhar a regra de ordenação. Vive em um módulo
novo `site/server/src/friendships.js` junto com as expressões de visibilidade.

### Colunas/tabelas removidas

- `matches.group_id` (era `not null`) — removida. Partida não "pertence" mais a
  ninguém; visibilidade é derivada dos participantes + amizades.
- Tabelas `groups`, `group_members` — dropadas após a migração.
- `players.grupo_ativo_id` — removida.
- `group_id` em `uploads_pendentes`, `faceit_pendentes` e demais filas do Coletor.
- `players.ranking_publico` — removida junto com o Ranking Público (abaixo).

### Migração de dados (ordem)

1. Criar `friendships`.
2. Popular: `insert` de todos os pares distintos de `group_members` do mesmo grupo,
   normalizados por `parCanonico`, `status = 'accepted'`, `requested_by` = o menor
   dos dois (arbitrário, só pra satisfazer o not-null), `accepted_at = now()`.
   `on conflict do nothing` (dois grupos podem compartilhar pessoas).
3. Só depois: dropar `group_id` das tabelas e as tabelas de grupo.

A migração roda no Supabase (produção) via `apply_migration` — o controller aplica
direto (subagents não aplicam migração em prod, ver memória do projeto).

## Regra de visibilidade

Hoje `matchVisibility.js` define `partidaVisivelExpr(alias, groupParam)`:
"partida pertence ao grupo G OU um membro de G jogou nela". Passa a ser, num novo
`friendships.js`, `partidaVisivelExpr(alias, viewerParam)`:

```sql
-- Visível ao viewer V se V jogou nela, OU um amigo accepted de V jogou nela.
(exists (select 1 from match_players mv
         where mv.match_id = <alias>.id and mv.steam_id64 = <viewerParam>)
 or exists (select 1 from match_players mv
            join friendships f
              on ((f.player_a = <viewerParam> and f.player_b = mv.steam_id64)
               or (f.player_b = <viewerParam> and f.player_a = mv.steam_id64))
            where mv.match_id = <alias>.id and f.status = 'accepted'))
```

- `partidaPublicaExpr` e o modo viewer-null são **removidos** junto com o Ranking
  Público (ver seção própria). Todo call site que hoje é
  `partidaVisivelExpr(...) or partidaPublicaExpr(...)` passa a ser só
  `partidaVisivelExpr(...)`. Não existe mais acesso sem viewer autenticado.
- Todos os call sites que hoje passam `req.groupId` passam `req.player.steamId`.

## Middleware

- `requireGroupMember` → **removido**. Substituído por `requireAuth` sozinho onde
  a rota só precisa de um viewer autenticado. O `steamId` do viewer sai de
  `req.player.steamId` (já populado por `requireAuth`).
- `requireSuperAdmin` e `is_super_admin` → **intactos**. Admin, edição de
  Granadas/Táticas e Partidas Pro continuam gated por super-admin global.
- Header `X-Group-Id` → removido do client e do server.

## Coletor (Python)

- `matches.group_id` deixa de existir → `_insert_match`, `upsert_match`,
  `record_pending_match` perdem o parâmetro `group_id`.
- `grupo_para_ingest` → removida (não há mais grupo pra atribuir).
- `list_tracked_players` para de selecionar/retornar `grupo_ativo_id`.
- `uploads_pendentes`/`faceit_pendentes`: perdem a coluna `group_id` e o Coletor
  para de lê-la.
- Discovery continua puxando share codes dos jogadores com onboarding
  (`match_auth_code`/`last_share_code`), só não carimba grupo nenhum na partida.
- A view/consulta de "grupos que enxergam a partida" no `db.py` (linha ~750) é
  removida — não há mais grupo.

## Auto-friend via Steam

No fluxo de login (`routes/auth.js`, após criar/atualizar o `players`):

1. Chamar `GetFriendList` da Steam Web API (mesma `STEAM_API_KEY` já usada pra
   VAC bans) pro steamId que acabou de logar.
2. Interseção com steamIds que já têm conta no Resenha (linha em `players` com
   marcador de conta real — ver "conta real" abaixo).
3. Pra cada match, `insert` de `friendships` `accepted` (via `parCanonico`,
   `on conflict do nothing`).

- **Best-effort**: `GetFriendList` só retorna algo se o perfil tiver a lista de
  amigos **pública**. Perfil privado → nenhum amigo detectado, sem erro. O caminho
  manual (pedido de amizade) é o que sempre funciona.
- Executa de forma que não bloqueie/atrapalhe o login se a Steam falhar
  (try/catch, degrada silencioso — mesmo padrão do endpoint de bans).

### O que é "conta real"

A tabela `players` mistura contas (quem logou) e adversários raspados. O marcador
de conta real usado tanto na migração quanto no auto-friend é **presença anterior
em `group_members`** (na migração) e, dali pra frente, um marcador durável que não
dependa de grupos. Como `grupo_ativo_id` e `group_members` somem, a migração deve
**antes de dropar** popular um sinal persistente de "conta real" — proposta:
coluna `players.conta_criada_em timestamptz` preenchida no login (backfill via
`group_members` na migração). O auto-friend intersecta contra
`conta_criada_em is not null`.

## Remoção do Ranking Público

Removido por inteiro — server, client e banco:

- **Server**: rota `routes/rankingPublico.js` (deletada e desregistrada em
  `app.js`); `partidaPublicaExpr` em `matchVisibility.js`; toda leitura/escrita de
  `players.ranking_publico` (inclusive o toggle de opt-in em `routes/profile.js` /
  Minha Conta); o modo `?publico=1` nos endpoints de perfil (`routes/profile.js`,
  `routes/players.js`).
- **Client**: página `RankingPublico.jsx`, a aba "Ranking público" do menu
  (`Shell.jsx`, `App.jsx`), o modo `?publico=1` em `JogadorPerfil.jsx`/`Perfil.jsx`,
  e o controle de opt-in em Minha Conta.
- **Banco**: coluna `players.ranking_publico` dropada na migração.

Consequência: **não existe mais nenhum acesso sem login**. Toda visibilidade é
"eu + meus amigos accepted". A decisão de 2026-07-17 (abrir partidas via perfil
público) fica sem efeito e é revertida.

## Frontend / Navegação

- **Login → Feed direto.** Remove `Onboarding.jsx` e o fluxo de escolha de grupo.
- Remove `AceitarConvite.jsx` e as rotas de convite de grupo.
- Remove `SeletorGrupo` do header (`Shell.jsx`) e qualquer envio de `X-Group-Id`.
- **`Jogadores.jsx` → `Amigos.jsx`**: lista amigos `accepted`, pedidos pendentes
  (recebidos com aceitar/recusar; enviados com cancelar), e "adicionar amigo"
  (por steamID/link de perfil). Alerta de VAC/Game ban migra pra cá.
- Remove a aba **Times** do menu (`Shell.jsx`, `App.jsx`) e a página `Times.jsx`.
- Remove a aba **Ranking Público** do menu e a página `RankingPublico.jsx`.
- Menu resultante: Partidas, Ranking, Enviar Demo, Amigos, Comparar, Granadas,
  Táticas, Minha Conta, Curso de Mira (+ Admin/Partidas Pro pra super-admin).

## Rotas novas de amizade (`routes/friendships.js`)

- `GET /api/amigos` — meus amigos `accepted` + pendentes (recebidos/enviados).
- `POST /api/amigos` `{steamId}` — cria pedido `pending` (ou `accepted` se já
  existe pedido inverso pendente = aceite). Valida que o alvo é conta real.
- `POST /api/amigos/:steamId/aceitar` — pendente recebido → `accepted`.
- `DELETE /api/amigos/:steamId` — recusa pendente / desfaz amizade / cancela
  enviado (a mesma linha, qualquer direção).

## O que NÃO muda

Comparar, Granadas, Táticas, Curso de Mira, Minha Conta (só perde o toggle de
ranking público), Enviar Demo (só perde `X-Group-Id`), detecção de VAC/Game ban
(migra de tela), e todo o mecanismo de super-admin.

## Testes

- **`friendships.js`**: `parCanonico` (ordena, idempotente); `partidaVisivelExpr`
  gera SQL com os dois `exists` (participação + amizade).
- **Migração**: teste de integração — dado `group_members` de 2 grupos com pessoa
  em comum, resulta no conjunto certo de pares `accepted`, sem duplicar.
- **Rotas de amizade**: pedir → pendente; aceitar → accepted; pedido inverso vira
  aceite direto; recusar/desfazer remove a linha; rejeita alvo que não é conta
  real.
- **Auto-friend**: mock de `GetFriendList` — cria `accepted` só pra amigos que são
  conta real; perfil privado (lista vazia) não cria nada e não quebra o login.
- **Visibilidade**: partida com amigo meu como participante aparece; partida só de
  não-amigos não aparece; partida que eu joguei aparece mesmo sem amigos.
- **Coletor**: `_insert_match`/`upsert_match` inserem sem `group_id`; discovery
  não referencia grupo.

## Riscos / notas

- **Ranking vira per-viewer**: hoje o ranking é compartilhado (por grupo); passa a
  ser calculado por viewer (eu + meus amigos). Query diferente, mas mesma ordem de
  custo — os conjuntos são pequenos (dezenas de pessoas).
- **Auto-friend depende de perfil Steam público** — documentar como best-effort na
  UI ("adicione manualmente se não apareceu automaticamente").
- **Migração é destrutiva** (dropa `groups`/`group_members`/`group_id`). Fazer o
  backfill de `friendships` e do marcador de conta real **antes** de dropar, e
  validar contagens antes de aplicar em produção.
