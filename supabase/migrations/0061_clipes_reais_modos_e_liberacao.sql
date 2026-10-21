-- Clipe real (DEMO-SLAP) com modos, e Jogador Premium.
--
-- clipes_reais.modo: o que o pedido grava.
--   clipe    = kills escolhidas, na visão de quem matou ou de quem morreu
--   fails    = mortes do Jogador, na visão dele
--   coaching = cada morte duas vezes: na visão do Jogador e na de quem matou
--   cheater  = kills de um suspeito, na visão dele, com X-Ray
-- Pedido antigo é 'clipe'.
--
-- players.premium: o admin marca quem apoia o site. Premium ganha a badge ao lado do
-- nick e pode pedir clipe real, que gasta crédito pago da DEMO-SLAP. Super admin
-- sempre pode pedir.
alter table clipes_reais add column modo text not null default 'clipe'
  check (modo in ('clipe', 'fails', 'coaching', 'cheater'));

alter table players add column premium boolean not null default false;
