-- Clipe real (vídeo do CS2 de verdade) de kills escolhidas pelo Jogador, renderizado
-- pela DEMO-SLAP (site/server/src/demoSlap.js). Uma kill = um clipe; várias = montagem.
--
-- demoslap_analises: uma análise por Partida (custa 1 crédito na DEMO-SLAP). O job_id
-- é reaproveitado por todos os clipes da Partida.
-- clipes_reais: cada pedido. `kills` é [{ tick, round, pov }] (pov = steamId64 de quem
-- a câmera segue). O status avança quando alguém consulta o clipe (sem worker):
-- analisando → enviando → renderizando → (juntando) → pronto | erro.
-- A URL do vídeo é assinada e expira, então não é guardada: o servidor pede de novo à
-- DEMO-SLAP quando o clipe é exibido.

create table demoslap_analises (
  match_id      uuid primary key references matches(id) on delete cascade,
  job_id        text not null,
  status        text not null default 'working' check (status in ('working', 'done', 'error')),
  tick_rate     integer,
  erro          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table clipes_reais (
  id                uuid primary key default gen_random_uuid(),
  match_id          uuid not null references matches(id) on delete cascade,
  pedido_por        text not null references players(steam_id64) on delete cascade,
  kills             jsonb not null check (jsonb_typeof(kills) = 'array'),
  status            text not null default 'analisando'
                    check (status in ('analisando', 'enviando', 'renderizando', 'juntando', 'pronto', 'erro')),
  video_job_ids     text[],
  fragmovie_job_id  text,
  erro              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index clipes_reais_match_idx on clipes_reais (match_id, created_at desc);
create index clipes_reais_pedido_por_idx on clipes_reais (pedido_por, created_at desc);

-- Mesma postura da 0053: a API pública do Supabase não enxerga as tabelas; só o
-- servidor (conectado como `postgres`) lê e grava.
alter table demoslap_analises enable row level security;
revoke all on demoslap_analises from anon, authenticated;
alter table clipes_reais enable row level security;
revoke all on clipes_reais from anon, authenticated;
