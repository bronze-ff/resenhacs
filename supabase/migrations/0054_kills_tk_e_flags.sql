-- Team kill e flags do player_death em kill_positions. Até aqui o Coletor descartava
-- o team kill (TK) — agora ele fica, marcado com is_team_kill, pra dar pra clipar o TK
-- de granada proposital no amigo e pra prêmios/conquistas. Toda consulta que conta
-- kill "de verdade" (rating, KAST, heatmap, Head to Head, stats por lado, pontuação)
-- filtra is_team_kill = false.
--   wallbang      = penetrated > 0 (atravessou parede/objeto)
--   thrusmoke     = kill através de smoke
--   attackerblind = atacante estava cego de flash
--   noscope       = sniper sem mira
-- Partidas antigas ficam com tudo false até serem reparseadas.
alter table kill_positions
  add column is_team_kill  boolean not null default false,
  add column wallbang      boolean not null default false,
  add column thrusmoke     boolean not null default false,
  add column attackerblind boolean not null default false,
  add column noscope       boolean not null default false;

-- A lista de kills da Partida lê por match_id ordenado por round/tick.
create index if not exists idx_killpos_match_round_tick
  on kill_positions (match_id, round_number, tick);
