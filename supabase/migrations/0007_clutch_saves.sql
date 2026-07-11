-- Saves em situação de clutch: o jogador ficou por último vivo, NÃO venceu o round,
-- mas sobreviveu (salvou a arma) — o "SAVE" do Leetify. clutch_attempts continua sendo
-- o total de situações de clutch (vencidas + perdidas + salvas).
alter table match_players
  add column clutch_saves integer not null default 0;
