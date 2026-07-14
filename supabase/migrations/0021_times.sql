create table teams (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  nome text not null,
  publico boolean not null default false,
  criado_por text not null references players(steam_id64),
  criado_em timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  steam_id64 text not null references players(steam_id64),
  primary key (team_id, steam_id64)
);

alter table players add column ranking_publico boolean not null default false;
