-- Stats estilo Leetify: precisão de tiro, dano de utilitária, entries, trades e clutch W/L.
-- shots_fired/shots_hit: só armas de fogo (exclui faca e granadas) — precisão = hit/fired.
-- entry_*: primeiro kill "de verdade" (não TK) de cada round.
-- trade_kills/traded_deaths: kill que vinga um teammate morto há até 5s.
-- clutch_wins/clutch_attempts: último vivo do time vs 2+ inimigos, tentativas e vitórias.
alter table match_players
  add column utility_damage integer not null default 0,
  add column shots_fired integer not null default 0,
  add column shots_hit integer not null default 0,
  add column entry_kills integer not null default 0,
  add column entry_deaths integer not null default 0,
  add column entry_wins integer not null default 0,
  add column trade_kills integer not null default 0,
  add column traded_deaths integer not null default 0,
  add column clutch_wins integer not null default 0,
  add column clutch_attempts integer not null default 0;
