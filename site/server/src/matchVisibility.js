// Regra ÚNICA de visibilidade de partida por grupo (ver
// docs/superpowers/specs/2026-07-17-visibilidade-partidas-participacao-design.md).
//
// Uma partida é visível a um grupo G se ela PERTENCE ao grupo (matches.group_id = G)
// OU se pelo menos um membro atual de G jogou nela (steam_id64 em match_players). O
// `group_id = G` é a garantia de não-regressão (ex.: demo enviada por upload que ninguém
// do grupo jogou continua aparecendo); o `exists` é o compartilhamento cross-grupo.

// Núcleo: expressão booleana da regra, dado o alias da tabela `matches` (ex.: 'm') e o
// placeholder do param do groupId já existente na query (ex.: '$1'). É a ÚNICA definição
// da regra — todos os outros helpers e call sites compõem em cima desta.
export function partidaVisivelExpr(alias, groupParam) {
  return `(${alias}.group_id = ${groupParam} or exists (
    select 1 from group_members gmv
    join match_players mv on mv.steam_id64 = gmv.steam_id64
    where gmv.group_id = ${groupParam} and mv.match_id = ${alias}.id))`
}

// Fragmento ` and (...)` que dá push no groupId em `params` (mesma convenção de
// periodoWhere/grupoWhere). groupId nulo → '' (modo perfil público, sem filtro de grupo).
export function partidaVisivelWhere(alias, groupId, params) {
  if (!groupId) return ''
  params.push(groupId)
  return ` and ${partidaVisivelExpr(alias, `$${params.length}`)}`
}

// Predicado sem ` and ` (pra compor em `where id = $1 and <predicado>`), dando push no groupId.
export function partidaVisivelPredicado(alias, groupId, params) {
  params.push(groupId)
  return partidaVisivelExpr(alias, `$${params.length}`)
}

// "Partida pública": tem ao menos um jogador que optou pelo ranking público (players.ranking_publico).
// Usado SÓ pra ABRIR o detalhe de uma partida alcançada por um perfil público — o jogador liberou
// aparecer publicamente, e o Filippe decidiu (2026-07-17) que isso torna as partidas dele abríveis
// com o scoreboard completo. NÃO usar no feed (o feed continua escopado por participação/grupo);
// só nos endpoints de detalhe de UMA partida. Não consome param.
export function partidaPublicaExpr(alias) {
  return `exists (
    select 1 from match_players mvp
    join players pvp on pvp.steam_id64 = mvp.steam_id64
    where pvp.ranking_publico = true and mvp.match_id = ${alias}.id)`
}
