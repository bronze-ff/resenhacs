# Visibilidade de partidas por participação — Design

**Data:** 2026-07-17

## Problema

A turma de amigos está fragmentada em grupos separados no sistema (login aberto +
onboarding levou cada um a criar/entrar em grupos diferentes):

| Grupo | Membros | Partidas (group_id) |
|---|---|---|
| Grupo original (`864b56a4`) | iwnl, Virabrequim, TROYA, LABUBU PEEK, bronze | 115 |
| 062 (`c9e8cbfe`) | Jubileu, CASCADEBALA.KS, tue666, IsLanD_Boy07, Virabrequim | 47 |

Cada tela é escopada por `matches.group_id = req.groupId` (isolamento de segurança).
Consequência: `tue666` (grupo 062) jogou 12 partidas registradas no "Grupo original",
mas não as enxerga — pertencem a outro `group_id`. `is_tracked` já está `true` nessas
linhas; o gargalo é o `group_id`, não o flag.

## Regra (decisão do usuário)

Uma partida é **visível a um grupo G** se:

```
matches.group_id = G   OR   ∃ membro atual de G com steam_id64 em match_players(match)
```

- `group_id = G` (segurança/não-regressão): nenhuma partida que já aparece hoje some
  (ex.: demo enviada por upload de uma partida que nenhum membro jogou).
- `∃ membro em match_players` (o novo): partilha cross-grupo por participação, limite **≥ 1 membro**.

### Efeitos por tela
- **Partida solo** (só 1 membro do grupo dela jogou) → aparece só no grupo desse membro.
- **Partida compartilhada** (membros de 2 grupos jogaram) → aparece nos dois grupos.
- **Ranking:** cada grupo ranqueia só os **seus membros**; para um membro, a presença
  dele já satisfaz a visibilidade, então o ranking dele agrega **todas as partidas dele**.
  A mesma partida compartilhada conta pra cada jogador no ranking do seu próprio grupo —
  a partida é uma só (sem duplicação), muda só quem a enxerga.
- **Perfil:** membro vê todas as partidas que jogou; não-membro com presença no grupo
  (ex.: tue666 visto pelo Grupo original) aparece com as partidas compartilhadas.

## Arquitetura

Visibilidade **derivada em tempo de query** — sem tabela materializada, sem migração,
sem mudança no Coletor. Entra/sai de membro recalcula sozinho.

Helper único e compartilhado `partidaVisivelWhere(alias, groupId, params)` em
`site/server/src/matchVisibility.js`, mesma convenção dos outros `*Where`
(dá `push` no param e devolve o fragmento SQL). Substitui o `m.group_id = $G` /
`grupoWhere` em todos os endpoints de **leitura de partida**:

```js
export function partidaVisivelWhere(alias, groupId, params) {
  if (!groupId) return '' // modo público (perfil cross-grupo) segue sem filtro
  params.push(groupId)
  const n = params.length
  return ` and (${alias}.group_id = $${n} or exists (
    select 1 from group_members gm
    join match_players mv on mv.steam_id64 = gm.steam_id64
    where gm.group_id = $${n} and mv.match_id = ${alias}.id))`
}
```

Para as checagens de acesso a partida única (`where id = $1 and group_id = $2`), a
condição vira `where id = $1 and (group_id = $2 or exists (... mv.match_id = matches.id ...))`.

### Endpoints afetados (viram participação-visíveis)
- **matches.js:** `GET /` (feed), `GET /:id`, `GET /:id/jogador/:steamId/detalhe`,
  `GET /:id/head-to-head/:steamId`, `GET /:id/replay`, `GET /:id/demo`.
  `GET /sync-status` **não muda** (fila de ingest própria do grupo).
- **profile.js:** `statsAgregados`, `melhorSequencia`, `estiloDoJogador`, `evolucaoRating`,
  `armasDoJogador`, `economiaDoJogador`, subqueries de `aces`, `porMapa`, `recentes`,
  `destaques`, `sinergia`, `premier`, `GET /:steamId/posicoes`, `GET /compare`.
  O `grupoWhere` local é substituído pelo helper compartilhado (com alias).
  O gate de presença (`temPresenca`) já é por participação — mantém.
- **ranking.js:** o filtro `m.group_id = $1` do subselect de `match_players` e do
  subselect de `aces` vira o helper; a lista de quem ranqueia continua
  `group_members where group_id = $1`.

### O que permanece isolado por `group_id` (NÃO muda)
Táticas, clipes, lineups, sessões, uploads/demo pendentes, times. Só **partidas e stats
derivados** ficam participação-visíveis.

## Segurança

Flexibilização **deliberada e restrita a partidas**: um grupo passa a ver o scoreboard
inteiro de uma partida compartilhada (inclusive stats de jogadores de outro grupo que
estavam na mesma partida). Aceitável porque só se vê partida em que um membro do próprio
grupo de fato jogou. Todo o resto do sistema segue fechado por `group_id`
(ver `resenha-seguranca-grupos`). O helper é a única fonte da regra — um ponto só pra
auditar.

## Performance

Escala atual: centenas de partidas, ~5 grupos → o `exists` correlato é instantâneo.
Índices existentes cobrem (`match_players(match_id, steam_id64)`,
`group_members(group_id, steam_id64)`). Se crescer, avaliar índice dedicado — fora de escopo agora.

## Testes

Atualizar/expandir `matches.test.js`, `profile.test.js`, `ranking.test.js` para cobrir:
(1) partida de outro `group_id` com 1 membro presente aparece; (2) partida sem nenhum
membro presente e `group_id` alheio **não** aparece; (3) partida `group_id` do próprio
grupo sem membro em match_players (upload) continua aparecendo; (4) ranking do grupo conta
a partida compartilhada pro membro certo, sem incluir não-membros.
