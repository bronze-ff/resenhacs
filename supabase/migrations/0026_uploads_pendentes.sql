-- Fila de uploads manuais de demo (qualquer membro do grupo, via "Enviar Demo" no site):
-- o arquivo sobe direto pro R2 via URL pré-assinada (a Vercel não aguenta receber o .dem
-- síncrono no corpo da request), fica pendente aqui, e o Coletor (GitHub Actions, a cada
-- 30 min) baixa do R2 e processa. Mesmo padrão de partidas_pro_fila, mas escopado por
-- group_id em vez de restrito a super admin.
create table uploads_pendentes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id),
  adicionado_por text not null,
  arquivo_r2_key text not null,
  share_code text,
  played_at timestamptz,
  status text not null default 'pendente',
  match_id uuid references matches(id),
  erro text,
  adicionado_em timestamptz not null default now()
);

create index uploads_pendentes_status_idx on uploads_pendentes (status);
