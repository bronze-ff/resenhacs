// Regra ÚNICA de visibilidade de partida por AMIZADE (substitui o antigo matchVisibility.js
// que era por grupo). Uma partida é visível ao viewer V se V jogou nela, OU se um amigo
// `accepted` de V jogou nela. Sem exceção pública — não há mais acesso sem viewer.
//
// IMPORTANTE: os call sites de aces (ranking.js/profile.js) fazem .replaceAll('m.', 'mh.')
// no fragmento. O único token com 'm.' aqui é `<alias>.id`; os aliases internos são `mv`
// e `f` (não contêm 'm.'), então a troca só afeta o alias externo, como desejado.

// Ordena um par de steamIds na ordem canônica (menor string primeiro), pra bater com o
// check (player_a < player_b) da tabela friendships.
export function parCanonico(a, b) {
  return a < b ? [a, b] : [b, a]
}

// Núcleo: expressão booleana da regra, dado o alias da tabela `matches` e o placeholder do
// param do viewer (steamId) já existente na query.
export function partidaVisivelExpr(alias, viewerParam) {
  return `(exists (
    select 1 from match_players mv
    where mv.match_id = ${alias}.id and mv.steam_id64 = ${viewerParam})
  or exists (
    select 1 from friendships f
    join match_players mv on (
      (f.player_a = ${viewerParam} and f.player_b = mv.steam_id64)
      or (f.player_b = ${viewerParam} and f.player_a = mv.steam_id64))
    where mv.match_id = ${alias}.id and f.status = 'accepted'))`
}

// partidaVisivelWhere/partidaVisivelPredicado (helpers que dariam push do viewer em `params`)
// existiram aqui mas nunca foram importados por nenhuma rota — todo call site usa
// partidaVisivelExpr diretamente. Removidos: a versão *Where tratava viewer ausente como
// "sem filtro" (fail-OPEN, mostraria todas as partidas), e não valia a pena manter dead
// code cuja única função era essa armadilha. Se precisar de novo, refaça fail-CLOSED
// (lançar erro se o viewer estiver ausente, nunca devolver '').
