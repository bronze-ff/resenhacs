-- Auditoria finding #3: logout só limpava o cookie no navegador — o JWT em si nunca era
-- invalidado no servidor, continuava 100% válido até expirar (7 dias). Se o cookie
-- vazasse por qualquer via fora do navegador da vítima, quem pegou o valor continuaria
-- autenticado por até 7 dias mesmo após o "logout".
--
-- tokens_validos_apos marca o instante do último logout — requireAuth (middleware.js)
-- passa a comparar o `iat` (issued at, em segundos) do JWT contra essa coluna e rejeita
-- qualquer token emitido ANTES dela.
alter table players add column if not exists tokens_validos_apos timestamptz;
