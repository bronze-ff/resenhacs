-- Amizade mútua substitui o conceito de grupo (ver spec 2026-07-21). Esta migração é
-- ADITIVA: cria a tabela e faz o backfill; o drop de groups/group_members/group_id vem
-- só depois que o código para de usá-los (migração 0038).

-- Par canônico player_a < player_b: uma linha por par, sem A↔B duplicado.
create table friendships (
  player_a      text not null references players(steam_id64),
  player_b      text not null references players(steam_id64),
  status        text not null default 'pending',   -- 'pending' | 'accepted'
  requested_by  text not null references players(steam_id64),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  primary key (player_a, player_b),
  check (player_a < player_b)
);
create index idx_friendships_b on friendships (player_b);

-- Marcador durável de "conta real" (quem logou), pra distinguir de adversário raspado
-- na tabela players. Backfill: quem está em group_members hoje é conta real.
alter table players add column conta_criada_em timestamptz;
update players p set conta_criada_em = now()
  where exists (select 1 from group_members gm where gm.steam_id64 = p.steam_id64);

-- Backfill de amizades: todo par distinto de membros do MESMO grupo vira amigo accepted.
-- least/greatest garantem a ordem canônica; on conflict cobre pessoas em 2 grupos.
insert into friendships (player_a, player_b, status, requested_by, created_at, accepted_at)
select distinct
  least(g1.steam_id64, g2.steam_id64),
  greatest(g1.steam_id64, g2.steam_id64),
  'accepted',
  least(g1.steam_id64, g2.steam_id64),
  now(),
  now()
from group_members g1
join group_members g2 on g1.group_id = g2.group_id and g1.steam_id64 < g2.steam_id64
on conflict (player_a, player_b) do nothing;

-- O código novo (Tasks 2-8, já escrito nesta branch) para de popular `group_id` em
-- matches/uploads_pendentes/faceit_pendentes — visibilidade agora é só por amizade.
-- Essas 3 colunas continuam `not null` (0020_grupos.sql / 0026_uploads_pendentes.sql /
-- 0030_faceit_fase_b.sql), sem default. Sem relaxar aqui, a janela de deploy entre "código
-- novo em produção" e "0038_remove_grupos.sql dropar as colunas" quebraria todo insert
-- nessas 3 tabelas com violação de not-null. Ainda é seguro incluir isso nesta migração
-- aditiva: ela relaxa a constraint, não apaga a coluna (isso só acontece no 0038).
alter table matches alter column group_id drop not null;
alter table uploads_pendentes alter column group_id drop not null;
alter table faceit_pendentes alter column group_id drop not null;
