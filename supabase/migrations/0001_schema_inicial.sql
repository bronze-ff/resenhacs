-- Resenha: schema inicial (Fase 1)
-- Jogador = membro whitelistado; Participante = qualquer um dos 10 numa Partida (linha em match_players).

create table players (
  steam_id64      text primary key,
  nick            text not null default '',
  avatar_url      text,
  is_admin        boolean not null default false,
  match_auth_code text,          -- código de autenticação de histórico (Steam), usado pelo Coletor
  last_share_code text,          -- último share code conhecido da corrente
  created_at      timestamptz not null default now()
);

create table matches (
  id               uuid primary key default gen_random_uuid(),
  share_code       text unique,
  source           text not null default 'valve_mm',   -- valve_mm | faceit | gc | upload
  map              text,
  played_at        timestamptz,
  duration_seconds integer,
  score_a          integer,
  score_b          integer,
  demo_url         text,                                -- .dem arquivado no R2 (ADR-0002)
  replay_url       text,                                -- frames do Replay 2D no R2 (Fase 4)
  status           text not null default 'pending',     -- pending | parsed | failed | expired
  created_at       timestamptz not null default now()
);

create table match_players (
  match_id       uuid not null references matches(id) on delete cascade,
  steam_id64     text not null,
  nick           text not null default '',
  team           text not null check (team in ('A', 'B')),
  kills          integer not null default 0,
  deaths         integer not null default 0,
  assists        integer not null default 0,
  headshot_kills integer not null default 0,
  damage         integer not null default 0,
  rounds_played  integer not null default 0,
  rating         numeric(4, 2),
  won            boolean,
  is_tracked     boolean not null default false,  -- cache informativo "é Jogador"; a Sinergia usa join em players
  primary key (match_id, steam_id64)
);

create table rounds (
  match_id     uuid not null references matches(id) on delete cascade,
  round_number integer not null,
  winner_team  text check (winner_team in ('A', 'B')),
  win_reason   text,
  primary key (match_id, round_number)
);

create table highlights (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references matches(id) on delete cascade,
  steam_id64   text not null,
  round_number integer not null,
  kind         text not null,               -- ace | quad | triple | clutch_1v3 | clutch_1v4 | clutch_1v5
  description  text not null default '',
  created_at   timestamptz not null default now()
);

create table clips (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid references matches(id) on delete set null,
  highlight_id uuid references highlights(id) on delete set null,
  steam_id64   text not null,               -- de quem é a jogada
  url          text not null,
  provider     text not null default 'other',  -- allstar | medal | youtube | other
  title        text not null default '',
  added_by     text not null references players(steam_id64),
  created_at   timestamptz not null default now()
);

-- Nonces de OpenID já usados, para impedir replay do login Steam (ver Task 3/4 do plano).
create table used_openid_nonces (
  nonce   text primary key,
  seen_at timestamptz not null default now()
);

create index idx_match_players_steam on match_players (steam_id64);
create index idx_matches_played_at on matches (played_at desc);
create index idx_highlights_match on highlights (match_id);
create index idx_clips_match on clips (match_id);

-- Sinergia: duplas de Jogadores no mesmo time. Fonte de verdade de "é Jogador" é o join
-- em players (não a flag is_tracked), para contar o histórico retroativo de quem entra depois.
-- security_invoker OBRIGATÓRIO: view comum ignoraria o RLS das tabelas base e vazaria pela API.
-- REGRA para toda view futura (Fases 3-4): sempre security_invoker + revoke de anon/authenticated.
create view synergy_pairs with (security_invoker = true) as
select
  a.steam_id64                    as steam_id_1,
  b.steam_id64                    as steam_id_2,
  count(*)                        as partidas,
  count(*) filter (where a.won)   as vitorias
from match_players a
join match_players b
  on  a.match_id = b.match_id
  and a.team = b.team
  and a.steam_id64 < b.steam_id64
join players p1 on p1.steam_id64 = a.steam_id64
join players p2 on p2.steam_id64 = b.steam_id64
group by a.steam_id64, b.steam_id64;

-- O site acessa o banco pela conexão direta (role postgres); a API PostgREST pública
-- não deve expor nada: RLS ligado em tudo + revogação dos grants default a anon/authenticated.
alter table players enable row level security;
alter table matches enable row level security;
alter table match_players enable row level security;
alter table rounds enable row level security;
alter table highlights enable row level security;
alter table clips enable row level security;
alter table used_openid_nonces enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on synergy_pairs from anon, authenticated;
