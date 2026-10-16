-- Importação FACEIT que funcione (descoberta com `from`, stats-only mais rico e
-- re-tentativa da Demo). Só colunas novas em tabelas que já existem; RLS e grants
-- dessas tabelas já vêm da 0053.

-- Fila: data da Partida (base da janela de descoberta e da janela de 4 semanas da
-- Demo) e a re-tentativa espaçada do download. proxima_tentativa_demo não nula =
-- a Partida entrou só com estatísticas e o Coletor ainda vai tentar baixar a Demo.
alter table faceit_pendentes
  add column finished_at timestamptz,
  add column tentativas_demo integer not null default 0,
  add column proxima_tentativa_demo timestamptz,
  add column sem_demo_desde timestamptz,
  add column erro_demo text;

create index idx_faceit_pendentes_retry_demo on faceit_pendentes(proxima_tentativa_demo)
  where proxima_tentativa_demo is not null;

-- Contadores que só a API da FACEIT entrega no caminho sem Demo. Nulos quando a
-- Partida veio só da Demo; o upsert de match_players não mexe neles, então
-- sobrevivem quando a Demo chega depois.
alter table match_players
  add column mvps integer,
  add column triple_kills integer,
  add column quadro_kills integer,
  add column penta_kills integer;

-- "Última sincronização" em Minha conta: hora da última descoberta que rodou sem erro
-- para esse Jogador.
alter table players add column faceit_sincronizado_em timestamptz;

-- Backfill: linhas antigas da fila ganham a data da Partida já gravada.
update faceit_pendentes fp
   set finished_at = m.played_at
  from matches m
 where m.faceit_match_id = fp.faceit_match_id
   and fp.finished_at is null;

-- Partidas FACEIT recentes que entraram sem Demo voltam pra re-tentativa (a FACEIT
-- guarda a Demo por ~4 semanas). Se a chave ainda não tem a Downloads API, o Coletor
-- só reagenda.
update faceit_pendentes fp
   set proxima_tentativa_demo = now(),
       sem_demo_desde = coalesce(fp.sem_demo_desde, now())
  from matches m
 where m.faceit_match_id = fp.faceit_match_id
   and m.tem_demo = false
   and m.played_at > now() - interval '28 days';
