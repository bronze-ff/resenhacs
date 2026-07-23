-- Multi-tenancy: um jogador pode estar em vários grupos; toda Partida pertence a um.
-- Backfill: a whitelist de hoje vira o primeiro grupo real, todo mundo cadastrado
-- entra como membro dele, e toda Partida existente ganha esse group_id.

create table groups (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_por text not null references players(steam_id64),
  criado_em timestamptz not null default now()
);

create table group_members (
  group_id uuid not null references groups(id) on delete cascade,
  steam_id64 text not null references players(steam_id64),
  role text not null default 'membro' check (role in ('admin', 'membro')),
  entrou_em timestamptz not null default now(),
  primary key (group_id, steam_id64)
);

create table group_invites (
  token uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  criado_por text not null references players(steam_id64),
  criado_em timestamptz not null default now(),
  revogado_em timestamptz
);

alter table players rename column is_admin to is_super_admin;
alter table players add column grupo_ativo_id uuid references groups(id);

alter table matches add column group_id uuid references groups(id);

-- Backfill: 1 grupo com todo mundo que já está em `players`.
do $$
declare
  v_group_id uuid;
  v_dono text;
begin
  select steam_id64 into v_dono from players where is_super_admin = true order by steam_id64 limit 1;
  if v_dono is null then
    select steam_id64 into v_dono from players order by steam_id64 limit 1;
  end if;

  if v_dono is not null then
    insert into groups (nome, criado_por) values ('Grupo original', v_dono) returning id into v_group_id;

    insert into group_members (group_id, steam_id64, role)
    select v_group_id, steam_id64, case when is_super_admin then 'admin' else 'membro' end
    from players;

    update players set grupo_ativo_id = v_group_id;
    update matches set group_id = v_group_id;
  end if;
end $$;

alter table matches alter column group_id set not null;
