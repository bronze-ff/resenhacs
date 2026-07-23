-- supabase/migrations/0049_competicao_premio_imagem.sql
-- Imagem e link de mercado do prêmio da competição
-- (docs/superpowers/specs/2026-07-23-premio-imagem-competicao-design.md): admin cola um
-- link de imagem (skin) e o link da página dela no mercado da Steam ao criar/editar uma
-- competição. Nullable no banco — competições já existentes ficam sem valor (não há como
-- fazer backfill de um link que não existe); a obrigatoriedade em CRIAÇÃO é aplicada na
-- API (POST /admin), mesmo padrão de nome/dataInicio/dataFim.
alter table competicoes
  add column premio_imagem_url text,
  add column premio_mercado_url text;
