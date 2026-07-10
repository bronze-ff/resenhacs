-- Digital de conteúdo da Partida (mapa + placar + jogadores com K/D, ver
-- coletor db.match_fingerprint): a mesma partida chegando por dois caminhos
-- (upload manual sem share code + download automático do bot) cai na mesma
-- linha em vez de duplicar no feed.
alter table matches add column fingerprint text;
create unique index idx_matches_fingerprint on matches (fingerprint) where fingerprint is not null;
