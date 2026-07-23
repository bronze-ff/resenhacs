-- Fila de partidas FACEIT descobertas e ainda não processadas (mesmo papel da
-- uploads_pendentes pros uploads manuais). Linhas 'done' ficam pra sempre: são o
-- marcador de "esse membro já teve a primeira sincronização" e a defesa contra
-- re-enfileirar.
create table faceit_pendentes (
  faceit_match_id text primary key,
  steam_id64 text not null,
  group_id uuid not null,
  status text not null default 'pending', -- pending | done | failed
  tentativas integer not null default 0,
  erro text,
  created_at timestamptz not null default now()
);
create index idx_faceit_pendentes_status on faceit_pendentes(status);

alter table matches add column faceit_match_id text;
create unique index idx_matches_faceit_match_id on matches(faceit_match_id)
  where faceit_match_id is not null;

alter table players add column faceit_elo integer;
alter table players add column faceit_skill_level integer;
alter table players add column faceit_elo_atualizado_em timestamptz;

alter table match_players add column faceit_elo_before integer;
alter table match_players add column faceit_elo_after integer;
