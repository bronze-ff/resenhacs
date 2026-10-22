-- Expansão compatível: o site antigo omite as colunas e continua com origem 'site'.
-- Aplicar com o Filippe antes de ativar X-SRV/X-COL. Não aplica nem migra links antigos.
-- Rollback operacional: desativar envios da extensão e drenar sua fila antes de
-- reverter os leitores; remover estas colunas exige uma migration nova separada.
alter table uploads_pendentes
  add column origem_url text,
  add column origem text not null default 'site' check (origem in ('site', 'extensao'));
