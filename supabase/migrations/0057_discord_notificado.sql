-- Marca quando a Partida já foi anunciada no Discord (coletor/src/coletor/discord.py).
-- Sem isso, reingerir uma Partida (reprocessamento, demo enviada depois) postava de novo.
alter table matches add column if not exists discord_notificado_em timestamptz;

-- Partidas que já existem não devem ser anunciadas quando forem reprocessadas.
update matches set discord_notificado_em = now() where discord_notificado_em is null;
