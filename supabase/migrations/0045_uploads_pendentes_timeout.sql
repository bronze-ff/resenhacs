-- Auditoria finding #8: um upload manual preso em status 'processando' porque o processo
-- do Coletor morreu no meio (crash do runner, timeout do job do Actions) ficava
-- 'processando' pra sempre — nada revertia pra 'pendente' pra tentar de novo. `tentativas`
-- e `processando_desde` dão ao Coletor o que ele precisa pra detectar isso sozinho no
-- início de cada rodada (ver coletor/src/coletor/db.py reverter_uploads_travados).

alter table uploads_pendentes add column if not exists processando_desde timestamptz;
alter table uploads_pendentes add column if not exists tentativas int not null default 0;
