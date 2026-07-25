-- Enviar demo de uma Partida FACEIT stats-only pela própria página da Partida.
-- Ver docs/superpowers/specs/2026-07-25-enviar-demo-da-partida-faceit-design.md

-- Marca se a Partida tem os dados que só o parse da Demo produz (rounds, ADR,
-- KAST, rating, Replay 2D). Partida FACEIT stats-only (montada só com a API,
-- ver coletor/src/coletor/faceit.py:montar_parsed_stats_only) fica false.
alter table matches add column tem_demo boolean not null default false;

-- Backfill OBRIGATÓRIO: sem ele toda Partida já processada (Premier, upload
-- manual, pro) ficaria false — badge errado no histórico inteiro e, pior, o
-- botão de envio reaberto numa Partida que já tem Demo. "Tem rounds" é o teste
-- de fato de que a Demo foi parseada.
update matches m set tem_demo = true
  where exists (select 1 from rounds r where r.match_id = m.id);

-- A Partida que este envio pretende enriquecer. Distinto de uploads_pendentes.match_id,
-- que é o RESULTADO do processamento. null = envio genérico (página "Enviar Demo").
alter table uploads_pendentes
  add column match_alvo_id uuid references matches(id) on delete cascade;

-- Um envio ativo por Partida: sem isso, dois participantes subiriam 300MB cada
-- pra mesma Partida em paralelo. A trava é do banco, não do aplicativo.
create unique index uploads_pendentes_alvo_ativo_idx
  on uploads_pendentes (match_alvo_id)
  where status in ('pendente', 'processando');
