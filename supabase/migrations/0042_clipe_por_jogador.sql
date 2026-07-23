-- Clipe do Allstar passa de "por highlight" pra "por jogador+partida".
--
-- Descoberta empírica (2026-07-21, dashboard Allstar + sondagem real na API, chave
-- RESENHACS): só os use cases POTG e BP estão habilitados na nossa conta (PMH/MH/SH
-- devolvem 403 "Failed to find use case"). Nenhum dos dois aceita mirar um round
-- específico — POTG nem aceita steamId (escolhe a melhor jogada da PARTIDA INTEIRA,
-- de qualquer jogador — a causa real de um bug reportado: pedimos o clipe do clutch
-- do bronze e veio o 3K de outro jogador). BP aceita steamId, então garante que o
-- clipe é sempre daquele jogador — vira "gerar o melhor clipe da partida pra esse
-- jogador" em vez de "gerar o clipe desse round", no máximo 1 por (match, jogador).
--
-- highlight_id fica nullable (clipes novos não nascem mais de um highlight nosso,
-- a Allstar escolhe o momento sozinha) mas os 2 clipes já gerados continuam
-- linkados (preserva compatibilidade com a aba Clipes agregada do site).
alter table allstar_clips alter column highlight_id drop not null;
alter table allstar_clips add column match_id uuid references matches(id) on delete cascade;
alter table allstar_clips add column steam_id64 text;
alter table allstar_clips add column round_number int;

update allstar_clips ac set match_id = h.match_id, steam_id64 = h.steam_id64, round_number = h.round_number
from highlights h where h.id = ac.highlight_id;

alter table allstar_clips add constraint allstar_clips_match_jogador_unico unique (match_id, steam_id64);
create index idx_allstar_clips_match on allstar_clips (match_id);
