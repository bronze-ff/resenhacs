alter table partidas_pro_fila alter column hltv_url drop not null;
alter table partidas_pro_fila add column arquivo_r2_key text;
alter table partidas_pro_fila add constraint partidas_pro_fila_origem_check
  check (hltv_url is not null or arquivo_r2_key is not null);
