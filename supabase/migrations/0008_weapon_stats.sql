-- Stats por arma, por jogador, por partida (tabela filha — não incha match_players).
-- Agregação multi-partida = SUM(...) GROUP BY weapon (nunca média de %). accuracy =
-- SUM(shots_hit)/SUM(shots_fired); hs% = SUM(hs_kills)/SUM(kills). AWP fica FORA da
-- accuracy (quase todo hit mata, distorce) e shotgun idem (1 tiro = vários pellets =
-- vários player_hurt), tratado na leitura. weapon vem do demo sem prefixo: 'ak47','awp'.
create table match_player_weapons (
  match_id     uuid not null references matches(id) on delete cascade,
  steam_id64   text not null,
  weapon       text not null,
  kills        integer not null default 0,
  hs_kills     integer not null default 0,
  shots_fired  integer not null default 0,
  shots_hit    integer not null default 0,
  damage       integer not null default 0,
  primary key (match_id, steam_id64, weapon)
);
create index idx_mpw_steam_weapon on match_player_weapons (steam_id64, weapon);
alter table match_player_weapons enable row level security;
revoke all on match_player_weapons from anon, authenticated;
