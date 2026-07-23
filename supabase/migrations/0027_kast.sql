-- KAST: % de rounds em que o jogador teve Kill, Assist, Sobreviveu ou foi
-- vingado (Traded) — estilo Leetify/HLTV. Nullable: partidas antigas
-- (processadas antes dessa coluna existir) ficam sem o dado até reprocessar.
alter table match_players add column kast_pct numeric;
