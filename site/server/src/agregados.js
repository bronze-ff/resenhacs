// Regras de agregação únicas pro site todo (decididas com o usuário em 2026-10-21), pra
// Ranking, Perfil, Comparar e Mapas não darem números diferentes do mesmo jogador:
// - winrate = vitórias ÷ partidas DECIDIDAS: empate (won null) fica fora do denominador
//   e aparece à parte;
// - rating médio PONDERADO pelos rounds jogados: uma 13x2 não pesa o mesmo que uma 16x14.
//   Partida sem rating (FACEIT só com stats) fica fora (rating null zera o produto).
export const DECIDIDAS_SQL = 'count(*) filter (where mp.won is not null)'
export const EMPATES_SQL = 'count(mp.match_id) filter (where mp.won is null)'
export const RATING_PONDERADO_SQL =
  'sum(mp.rating * mp.rounds_played) / nullif(sum(case when mp.rating is null then 0 else mp.rounds_played end), 0)'
