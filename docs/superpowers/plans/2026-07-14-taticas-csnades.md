# Táticas estilo csnades (Fase 3) — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** aba Táticas vira um playbook curado no estilo csnades (prints do usuário em `docs/superpowers/specs/2026-07-13-taticas-csnades-referencia.md` — leia antes de qualquer task): navegação mapa-first, cards com mini-radar das granadas da tática, detalhe com abas Overview/Jogador N, cada papel de jogador linkando granadas da biblioteca curada (`lineups_curados`).

**Decisões:**
- O fluxo antigo (sugerir tática por round de partida + aprovação no Admin) NÃO morre: as táticas antigas aprovadas aparecem numa seção secundária "Do grupo (replays)" na página do mapa, com o card/replay que já existia. O botão "Sugerir tática" na Partida e a aprovação no Admin continuam intactos.
- Tudo nasce responsivo (Global Constraints do plano mobile valem aqui: 390px sem scroll de body, touch ≥40px, modais tela cheia no mobile, desktop com sidebars).
- Quem cria/edita táticas curadas: admin. Visualização: qualquer logado.

## Global Constraints

- Tipos de tática: `execute`, `fake`, `explode`, `rush`, `split`, `setup`. Local: `A`, `B`, `MID`. Armas: `full`, `eco`, `force`, `pistol`. Lados: `T`, `CT`.
- SQL parametrizado/allowlist (padrão `granadas.js`). UI pt-BR, tokens do projeto.
- Mapas do pool: os 9 de `MAPAS_POOL` (`ExplorarMapas.jsx`).

### Task T1: migration + API `/api/taticas-curadas`

**Files:** `supabase/migrations/0018_taticas_curadas.sql`, `site/server/src/routes/taticasCuradas.js` (novo), `site/server/test/taticasCuradas.test.js` (novo), `site/server/src/app.js` (mount).

Migration:
```sql
create table taticas_curadas (
  id uuid primary key default gen_random_uuid(),
  map text not null,
  lado text not null check (lado in ('T', 'CT')),
  tipo text not null check (tipo in ('execute', 'fake', 'explode', 'rush', 'split', 'setup')),
  local text not null check (local in ('A', 'B', 'MID')),
  armas text not null default 'full' check (armas in ('full', 'eco', 'force', 'pistol')),
  titulo text not null,
  descricao text,
  criado_por text references players(steam_id64),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index on taticas_curadas (map, lado);

create table taticas_papeis (
  id uuid primary key default gen_random_uuid(),
  tatica_id uuid not null references taticas_curadas(id) on delete cascade,
  ordem int not null,
  descricao text not null,
  obrigatorio boolean not null default true
);
create index on taticas_papeis (tatica_id);

create table taticas_papel_granadas (
  papel_id uuid not null references taticas_papeis(id) on delete cascade,
  lineup_curado_id uuid not null references lineups_curados(id) on delete cascade,
  ordem int not null default 0,
  primary key (papel_id, lineup_curado_id)
);
```
(controlador aplica em produção; implementador só cria o arquivo)

Rotas (`createTaticasCuradasRouter({ db, requireAuth })`):
- `GET /` (logado): filtros `map` (regex), `lado`/`tipo`/`local`/`armas` (allowlists). Devolve lista com papéis e granadas ANINHADOS de uma vez (o front monta thumbs e o detalhe sem 2ª chamada). Estratégia de queries: 1ª query taticas filtradas; 2ª query papéis `where tatica_id = any($1)`; 3ª query granadas dos papéis com JOIN em `lineups_curados` trazendo o shape camelCase COMPLETO da granada (mesmos campos do `paraCamel` de granadas.js — replique a função ou importe). Montagem em JS. Shape final:
```json
[{ "id", "map", "lado", "tipo", "local", "armas", "titulo", "descricao",
   "papeis": [{ "id", "ordem", "descricao", "obrigatorio",
     "granadas": [{ ...shape do GET /api/granadas... , "ordem" }] }] }]
```
- `GET /contagem` (logado): `select map, count(*) as total from taticas_curadas group by map`.
- `POST /` (admin): body `{map, lado, tipo, local, armas, titulo, descricao, papeis: [{ordem, descricao, obrigatorio, granadaIds: [uuid]}]}`. Valida allowlists, titulo obrigatório, papeis array (pode ser vazio), granadaIds array de strings. Insere tática + papéis + vínculos numa sequência de queries (sem transação explícita não — USE transação: `await db.query('begin')` ... `commit`/`rollback` em try/catch, padrão simples).
- `PUT /:id` (admin): substitui tudo (update tática + delete papéis (cascade limpa vínculos) + re-insere papéis/vínculos), mesma validação, `atualizado_em = now()`, 404 se não existe. Transação.
- `DELETE /:id` (admin): delete com returning, 404 se não achou.

Testes no padrão `appWith(handlers)` (copie de `test/granadas.test.js`): 401 anônimo, 403 não-admin no POST/PUT/DELETE, GET aninha papéis+granadas (mock das 3 queries), POST valida allowlists (tipo inválido = 400) e usa transação (begin/commit presentes nas calls), PUT 404, DELETE feliz. Rode a suíte INTEIRA.

Commit: `feat: tabelas e API de taticas curadas (playbook estilo csnades)`.

### Task T2: UI — landing + página do mapa + cards com mini-radar

**Files:** `site/client/src/pages/Taticas.jsx` (reescrever), `site/client/src/components/taticas/PaginaMapaTaticas.jsx` (novo), `site/client/src/components/taticas/CardTatica.jsx` (novo), `site/client/src/components/taticas/MiniRadarTatica.jsx` (novo).

- `Taticas.jsx` vira orquestrador igual `Granadas.jsx`: sem `?map=` → landing reutilizando `ExplorarMapas` NÃO — o ExplorarMapas mostra badges de tipo de granada; crie uma variação leve: aceite em `ExplorarMapas` uma prop opcional `badges` (função `(map) => ReactNode`) e uma prop `subtitulo`; quando ausentes, comportamento atual (zero mudança pra Granadas). Táticas passa badges de contagem simples ("N táticas") vindas de `GET /api/taticas-curadas/contagem`.
- `PaginaMapaTaticas.jsx`: sidebar (Trocar mapa, Trocar lado T/CT, Tipo [Todas + 6], Local [Todas/A/B/MID], Armas [Todas + 4]) + grid de `CardTatica` (contagem no rodapé "N Táticas"). Filtros de lado refazem fetch (`?map=&lado=`); tipo/local/armas client-side. Mobile: sidebar compacta em `flex-wrap` no topo (padrão M4).
- `CardTatica`: `MiniRadarTatica` (SVG pequeno, imagem do radar + marcadores `MarcadorTipo`-like das granadas de TODOS os papéis — exporte `MarcadorTipo` de `RadarGranadas.jsx` pra reusar em vez de duplicar) + badges topo (local + tipo), badge nº de papéis, título embaixo. Clique → abre detalhe (T3).
- Seção secundária "Do grupo (replays)" abaixo do grid: as táticas ANTIGAS aprovadas (`GET /api/taticas?map=`, endpoint já existente) renderizadas com o card antigo de `Taticas.jsx` atual (mova o componente `TaticaCard` antigo pra `components/taticas/CardTaticaReplay.jsx` sem mudar comportamento).

Commit: `feat: Taticas mapa-first com cards de mini-radar (estilo csnades)`.

### Task T3: UI — detalhe da tática (Overview + abas por jogador)

**Files:** `site/client/src/components/taticas/DetalheTatica.jsx` (novo), integração em `PaginaMapaTaticas.jsx`.

Modal (tela cheia no mobile, `lg:max-w-4xl` centrado no desktop — padrão M4):
- Header: título + badges (tipo, armas, lado, nº papéis) + fechar.
- Abas: `Overview` | `Jogador 1..N` (uma por papel, ordenados por `ordem`).
- Overview: radar SVG (reuso do padrão `RadarGranadas` em modo leitura — pode instanciar `RadarGranadas` com `lineups` = todas as granadas de todos os papéis e `onSelecionar` abrindo o `DetalheGranada` existente) à esquerda; à direita DESCRIÇÃO + lista de papéis (card por papel com badge "necessário"/"opcional" + descrição).
- Aba de jogador: radar só com as granadas daquele papel; à direita a descrição do papel e, pra cada granada linkada, um bloco compacto clicável (título + badges + thumb) que abre o `DetalheGranada` (o modal de granada abre POR CIMA do de tática — z-index maior; confira os z usados).
- Layout empilha no mobile (`flex-col lg:flex-row`).

Commit: `feat: detalhe de tatica com Overview e abas por jogador (granadas linkadas)`.

### Task T4: UI — builder admin (criar/editar/excluir tática)

**Files:** `site/client/src/components/taticas/FormTatica.jsx` (novo), integração em `PaginaMapaTaticas.jsx` (botão "Adicionar tática" admin) e `DetalheTatica.jsx` (botões Editar/Excluir admin).

- Form modal (tela cheia mobile): título, descrição, selects lado/tipo/local/armas; lista dinâmica de papéis (adicionar/remover papel; cada papel: descrição textarea + toggle obrigatório + seletor de granadas). Seletor de granadas do papel: busca as `lineups_curados` do mapa+lado atual (`GET /api/granadas?map=&lado=`) e mostra checkboxes compactos (título + tipo); granadas marcadas = `granadaIds` do papel, com ordem pela sequência de marcação (simples: índice no array).
- Salvar: POST ou PUT com o payload aninhado da T1. Excluir com `window.confirm`.
- Commit: `feat: admin monta tatica com papeis e granadas da biblioteca`.

### Task T5: verificação integrada (controlador)

- Suítes completas + build; migration 0018 em produção; push; deploy; revisão final da branch de Táticas (opus) antes do push se o diff acumulado justificar.
