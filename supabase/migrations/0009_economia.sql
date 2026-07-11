-- Economia por round e por time: valor de equipamento (soma dos 5) amostrado no fim do
-- freezetime, classificado no esquema HLTV/awpy ("Taken from hltv economy tab"):
--   eco < $5.000 | forcado $5.000–9.999 | semi $10.000–19.999 | full >= $20.000
-- Nível round×time (não incha match_players). win% por buy sai por join com rounds
-- (winner_team) e match_players (team fixo do jogador). Round pistola cai natural em eco.
create table match_round_econ (
  match_id     uuid not null references matches(id) on delete cascade,
  round_number integer not null,
  team         text not null check (team in ('A', 'B')),
  equip_value  integer not null default 0,
  buy_type     text not null,  -- eco | forcado | semi | full
  primary key (match_id, round_number, team)
);
create index idx_econ_match on match_round_econ (match_id);
alter table match_round_econ enable row level security;
revoke all on match_round_econ from anon, authenticated;
