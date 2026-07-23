-- Um erro transitório da CDN da Valve (502/503, timeout de rede) durante o fetch
-- marcava a Partida como 'failed' PERMANENTE na primeira falha, sem retry nenhum
-- (aconteceu de verdade em 2026-07-22, share_code CSGO-t7Wnv-cjwub-UOS5t-iEfz2-ZLhnL,
-- resolvido manualmente resetando status pra 'pending'). `tentativas`/`erro` dão ao
-- Coletor o que ele precisa pra tentar de novo sozinho antes de desistir — mesmo padrão
-- já usado em faceit_pendentes/uploads_pendentes (ver coletor/src/coletor/db.py
-- falhar_fetch_pendente).
alter table matches add column if not exists tentativas int not null default 0;
alter table matches add column if not exists erro text;
