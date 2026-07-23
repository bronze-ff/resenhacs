-- Dano e flashes trocados entre dois jogadores específicos de uma partida — a base do
-- "Head to Head" (kills por categoria de arma já vem de kill_positions, que já existe).
create table match_player_damage (
  match_id uuid not null references matches(id) on delete cascade,
  attacker text not null,
  victim text not null,
  weapon text not null,
  damage integer not null,
  hits integer not null,
  primary key (match_id, attacker, victim, weapon)
);

create table match_player_flashes (
  match_id uuid not null references matches(id) on delete cascade,
  attacker text not null,
  victim text not null,
  count integer not null,
  duration_sum numeric not null,
  primary key (match_id, attacker, victim)
);
