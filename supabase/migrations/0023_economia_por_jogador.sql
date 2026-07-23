-- Gasto individual por round (hoje só tínhamos a soma do time em match_round_econ) e o
-- item-a-item comprado — pra responder "o que ele comprou no round X" e não só "quanto o
-- time gastou". O parser já lia o current_equip_value de cada jogador pra somar o do
-- time; agora também persiste por jogador.

create table match_player_round_econ (
  match_id uuid not null references matches(id) on delete cascade,
  round_number integer not null,
  steam_id64 text not null,
  team text,
  equip_value integer,
  buy_type text,
  primary key (match_id, round_number, steam_id64)
);

create table match_player_purchases (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  round_number integer not null,
  steam_id64 text not null,
  item text not null,
  tick integer
);

create index idx_match_player_purchases_match on match_player_purchases(match_id);
