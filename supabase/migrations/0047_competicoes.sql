-- Nova aba Competições (docs/superpowers/specs/2026-07-22-competicoes-clipes-design.md):
-- pontuação de clipe passa a ser granular (kills+headshots+clutch+variedade de armas,
-- calculada uma vez no webhook da Allstar) em vez dos 16 valores fixos por `kind` —
-- gravada aqui pra não recalcular toda hora e pro histórico ficar estável mesmo se a
-- fórmula mudar nervamente de novo.
alter table allstar_clips add column pontuacao_total int;
alter table allstar_clips add column pontuacao_detalhe jsonb;

create table competicoes (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null,
  descricao             text not null default '',
  premio_descricao      text not null default '',
  data_inicio           timestamptz not null,
  data_fim              timestamptz not null,
  limite_diario         int not null default 2,
  limite_total          int not null default 10,
  minimo_para_rankear   int not null default 3,
  vencedor_steam_id64   text references players(steam_id64),
  tradelink_vencedor    text,
  criado_por            text not null references players(steam_id64),
  criado_em             timestamptz not null default now(),
  constraint periodo_valido check (data_fim > data_inicio)
);

create table competicao_submissoes (
  id              uuid primary key default gen_random_uuid(),
  competicao_id   uuid not null references competicoes(id) on delete cascade,
  allstar_clip_id uuid not null references allstar_clips(id) on delete cascade,
  steam_id64      text not null references players(steam_id64),
  enviado_em      timestamptz not null default now(),
  unique (competicao_id, allstar_clip_id)
);
create index idx_competicao_submissoes_competicao on competicao_submissoes (competicao_id);
create index idx_competicao_submissoes_jogador on competicao_submissoes (competicao_id, steam_id64);
