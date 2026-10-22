-- Aviso de Clipe pronto e Resenha da semana no Discord (coletor/src/coletor/discord.py,
-- subcomando avisar-discord). O status pronto de um Clipe tem 3 escritores (2 no server),
-- então a marca fica na linha do Clipe, como a 0057 fez em matches.
alter table clipes_reais add column if not exists discord_notificado_em timestamptz;
alter table allstar_clips add column if not exists discord_notificado_em timestamptz;

-- Clipes já prontos não devem ser anunciados. Clipe ainda em processamento fica null
-- e é avisado quando ficar pronto.
update clipes_reais set discord_notificado_em = now()
  where status = 'pronto' and discord_notificado_em is null;
update allstar_clips set discord_notificado_em = now()
  where status = 'Processed' and discord_notificado_em is null;

-- Uma linha por semana postada (semana = segunda-feira, fuso de São Paulo). A chave
-- primária garante um post por semana mesmo com duas execuções ao mesmo tempo.
create table if not exists discord_resenha_semanal (
  semana     date primary key,
  postado_em timestamptz not null default now()
);

-- Mesma postura da 0059: a API pública do Supabase não enxerga a tabela; só o
-- Coletor (conectado como `postgres`) lê e grava.
alter table discord_resenha_semanal enable row level security;
revoke all on discord_resenha_semanal from anon, authenticated;
