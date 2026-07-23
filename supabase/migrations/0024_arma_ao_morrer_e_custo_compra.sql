-- Duas colunas que faltavam pra responder "com que arma ele estava jogando quando
-- morreu" (diferente da arma de quem matou) e "quanto custou esse item especifico".
alter table kill_positions add column victim_weapon text;
alter table match_player_purchases add column cost integer;
