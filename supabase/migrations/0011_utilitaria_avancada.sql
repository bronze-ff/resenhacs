-- Comparação com o Leetify (2026-07-11): eles separam dano de HE/molotov em INIMIGO
-- vs TIME (fogo amigo) e têm "Flash Assists" (flash que gerou um kill de um colega).
-- Descobrimos no caminho que he_damage/molotov_damage (0006) somavam TUDO junto —
-- fogo amigo incluído — o que é enganoso (um jogador podia parecer "bom com HE" só
-- por acertar o próprio time). he_damage/molotov_damage passam a ser só dano em
-- INIMIGO a partir de agora; os dois campos novos guardam o fogo amigo à parte.
alter table match_players
  add column he_team_damage integer not null default 0,
  add column molotov_team_damage integer not null default 0,
  add column flash_assists integer not null default 0;
