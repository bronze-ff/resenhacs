-- Fix do /sync-status: partidas 'pending'/'failed' ainda não têm match_players (não
-- foram parseadas), então partidaVisivelExpr (que checa participação/amizade via
-- match_players) nunca dá match pra elas — os contadores zeravam pra todo viewer.
--
-- discovered_by grava o steamId de quem descobriu a partida (o jogador cujo polling
-- encontrou o share code, ver coletor/src/coletor/main.py:cmd_discover) — permite
-- escopar pending/failed por "descoberto por mim ou por um amigo meu", sem precisar
-- de match_players. Nullable: uploads manuais e a fila FACEIT não passam por aqui,
-- só a descoberta automática.
alter table matches add column discovered_by text references players(steam_id64);
