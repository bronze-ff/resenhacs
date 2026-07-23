-- supabase/migrations/0050_confirmacao_vencedor.sql
-- Confirmacao manual do vencedor antes do tradelink
-- (docs/superpowers/specs/2026-07-23-integridade-data-upload-e-confirmacao-vencedor-design.md):
-- upload manual de demo aceita played_at digitado pelo jogador sem verificacao (o .dem nao
-- guarda data real em lugar nenhum) - o admin passa a confirmar manualmente o vencedor
-- (revisando os clipes, com destaque pros que vieram de upload manual) antes do jogador
-- conseguir enviar o tradelink e receber o premio.
alter table competicoes add column vencedor_confirmado_em timestamptz;
