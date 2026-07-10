-- Índice do frame do Replay 2D em que o highlight acontece (casa com replay.rounds[].kills[].t
-- e replay.rounds[].clutch.t). Permite abrir o Replay 2D já no momento exato ao clicar num
-- Highlight na tela da Partida. Null quando o replay não pôde ser gerado.
alter table highlights add column frame integer;
