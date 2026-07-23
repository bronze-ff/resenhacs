-- Winrate por lado (CT/T) por mapa (FIL-51): o schema só guardava o time FIXO A/B
-- (match_players.team, rounds.winner_team) — não o lado físico, que troca no
-- intervalo. side_a = lado (CT ou T) que o time A ocupava NAQUELE round; o time B é
-- sempre o oposto. Nullable: partidas já gravadas ficam sem até serem reprocessadas
-- (mesmo padrão do round decisivo/win_reason — dado só disponível reparseando o .dem).
alter table rounds add column side_a text check (side_a in ('CT', 'T'));
