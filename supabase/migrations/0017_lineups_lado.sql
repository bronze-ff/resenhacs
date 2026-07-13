-- Lado (T/CT) do arremessador no momento do arremesso — nullable porque demos
-- processadas antes deste deploy não têm esse dado (coletor antigo não capturava
-- team_num no snapshot do weapon_fire). Só demos reprocessadas/novas preenchem.
alter table lineups add column lado text check (lado in ('T', 'CT'));
