-- Migração destrutiva FINAL do refactor "amizades substituem grupos" (spec 2026-07-21).
--
-- ATENÇÃO — ORDEM DE DEPLOY: só rodar depois que o server, o client e o Coletor pararam
-- de referenciar `group_id` / `groups` / `group_members` / `group_invites` /
-- `discord_notifications` / `players.grupo_ativo_id` / `players.ranking_publico`, e essa
-- versão do código já está deployada e estável em produção. Este arquivo é o ÚLTIMO passo
-- (Task 18) de um plano de 18 tasks; as Tasks 1-17 (migração aditiva 0037_amizades.sql +
-- todo o código de server/client/Coletor) precisam estar em produção ANTES desta rodar.
-- Se esta migração rodar antes do deploy do código novo, qualquer instância antiga ainda
-- em produção quebra na hora (ex.: insert em `matches.group_id` not-null que não existe
-- mais). Aplicar manualmente, fora do fluxo automático, só quando essa condição estiver
-- confirmada.
--
-- `friendships` (0037_amizades.sql) e `players.conta_criada_em` são o novo schema
-- permanente e NÃO são tocados aqui.
--
-- drop column/table if exists: idempotente se rodar duas vezes, e tolerante a uma
-- limpeza manual parcial que já tenha rodado antes.

-- Ranking público (removido da app, Task 9): coluna some.
alter table players drop column if exists ranking_publico;

-- group_id nas partidas e filas: visibilidade agora é só por amizade (Tasks 5-8),
-- ninguém mais lê essas colunas.
alter table matches drop column if exists group_id;
alter table uploads_pendentes drop column if exists group_id;
alter table faceit_pendentes drop column if exists group_id;

-- Grupo ativo do jogador: conceito morto (Tasks 11/14).
alter table players drop column if exists grupo_ativo_id;

-- Discord por grupo: tabela de idempotência do webhook (Task 11). Tem FK pra
-- groups(id) on delete cascade, mas dropamos explícito e na ordem certa mesmo assim.
drop table if exists discord_notifications;

-- Convites, membros e o próprio grupo (nessa ordem, pros FK dependents irem primeiro).
-- `groups.discord_webhook_url` (0033_discord_webhook.sql) vai junto com a tabela.
drop table if exists group_invites;
drop table if exists group_members;
drop table if exists groups;
