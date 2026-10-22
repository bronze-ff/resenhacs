-- A cota de 24 h filtra por Jogador e intervalo de data apenas nos envios da extensão.
create index if not exists uploads_pendentes_extensao_jogador_data_idx
  on uploads_pendentes (adicionado_por, adicionado_em)
  where origem = 'extensao';
