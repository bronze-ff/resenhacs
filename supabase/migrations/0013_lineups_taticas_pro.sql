-- Nome do time/clã (extraído da demo) — pra partida de pro mostrar "FaZe vs Vitality" em
-- vez do rótulo genérico "Time A"/"Time B". Nullable: partida do grupo pode não ter clã.
alter table matches
  add column team_a_name text,
  add column team_b_name text;

-- Cada arremesso de granada individual, indexado e filtrável — alimenta a Biblioteca de
-- Granadas. Não duplica o replay.json (que já guarda isso por partida no R2); essa tabela
-- existe pra permitir filtro/busca eficiente ACROSS partidas, coisa que abrir N replay.json
-- não resolve bem.
create table lineups (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  round_number int not null,
  map text not null,
  tipo text not null check (tipo in ('smoke', 'flash', 'he', 'molotov')),
  thrower_steam_id text not null,
  thrower_nick text not null default '',
  thrower_x numeric not null,
  thrower_y numeric not null,
  thrower_yaw numeric not null default 0,
  thrower_pitch numeric not null default 0,
  target_x numeric not null,
  target_y numeric not null,
  tick int not null,
  origem text not null check (origem in ('grupo', 'pro')),
  created_at timestamptz not null default now()
);
create index lineups_map_tipo_idx on lineups (map, tipo);
create index lineups_match_id_idx on lineups (match_id);

-- Tática curada: aponta pra um round real (do grupo ou de pro) — a visualização reaproveita
-- o Replay 2D existente carregando esse round, não duplica posição/movimento aqui.
create table taticas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text not null default '',
  map text not null,
  match_id uuid not null references matches(id) on delete cascade,
  round_number int not null,
  status text not null default 'sugerida' check (status in ('sugerida', 'aprovada', 'rejeitada')),
  criado_por text not null references players(steam_id64),
  criado_em timestamptz not null default now()
);
create index taticas_map_status_idx on taticas (map, status);

-- Fila de curadoria de partida profissional — só controla o PROCESSO de ingestão (link do
-- HLTV, status, erro). Os dados da partida em si vão pras tabelas normais (matches,
-- match_players, lineups) via o mesmo ingest_demo() de sempre, com source='pro'.
create table partidas_pro_fila (
  id uuid primary key default gen_random_uuid(),
  hltv_url text not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'baixando', 'processando', 'concluida', 'falhou')),
  match_id uuid references matches(id) on delete set null,
  erro text,
  adicionado_por text not null references players(steam_id64),
  adicionado_em timestamptz not null default now()
);
