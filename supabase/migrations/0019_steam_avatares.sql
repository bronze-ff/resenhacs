-- Cache compartilhado (por pessoa, não por Partida) do avatar Steam de QUALQUER
-- jogador que já apareceu numa demo — inclusive quem não é do grupo (tabela players
-- só tem avatar de quem fez onboarding). Uma linha por steam_id64, reaproveitada em
-- todas as Partidas em que essa pessoa aparecer.
create table steam_avatares (
  steam_id64 text primary key,
  avatar_url text,
  atualizado_em timestamptz not null default now()
);
