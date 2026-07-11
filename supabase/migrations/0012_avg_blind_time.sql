-- "Tempo médio de cegueira" do Leetify não é a média de todo blind event — é a
-- duração do inimigo que ficou MAIS tempo cego POR FLASHBANG, média só sobre as
-- flashbangs que cegaram alguém. Precisa de contagem/soma separadas de
-- enemies_flashed/enemy_flash_duration (que somam TODOS os inimigos atingidos,
-- não só o pior caso de cada flash).
alter table match_players
  add column enemy_flash_landed_count integer not null default 0,
  add column enemy_flash_landed_duration_sum numeric(7, 2) not null default 0;
