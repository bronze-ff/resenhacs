-- Fecha a API pública do Supabase (PostgREST) pra TODAS as tabelas do schema public.
--
-- A 0001 ligou RLS e revogou os grants de anon/authenticated, mas só nas tabelas que
-- existiam naquela hora; 0008-0010 repetiram o revoke pras suas. Da 0011 em diante as
-- tabelas novas nasceram com os grants default do Supabase (anon/authenticated podem
-- ler e escrever) e sem RLS — 22 tabelas, entre elas friendships, faceit_pendentes,
-- uploads_pendentes e competicao_submissoes. Com a anon key do projeto, qualquer um
-- leria ou alteraria essas tabelas direto pela REST API, sem passar pelo nosso servidor.
--
-- O site e o Coletor conectam como `postgres` (dono das tabelas), que não é afetado por
-- RLS sem FORCE nem pelos revokes abaixo — nada muda pro app.

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Tabela/sequence/função criada daqui pra frente (por `postgres`, que é quem roda as
-- migrations) já nasce sem grant pra anon/authenticated — o esquecimento da 0011 em
-- diante não se repete. RLS ainda precisa de `enable` explícito em cada tabela nova.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
