-- Posições de kill (coords de MUNDO, não normalizadas — se a calibração de um mapa
-- mudar, não precisa reparsear, só reprojetar na leitura). Hoje essas posições só
-- existem no replay JSON no R2, 1 por partida — agregar "onde ele mais mata" por
-- jogador ao longo de várias partidas exigiria baixar N JSONs, inviável. Persistindo
-- aqui, o preview de posicionamento agregado vira uma query.
create table kill_positions (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references matches(id) on delete cascade,
  round_number integer not null,
  killer       text,               -- steam_id64; pode ser null (dano de mundo/queda)
  victim       text not null,
  weapon       text not null default '',
  headshot     boolean not null default false,
  killer_x     real,
  killer_y     real,
  victim_x     real not null,
  victim_y     real not null,
  tick         integer not null
);
create index idx_killpos_match on kill_positions (match_id);
create index idx_killpos_killer on kill_positions (killer);
create index idx_killpos_victim on kill_positions (victim);
alter table kill_positions enable row level security;
revoke all on kill_positions from anon, authenticated;
