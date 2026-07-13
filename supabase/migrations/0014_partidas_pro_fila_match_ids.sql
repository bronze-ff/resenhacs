-- Um .rar do HLTV pode trazer varios mapas de uma serie (Bo3/Bo5) — cada um vira uma
-- Partida separada. match_id (coluna original) guarda só a primeira, pra manter
-- compatibilidade com quem já lê essa coluna; match_ids guarda TODAS.
alter table partidas_pro_fila
  add column match_ids uuid[] not null default '{}';
