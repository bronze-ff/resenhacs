-- Marca cada Partida com o instante do último reprocessamento bem-sucedido (cmd_reprocess).
--
-- Motivação: o reprocess completo (266 Partidas elegíveis) estourou o timeout de
-- 300min do workflow e cobriu só 93 — sem essa marca, rodar de novo repetiria boa
-- parte das mesmas 93 em vez de avançar, porque a query de reprocess não tinha
-- ORDER BY nenhum (ordem não determinística). Com reprocessed_at, a query passa a
-- ordenar NULLS FIRST (nunca reprocessadas primeiro, depois as mais antigas) — cada
-- nova rodada sempre avança, e fica seguro rodar em lotes sucessivos até cobrir o
-- histórico inteiro.
alter table matches add column reprocessed_at timestamptz;
