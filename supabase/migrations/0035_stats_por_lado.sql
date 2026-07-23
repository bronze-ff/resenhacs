-- Filtro T/CT dentro da Partida (pedido do usuário, estilo scope.gg/Leetify): pra
-- recalcular K/D/A/ADR/rating/KAST só nos rounds de um lado, precisa de dado por
-- round que a gente não guardava — kill_positions tinha killer/vítima mas não quem
-- deu assistência, e não existia nenhuma tabela de dano por round (só o total da
-- partida em match_players.damage).
alter table kill_positions add column assister text;

create table match_player_round_damage (
  match_id     uuid not null references matches(id) on delete cascade,
  round_number integer not null,
  steam_id64   text not null,
  damage       integer not null default 0,
  primary key (match_id, round_number, steam_id64)
);
create index idx_round_damage_match on match_player_round_damage (match_id);
