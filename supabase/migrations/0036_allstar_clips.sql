-- Integração com clipes de vídeo real do Allstar (ADR-0004) — teste restrito a uma
-- allowlist de steamId64 até o preço por clipe ser confirmado com o suporte deles.
-- Um Highlight pode ter no máximo 1 pedido de clipe (request_id é a chave de
-- correlação com o webhook de retorno, ver docs/allstar/Allstar Docs _ webhook.pdf).
create table allstar_clips (
  id                uuid primary key default gen_random_uuid(),
  highlight_id      uuid not null references highlights(id) on delete cascade,
  request_id        text not null unique,
  status            text not null default 'Submitted', -- Submitted | Processed | Error
  clip_url          text,
  clip_title        text,
  clip_snapshot_url text,
  error_message     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index idx_allstar_clips_highlight on allstar_clips (highlight_id);
