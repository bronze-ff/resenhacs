-- Quadro tático: estratégia desenhada à mão sobre o radar do mapa, em passos.
--
-- `passos` é uma lista JSON: [{ nome, objetos: [{ tipo, x, y, x2?, y2?, pontos?, rotulo? }] }].
-- tipo ∈ ct | t | smoke | flash | molotov | he | seta | traco; coordenadas normalizadas
-- 0..1 no radar (mesma convenção do Replay 2D). O servidor valida o formato e os tetos
-- (≤ 20 passos, ≤ 200 objetos por passo) antes de gravar — aqui só garantimos que é array.
--
-- Visibilidade: o dono sempre vê; amigos `accepted` veem quando publico_no_grupo = true.
-- Só o dono edita ou exclui (regra no servidor, routes/quadros.js).

create table quadros_taticos (
  id               uuid primary key default gen_random_uuid(),
  criado_por       text not null references players(steam_id64) on delete cascade,
  map              text not null,
  lado             text check (lado in ('T', 'CT')),
  nome             text not null,
  descricao        text not null default '',
  passos           jsonb not null check (jsonb_typeof(passos) = 'array'),
  publico_no_grupo boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index quadros_taticos_criado_por_idx on quadros_taticos (criado_por, updated_at desc);

-- Mesma postura da 0053: a API pública do Supabase não enxerga a tabela; só o servidor
-- (conectado como `postgres`) lê e grava.
alter table quadros_taticos enable row level security;
revoke all on quadros_taticos from anon, authenticated;
