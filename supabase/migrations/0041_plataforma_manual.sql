-- Tag opcional de qual plataforma/comunidade foi jogada uma partida enviada
-- manualmente (Enviar Demo) — sem integração oficial com elas (diferente de
-- valve_mm/faceit, que a gente puxa automático), só um rótulo informativo que o
-- próprio jogador escolhe no upload. Lista fixa por enquanto (2026-07-21):
-- 'faceit' | 'gamers_club' | 'xplay_gg'. NULL pra tudo que não é upload manual
-- ou onde o jogador não informou.
alter table uploads_pendentes add column plataforma_manual text;
alter table matches add column plataforma_manual text;
