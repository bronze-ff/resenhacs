-- Biblioteca automática de granadas: o lineup útil sem vídeo nem cadastro manual.
--
-- thrower_x/y e target_x/y continuam em coordenada de RADAR (0..1). Aqui entram as
-- coordenadas de MUNDO do arremesso (origem do jogador no tick do weapon_fire, mesma
-- referência que o `setpos` do console aceita) e do ponto onde a granada estourou,
-- pro comando de treino `setpos X Y Z; setang PITCH YAW 0` (yaw/pitch já existem).
--
-- replay_frame: índice do frame dentro do round no Replay 2D em que a granada estoura
-- — o link "Ver no Replay 2D" usa pra cair no momento certo.
--
-- Tudo nullable: lineups gravadas antes deste deploy não têm esses dados; só demos
-- novas/reprocessadas preenchem. Tabela já tem RLS e grants revogados (0053).
alter table lineups
  add column thrower_world_x numeric,
  add column thrower_world_y numeric,
  add column thrower_world_z numeric,
  add column target_world_x numeric,
  add column target_world_y numeric,
  add column target_world_z numeric,
  add column replay_frame int;

-- O agrupamento automático lê por mapa e filtra por lado/tipo.
create index lineups_map_lado_tipo_idx on lineups (map, lado, tipo);
