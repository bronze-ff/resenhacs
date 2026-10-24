-- Tira EXECUTE de public.rls_auto_enable() de anon, authenticated e public.
--
-- A função não é criada por nenhuma migration deste repositório. O Supabase a
-- instala no schema public como event trigger, sem argumentos e com retorno
-- event_trigger, para ligar RLS em tabela nova. O default do Postgres concede
-- EXECUTE a PUBLIC; anon e authenticated herdam esse grant e a função aparece
-- em /rest/v1/rpc/rls_auto_enable. A 0053 revogou anon e authenticated nas
-- funções que já existiam, mas não revoga PUBLIC e não alcança função criada
-- depois por outro papel.
--
-- Nenhum código, workflow, trigger, cron ou chamada RPC deste repositório
-- executa essa função. O event trigger segue com o dono (superuser), que não
-- depende desse grant. REVOKE é idempotente e não dropa a função.

revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
