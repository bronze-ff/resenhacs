create table taticas_curadas (
  id uuid primary key default gen_random_uuid(),
  map text not null,
  lado text not null check (lado in ('T', 'CT')),
  tipo text not null check (tipo in ('execute', 'fake', 'explode', 'rush', 'split', 'setup')),
  local text not null check (local in ('A', 'B', 'MID')),
  armas text not null default 'full' check (armas in ('full', 'eco', 'force', 'pistol')),
  titulo text not null,
  descricao text,
  criado_por text references players(steam_id64),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index on taticas_curadas (map, lado);

create table taticas_papeis (
  id uuid primary key default gen_random_uuid(),
  tatica_id uuid not null references taticas_curadas(id) on delete cascade,
  ordem int not null,
  descricao text not null,
  obrigatorio boolean not null default true
);
create index on taticas_papeis (tatica_id);

create table taticas_papel_granadas (
  papel_id uuid not null references taticas_papeis(id) on delete cascade,
  lineup_curado_id uuid not null references lineups_curados(id) on delete cascade,
  ordem int not null default 0,
  primary key (papel_id, lineup_curado_id)
);
