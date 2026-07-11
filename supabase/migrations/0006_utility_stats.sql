-- Estatísticas de utilitária: granadas usadas por tipo, quem cegou quem (inimigo vs
-- aliado) e por quanto tempo. Responde "quantas smokes ele usou", "quanto tempo os
-- inimigos ficaram cegados por ele", "flashou o próprio time quantas vezes" etc.
-- he_damage/molotov_damage: split de utility_damage (que já existia, soma dos dois)
-- pelo campo weapon do player_hurt ("hegrenade" vs "inferno" — nome empírico do dano
-- de queimadura de molotov/incendiary).
alter table match_players
  add column smokes_thrown integer not null default 0,
  add column flashes_thrown integer not null default 0,
  add column he_thrown integer not null default 0,
  add column molotovs_thrown integer not null default 0,
  add column he_damage integer not null default 0,
  add column molotov_damage integer not null default 0,
  add column enemies_flashed integer not null default 0,
  add column teammates_flashed integer not null default 0,
  add column enemy_flash_duration numeric(7, 2) not null default 0,
  add column teammate_flash_duration numeric(7, 2) not null default 0;
