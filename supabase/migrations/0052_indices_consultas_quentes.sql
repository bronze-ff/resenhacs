-- Índices pras consultas quentes que até hoje varriam a tabela inteira (auditoria de
-- 2026-08-05). Todos aditivos e idempotentes (if not exists); tabelas ainda são
-- pequenas, então o custo de criação é desprezível — o ganho é não deixar o Feed e o
-- perfil degradarem conforme o histórico de Partidas cresce.
--
-- Sem índice novo em friendships de propósito: a PK (player_a, player_b) e o
-- idx_friendships_b já cobrem os dois lados do EXISTS de visibilidade, e `status`
-- sozinho tem cardinalidade baixíssima (pending/accepted) — um índice só dele não
-- seria usado pelo planner.

-- Feed: GET /api/matches filtra por map, source e (desde a PR #39) plataforma_manual.
create index if not exists idx_matches_map on matches (map);
create index if not exists idx_matches_source on matches (source);
-- Parcial: plataforma_manual é null em tudo que não é upload manual rotulado — indexar
-- os nulls só inflaria o índice sem servir a nenhuma consulta.
create index if not exists idx_matches_plataforma_manual
  on matches (plataforma_manual) where plataforma_manual is not null;

-- Perfil (profile.js, destaques do jogador) e Ranking (ranking.js, contagem de
-- highlights por jogador): ambos filtram highlights por steam_id64 — só existia
-- índice por match_id (0001).
create index if not exists idx_highlights_steam on highlights (steam_id64);

-- Perfil (prévia de clipes do jogador): allstar_clips só tinha índice por
-- highlight_id (0036) e match_id (0042).
create index if not exists idx_allstar_clips_steam on allstar_clips (steam_id64);

-- Aba Clipes (clipes.js): `order by pontuacao_total desc nulls last` sem limit sobre
-- os Processed. Parcial no status certo — Submitted/Error nunca aparecem na listagem.
create index if not exists idx_allstar_clips_pontuacao
  on allstar_clips (pontuacao_total desc nulls last) where status = 'Processed';
