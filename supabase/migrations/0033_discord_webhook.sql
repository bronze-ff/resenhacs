-- Webhook do Discord por grupo (item 6 do ROADMAP): quando o Coletor processa uma
-- Partida nova, posta um resumo automático no canal configurado pelo admin do grupo.
alter table groups add column discord_webhook_url text;

-- Idempotência: uma linha por (partida, grupo) já notificado, pra não duplicar aviso
-- em reprocessamento. Sem coluna própria em `matches` porque agora uma partida pode
-- notificar vários grupos (visibilidade por participação).
create table discord_notifications (
  match_id uuid not null references matches(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (match_id, group_id)
);
