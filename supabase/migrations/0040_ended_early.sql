-- Motivo do placar: partidas encerradas antes do fim (desistência/forfeit técnico).
--
-- Descoberta empírica (2026-07-21, partida 44a32a9e/de_mirage 4x1, comparada com uma
-- partida normal 13x7): tentamos usar o gap do round_officially_ended do round
-- decisivo como sinal de abandono, mas esse gap existe TAMBÉM numa partida 100%
-- normal (o evento do round que fecha o mapa nunca dispara, ver coletor/src/coletor/
-- parse.py). O sinal confiável é o PLACAR: o formato competitivo/premier (MR12) só
-- termina com um time batendo 13 rounds — os dois lados abaixo de 13 numa partida já
-- "parsed" (a Valve só libera o demo depois que a partida termina de verdade) só é
-- possível por abandono/forfeit técnico do servidor.
--
-- abandoned_by_steam_id64 é best-effort (ver coletor/src/coletor/parse.py:
-- _detectar_abandono) — só preenchido quando dá pra atribuir a EXATAMENTE 1 jogador
-- (o último a desconectar sem retomar atividade, antes do fim real da partida).
-- Nullable mesmo quando ended_early=true: ambíguo (2+ candidatos) fica sem atribuição.
-- SEM FK pra players: quem abandona pode ser um adversário sem conta no Resenha (não
-- está em `players`, só em `match_players` — que também não tem FK nesse campo pelo
-- mesmo motivo. Descoberto na prática: o abandonador da partida-teste 44a32a9e não
-- tinha conta cadastrada).
alter table matches add column ended_early boolean not null default false;
alter table matches add column abandoned_by_steam_id64 text;

-- Backfill retroativo: só pro placar (não precisa reprocessar nenhum demo). Escopado
-- a valve_mm — outras fontes (FACEIT, Partidas Pro, upload manual) têm formatos de
-- vitória diferentes (ex.: Wingman bate 9, não 13) e não foram validados aqui.
update matches set ended_early = true
where source = 'valve_mm' and status = 'parsed' and score_a < 13 and score_b < 13;
