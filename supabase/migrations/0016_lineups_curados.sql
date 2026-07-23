create table lineups_curados (
  id uuid primary key default gen_random_uuid(),
  map text not null,
  lado text not null check (lado in ('T', 'CT')),
  tipo text not null check (tipo in ('smoke', 'flash', 'he', 'molotov')),
  titulo text not null,
  descricao text,
  video_url text,
  tecnica text not null default 'normal'
    check (tecnica in ('normal', 'jumpthrow', 'walkthrow', 'runthrow', 'run_jumpthrow')),
  botao text not null default 'esquerdo'
    check (botao in ('esquerdo', 'direito', 'esquerdo_direito')),
  passos jsonb not null default '[]',
  arremesso_x numeric not null,
  arremesso_y numeric not null,
  alvo_x numeric not null,
  alvo_y numeric not null,
  criado_por text references players(steam_id64),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index on lineups_curados (map, lado, tipo);
