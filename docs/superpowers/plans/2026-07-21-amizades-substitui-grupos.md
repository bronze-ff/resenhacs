# Amizades substituem grupos — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o conceito de "grupo" por "amizade mútua entre jogadores" em todo o sistema Resenha, removendo junto o Ranking Público, a aba Times e o webhook do Discord.

**Architecture:** A visibilidade de dados deixa de ser por `group_id` e passa a ser "eu joguei OU sou amigo `accepted` de algum jogador da partida". Uma tabela `friendships` (par canônico `player_a < player_b`) substitui `groups`/`group_members`. O onboarding some: login Steam → Feed direto. Amigos são detectados automaticamente da lista Steam (best-effort) e/ou adicionados manualmente (aceite mútuo). Server (Express/Postgres), client (React/Vite/Tailwind) e Coletor (Python) mudam juntos, com duas migrações: uma **aditiva** (cria `friendships` + backfill) antes de o código mudar, e uma **destrutiva** (dropa grupos/ranking_publico/group_id) só depois de nada mais referenciá-los.

**Tech Stack:** Node/Express, PostgreSQL (Supabase), React 18 + Vite + Tailwind v4, Python 3.13 (Coletor em GitHub Actions), Vitest (server/client), pytest (Coletor).

## Global Constraints

- **Spec fonte:** `docs/superpowers/specs/2026-07-21-amizades-substitui-grupos-design.md` — toda tarefa herda as decisões dela.
- **Par canônico sempre:** toda linha/consulta de `friendships` usa `parCanonico(a, b) -> [menor, maior]` (ordem string). Nunca inserir A→B e B→A separados.
- **Amizade mútua:** pedido nasce `pending`; vira `accepted` só no aceite (ou no auto-friend Steam, que nasce `accepted`).
- **Escopo de visibilidade = eu + amigos diretos accepted.** Não transitivo. Sem exceção pública (não existe mais acesso sem login).
- **Migração destrutiva por último:** dropar `group_id`/`groups`/`group_members`/`grupo_ativo_id`/`ranking_publico` só na Task final, depois que server, client e Coletor pararam de referenciá-los. Migrações em produção são aplicadas pelo controller (Supabase MCP), nunca por subagent.
- **Padrão de teste do server:** `db` é um fake com `query` casada por substring de SQL (ver `test/groups.test.js`). Sem banco real nos testes; SQL é validado por substring.
- **Idioma:** todo código, comentário e cópia de UI em PT-BR, seguindo o estilo do repo (comentários explicam o "porquê").
- **Expressão de visibilidade sobrevive a `.replaceAll('m.', 'mh.')`** — ranking.js/profile.js trocam o alias `m`→`mh` em subqueries de aces. O único token com `m.` na expressão deve ser `<alias>.id`.

---

## File Structure

**Criados:**
- `supabase/migrations/0037_amizades.sql` — aditiva: tabela `friendships`, coluna `players.conta_criada_em`, backfill de ambos a partir de `group_members`.
- `supabase/migrations/0038_remove_grupos.sql` — destrutiva: dropa `group_id`, `groups`, `group_members`, `grupo_ativo_id`, `ranking_publico` (e `discord_notifications`/`discord_webhook_url` via cascade).
- `site/server/src/friendships.js` — `parCanonico` + expressões de visibilidade por viewer (substitui `matchVisibility.js`).
- `site/server/test/friendships.test.js` — testes do módulo.
- `site/server/src/routes/friendships.js` — rotas `/api/amigos`.
- `site/server/test/amigos.test.js` — testes das rotas.
- `site/client/src/pages/Amigos.jsx` — substitui `Jogadores.jsx`.

**Modificados (server):** `auth/middleware.js`, `matchVisibility.js` (deletado), `app.js`, `routes/auth.js`, `routes/matches.js`, `routes/ranking.js`, `routes/recordes.js`, `routes/ladoPorMapa.js`, `routes/sessions.js`, `routes/profile.js`, `routes/clips.js`, `routes/lineups.js`, `routes/curso.js`, `routes/upload.js`, `routes/players.js`.

**Deletados (server):** `routes/groups.js`, `routes/teams.js`, `routes/rankingPublico.js`, `matchVisibility.js`, `test/groups.test.js`, `test/teams.test.js`, `test/rankingPublico.test.js`, `test/matchVisibility.test.js`.

**Modificados (client):** `main.jsx`, `App.jsx`, `auth/AuthContext.jsx`, `components/Shell.jsx`, `pages/Perfil.jsx`, `pages/JogadorPerfil.jsx`, `lib/grupoAtivo.js` (deletado).

**Deletados (client):** `pages/Onboarding.jsx`, `pages/AceitarConvite.jsx`, `pages/RankingPublico.jsx`, `pages/Times.jsx`, `pages/CompararTimes.jsx`, `pages/Jogadores.jsx`.

**Modificados (Coletor):** `coletor/src/coletor/db.py`, `coletor/src/coletor/main.py`, `coletor/src/coletor/transform.py`.

**Deletados (Coletor):** `coletor/src/coletor/discord_notify.py` (+ testes correlatos).

---

## Task 1: Migração aditiva + backfill

Cria `friendships` e `players.conta_criada_em`, popula ambos a partir de `group_members`. **Não** dropa nada (não-quebra: código antigo segue funcionando). Aplicada pelo controller antes das mudanças de código.

**Files:**
- Create: `supabase/migrations/0037_amizades.sql`

- [ ] **Step 1: Escrever a migração**

```sql
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
```

- [ ] **Step 2: Controller aplica em produção e valida contagens**

O controller (não um subagent) aplica via Supabase MCP `apply_migration` e roda, antes e depois, uma checagem de sanidade:

```sql
-- Esperado: friendships.count == número de pares distintos dentro de cada grupo, unido.
select (select count(*) from friendships) as amizades,
       (select count(*) from players where conta_criada_em is not null) as contas_reais;
```

Confirmar que `contas_reais` bate com o total de membros distintos em `group_members` e que `amizades > 0`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0037_amizades.sql
git commit -m "feat: migracao aditiva de amizades (friendships + conta_criada_em + backfill)"
```

---

## Task 2: Módulo `friendships.js` (par canônico + visibilidade por viewer)

Substitui `matchVisibility.js`. Expõe a mesma forma de API (`partidaVisivelExpr/Where/Predicado`) mas escopada por **steamId do viewer** em vez de `groupId`, e sem `partidaPublicaExpr`.

**Files:**
- Create: `site/server/src/friendships.js`
- Create: `site/server/test/friendships.test.js`

**Interfaces:**
- Produces:
  - `parCanonico(a, b) -> [string, string]` (menor, maior por comparação de string)
  - `partidaVisivelExpr(alias, viewerParam) -> string` (SQL booleano)
  - `partidaVisivelWhere(alias, viewerSteamId, params) -> string` (` and (...)`; null → `''`)
  - `partidaVisivelPredicado(alias, viewerSteamId, params) -> string` (predicado sem ` and `)

- [ ] **Step 1: Escrever os testes**

```js
import { describe, it, expect } from 'vitest'
import { parCanonico, partidaVisivelExpr, partidaVisivelWhere, partidaVisivelPredicado } from '../src/friendships.js'

describe('parCanonico', () => {
  it('ordena por string, menor primeiro', () => {
    expect(parCanonico('222', '111')).toEqual(['111', '222'])
    expect(parCanonico('111', '222')).toEqual(['111', '222'])
  })
  it('é idempotente qualquer que seja a ordem de entrada', () => {
    expect(parCanonico('b', 'a')).toEqual(parCanonico('a', 'b'))
  })
})

describe('partidaVisivelExpr', () => {
  it('monta: eu joguei OU amigo accepted meu jogou', () => {
    const sql = partidaVisivelExpr('m', '$1')
    expect(sql).toContain('mv.steam_id64 = $1')                 // eu joguei
    expect(sql).toContain('from friendships f')                 // via amizade
    expect(sql).toContain("f.status = 'accepted'")
    expect(sql).toContain('mv.match_id = m.id')
    expect(sql).not.toContain('group')                          // grupo não existe mais
    expect(sql).not.toContain('ranking_publico')
  })
  it('sobrevive ao .replaceAll("m.", "mh.") dos subqueries de aces', () => {
    const trocado = partidaVisivelExpr('m', '$1').replaceAll('m.', 'mh.')
    expect(trocado).toContain('mv.match_id = mh.id')
    expect(trocado).toContain('from friendships f')             // 'f.'/'mv.' intactos
    expect(trocado).not.toContain('mh.match_id = ')             // mv não vira mh
  })
})

describe('partidaVisivelWhere', () => {
  it('null devolve string vazia e não mexe nos params', () => {
    const params = ['x']
    expect(partidaVisivelWhere('m', null, params)).toBe('')
    expect(params).toEqual(['x'])
  })
  it('dá push no viewer e aponta pro param novo', () => {
    const params = ['765']
    const sql = partidaVisivelWhere('m', '999', params)
    expect(params).toEqual(['765', '999'])
    expect(sql.startsWith(' and (')).toBe(true)
    expect(sql).toContain('mv.steam_id64 = $2')
  })
})

describe('partidaVisivelPredicado', () => {
  it('devolve o predicado sem " and " e dá push no viewer', () => {
    const params = ['id1']
    const sql = partidaVisivelPredicado('matches', '999', params)
    expect(params).toEqual(['id1', '999'])
    expect(sql.startsWith('(')).toBe(true)
    expect(sql).not.toMatch(/^\s*and /)
    expect(sql).toContain('mv.match_id = matches.id')
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `cd site/server && npx vitest run test/friendships.test.js`
Expected: FAIL — `Cannot find module '../src/friendships.js'`.

- [ ] **Step 3: Escrever o módulo**

```js
// Regra ÚNICA de visibilidade de partida por AMIZADE (substitui o antigo matchVisibility.js
// que era por grupo). Uma partida é visível ao viewer V se V jogou nela, OU se um amigo
// `accepted` de V jogou nela. Sem exceção pública — não há mais acesso sem viewer.
//
// IMPORTANTE: os call sites de aces (ranking.js/profile.js) fazem .replaceAll('m.', 'mh.')
// no fragmento. O único token com 'm.' aqui é `<alias>.id`; os aliases internos são `mv`
// e `f` (não contêm 'm.'), então a troca só afeta o alias externo, como desejado.

// Ordena um par de steamIds na ordem canônica (menor string primeiro), pra bater com o
// check (player_a < player_b) da tabela friendships.
export function parCanonico(a, b) {
  return a < b ? [a, b] : [b, a]
}

// Núcleo: expressão booleana da regra, dado o alias da tabela `matches` e o placeholder do
// param do viewer (steamId) já existente na query.
export function partidaVisivelExpr(alias, viewerParam) {
  return `(exists (
    select 1 from match_players mv
    where mv.match_id = ${alias}.id and mv.steam_id64 = ${viewerParam})
  or exists (
    select 1 from match_players mv
    join friendships f on (
      (f.player_a = ${viewerParam} and f.player_b = mv.steam_id64)
      or (f.player_b = ${viewerParam} and f.player_a = mv.steam_id64))
    where mv.match_id = ${alias}.id and f.status = 'accepted'))`
}

// Fragmento ` and (...)` que dá push no viewer em `params`. viewer nulo → '' (sem filtro;
// usado por chamadas internas que já garantiram escopo de outra forma).
export function partidaVisivelWhere(alias, viewerSteamId, params) {
  if (!viewerSteamId) return ''
  params.push(viewerSteamId)
  return ` and ${partidaVisivelExpr(alias, `$${params.length}`)}`
}

// Predicado sem ` and ` (pra compor em `where id = $1 and <predicado>`), dá push no viewer.
export function partidaVisivelPredicado(alias, viewerSteamId, params) {
  params.push(viewerSteamId)
  return partidaVisivelExpr(alias, `$${params.length}`)
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `cd site/server && npx vitest run test/friendships.test.js`
Expected: PASS (todos os testes verdes).

- [ ] **Step 5: Commit**

```bash
git add site/server/src/friendships.js site/server/test/friendships.test.js
git commit -m "feat: modulo friendships (par canonico + visibilidade por viewer)"
```

---

## Task 3: Rotas de amizade `/api/amigos`

CRUD de amizade: listar (amigos + pendentes), pedir, aceitar, remover/recusar.

**Files:**
- Create: `site/server/src/routes/friendships.js`
- Create: `site/server/test/amigos.test.js`
- Modify: `site/server/src/app.js` (registrar o router)

**Interfaces:**
- Consumes: `parCanonico` de `../friendships.js`.
- Produces: `createFriendshipsRouter({ db, requireAuth }) -> Router`, montado em `/api/amigos`.
  - `GET /` → `{ amigos: [...], recebidos: [...], enviados: [...] }`
  - `POST /` `{steamId}` → cria `pending` (ou `accepted` se já há pedido inverso)
  - `POST /:steamId/aceitar` → `pending` recebido vira `accepted`
  - `DELETE /:steamId` → remove a linha (recusa/desfaz/cancela)

- [ ] **Step 1: Escrever os testes**

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookieA = `resenha_token=${signToken({ steamId: '111' }, config.jwtSecret)}`

function appWith(handlers) {
  const query = vi.fn().mockImplementation((sql) => {
    for (const [needle, rows] of handlers) if (sql.includes(needle)) return Promise.resolve({ rows, rowCount: rows.length })
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
  const db = { query, connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) }
  return { app: createApp({ config, db }), db }
}

describe('POST /api/amigos', () => {
  it('alvo não é conta real: 404', async () => {
    const { app } = appWith([['conta_criada_em', []]])
    const res = await request(app).post('/api/amigos').set('Cookie', cookieA).send({ steamId: '999' })
    expect(res.status).toBe(404)
  })
  it('cria pedido pending com par canônico e requested_by = eu', async () => {
    const { app, db } = appWith([['conta_criada_em', [{ steam_id64: '999' }]]])
    const res = await request(app).post('/api/amigos').set('Cookie', cookieA).send({ steamId: '999' })
    expect(res.status).toBe(201)
    const ins = db.query.mock.calls.find((c) => c[0].includes('insert into friendships'))
    expect(ins[1]).toEqual(['111', '999', '111'])            // player_a<player_b, requested_by
  })
})

describe('POST /api/amigos/:steamId/aceitar', () => {
  it('aceita: marca accepted', async () => {
    const { app, db } = appWith([['update friendships', [{}]]])
    const res = await request(app).post('/api/amigos/999/aceitar').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    const upd = db.query.mock.calls.find((c) => c[0].includes('update friendships'))
    expect(upd[0]).toContain("status = 'accepted'")
    expect(upd[1]).toEqual(['111', '999'])                   // par canônico
  })
  it('sem pendente pra aceitar: 404', async () => {
    const { app } = appWith([['update friendships', []]])
    const res = await request(app).post('/api/amigos/999/aceitar').set('Cookie', cookieA)
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/amigos/:steamId', () => {
  it('remove a linha do par (qualquer direção/status)', async () => {
    const { app, db } = appWith([['delete from friendships', [{}]]])
    const res = await request(app).delete('/api/amigos/999').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    const del = db.query.mock.calls.find((c) => c[0].includes('delete from friendships'))
    expect(del[1]).toEqual(['111', '999'])
  })
})

describe('GET /api/amigos', () => {
  it('devolve amigos, recebidos e enviados', async () => {
    const { app } = appWith([['from friendships', [
      { steam_id64: '999', nick: 'x', avatar_url: null, status: 'accepted', requested_by: '111' },
    ]]])
    const res = await request(app).get('/api/amigos').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('amigos')
    expect(res.body).toHaveProperty('recebidos')
    expect(res.body).toHaveProperty('enviados')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/server && npx vitest run test/amigos.test.js`
Expected: FAIL — rota `/api/amigos` responde 404 (router não existe).

- [ ] **Step 3: Escrever o router**

```js
import { Router } from 'express'
import { parCanonico } from '../friendships.js'

// Rotas de amizade mútua (substituem grupos). Toda linha de friendships é gravada em
// par canônico (player_a < player_b); a direção do pedido vive em requested_by.
export function createFriendshipsRouter({ db, requireAuth }) {
  const router = Router()

  // Lista meus amigos accepted + pendentes recebidos (outro pediu) + enviados (eu pedi).
  router.get('/', requireAuth, async (req, res) => {
    const eu = req.player.steamId
    const { rows } = await db.query(
      `select case when f.player_a = $1 then f.player_b else f.player_a end as steam_id64,
              coalesce(p.nick, '') as nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url,
              f.status, f.requested_by
       from friendships f
       join players p on p.steam_id64 = case when f.player_a = $1 then f.player_b else f.player_a end
       left join steam_avatares sa on sa.steam_id64 = p.steam_id64
       where f.player_a = $1 or f.player_b = $1
       order by p.nick asc`,
      [eu],
    )
    const amigos = rows.filter((r) => r.status === 'accepted')
    const recebidos = rows.filter((r) => r.status === 'pending' && r.requested_by !== eu)
    const enviados = rows.filter((r) => r.status === 'pending' && r.requested_by === eu)
    const enxuga = ({ steam_id64, nick, avatar_url }) => ({ steamId: steam_id64, nick, avatarUrl: avatar_url })
    res.json({ amigos: amigos.map(enxuga), recebidos: recebidos.map(enxuga), enviados: enviados.map(enxuga) })
  })

  // Pede amizade. Se já existe um pending inverso (o outro já me pediu), aceita direto.
  router.post('/', requireAuth, async (req, res) => {
    const eu = req.player.steamId
    const alvo = String(req.body?.steamId ?? '').trim()
    if (!alvo || alvo === eu) return res.status(400).json({ erro: 'steamId inválido' })
    const real = await db.query('select steam_id64 from players where steam_id64 = $1 and conta_criada_em is not null', [alvo])
    if (real.rows.length === 0) return res.status(404).json({ erro: 'Esse jogador não tem conta no Resenha' })
    const [a, b] = parCanonico(eu, alvo)
    // Aceita direto se já havia pendente do outro lado; senão cria pending meu.
    const upd = await db.query(
      `update friendships set status = 'accepted', accepted_at = now()
       where player_a = $1 and player_b = $2 and status = 'pending' and requested_by = $3 returning 1`,
      [a, b, alvo],
    )
    if (upd.rowCount > 0) return res.status(200).json({ status: 'accepted' })
    await db.query(
      `insert into friendships (player_a, player_b, status, requested_by)
       values ($1, $2, 'pending', $3) on conflict (player_a, player_b) do nothing`,
      [a, b, eu],
    )
    res.status(201).json({ status: 'pending' })
  })

  // Aceita um pedido recebido (pending em que EU não sou o requested_by).
  router.post('/:steamId/aceitar', requireAuth, async (req, res) => {
    const eu = req.player.steamId
    const [a, b] = parCanonico(eu, req.params.steamId)
    const upd = await db.query(
      `update friendships set status = 'accepted', accepted_at = now()
       where player_a = $1 and player_b = $2 and status = 'pending' and requested_by <> $3 returning 1`,
      [a, b, eu],
    )
    if (upd.rowCount === 0) return res.status(404).json({ erro: 'Nenhum pedido pendente desse jogador' })
    res.json({ ok: true })
  })

  // Remove a amizade/pedido em qualquer direção ou status (recusar/desfazer/cancelar).
  router.delete('/:steamId', requireAuth, async (req, res) => {
    const [a, b] = parCanonico(req.player.steamId, req.params.steamId)
    const del = await db.query('delete from friendships where player_a = $1 and player_b = $2 returning 1', [a, b])
    if (del.rowCount === 0) return res.status(404).json({ erro: 'Amizade não encontrada' })
    res.json({ ok: true })
  })

  return router
}
```

- [ ] **Step 4: Registrar no app.js**

Em `site/server/src/app.js`, adicionar o import junto aos outros routers e montar a rota. Adicionar após a linha do import de `createAuthRouter`:

```js
import { createFriendshipsRouter } from './routes/friendships.js'
```

E montar (perto de onde ficava `createPlayersRouter`):

```js
  app.use('/api/amigos', createFriendshipsRouter({ db, requireAuth }))
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd site/server && npx vitest run test/amigos.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/server/src/routes/friendships.js site/server/test/amigos.test.js site/server/src/app.js
git commit -m "feat: rotas de amizade /api/amigos (pedir, aceitar, remover, listar)"
```

---

## Task 4: Auto-friend via Steam + `conta_criada_em` no login

No login, marca a conta como real (`conta_criada_em`) e, best-effort, cria amizades `accepted` com amigos Steam que já têm conta.

**Files:**
- Modify: `site/server/src/routes/auth.js`
- Modify: `site/server/test/auth.test.js`

**Interfaces:**
- Consumes: `parCanonico` de `../friendships.js`; `fetchFriendList` (novo parâmetro injetado, mesmo padrão de `fetchPersona`/`fetchBans`).
- `createAuthRouter({ config, db, verifySteamLogin, fetchPersona, fetchFriendList, requireAuth })` — `fetchFriendList(steamId) -> Promise<string[]>` (lista de steamIds; `[]` se perfil privado/erro).

- [ ] **Step 1: Escrever o teste**

```js
// adicionar em test/auth.test.js — o callback do login cria amizades com amigos Steam reais
it('auto-friend: cria accepted só com amigos Steam que têm conta', async () => {
  const queries = []
  const query = vi.fn().mockImplementation((sql, params) => {
    queries.push([sql, params])
    if (sql.includes('used_openid_nonces')) return Promise.resolve({ rows: [{ nonce: 'n' }], rowCount: 1 })
    if (sql.includes('select steam_id64, nick')) return Promise.resolve({ rows: [{ steam_id64: '111', is_super_admin: false }] })
    if (sql.includes('conta_criada_em is not null')) return Promise.resolve({ rows: [{ steam_id64: '222' }] }) // só 222 tem conta
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
  const db = { query }
  const app = createApp({
    config, db,
    verifySteamLogin: async () => ({ steamId: '111', nonce: 'n' }),
    fetchPersona: async () => ({ nick: 'eu', avatarUrl: null }),
    fetchFriendList: async () => ['222', '333'],   // 333 não tem conta → ignorado
  })
  await request(app).get('/api/auth/steam/callback?x=1')
  const ins = queries.find(([s]) => s.includes('insert into friendships'))
  expect(ins[1]).toEqual(['111', '222', '111'])   // par canônico, accepted
  expect(queries.some(([s]) => s.includes('conta_criada_em = coalesce'))).toBe(true)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/server && npx vitest run test/auth.test.js`
Expected: FAIL — `fetchFriendList` não é usado; nenhum insert em friendships.

- [ ] **Step 3: Implementar no auth.js**

Em `site/server/src/routes/auth.js`: (a) aceitar `fetchFriendList` na assinatura; (b) no upsert de players, setar `conta_criada_em`; (c) após obter o `jogador`, rodar o auto-friend best-effort.

Trocar a assinatura:
```js
export function createAuthRouter({ config, db, verifySteamLogin, fetchPersona, fetchFriendList, requireAuth }) {
```

Trocar o upsert de players (linha ~32) pra marcar conta real:
```js
    await db.query(
      `insert into players (steam_id64, conta_criada_em) values ($1, now())
       on conflict (steam_id64) do update set conta_criada_em = coalesce(players.conta_criada_em, now())`,
      [steamId],
    )
```

Adicionar o import no topo:
```js
import { parCanonico } from '../friendships.js'
```

Após montar o `token`/antes do `res.redirect`, inserir o bloco best-effort:
```js
    // Auto-friend: amigos Steam que já têm conta no Resenha viram amizade accepted direta
    // (aceite implícito). Best-effort — perfil Steam privado devolve lista vazia; falha de
    // rede não pode atrapalhar o login (try/catch, mesmo padrão do fetch de bans).
    try {
      const steamFriends = await fetchFriendList(steamId)
      if (steamFriends.length > 0) {
        const comConta = await db.query(
          'select steam_id64 from players where steam_id64 = any($1) and conta_criada_em is not null',
          [steamFriends],
        )
        for (const { steam_id64: amigo } of comConta.rows) {
          const [a, b] = parCanonico(steamId, amigo)
          await db.query(
            `insert into friendships (player_a, player_b, status, requested_by, accepted_at)
             values ($1, $2, 'accepted', $3, now()) on conflict (player_a, player_b) do nothing`,
            [a, b, steamId],
          )
        }
      }
    } catch (e) {
      console.error('auto-friend Steam falhou (ignorado):', e.message)
    }
```

- [ ] **Step 4: Fornecer `fetchFriendList` real na composição**

Localizar onde `createApp`/`index.js` injeta `fetchPersona`/`fetchBans` (buscar em `site/server/src/index.js` e `steam-api.js`). Adicionar uma função `fetchFriendList(steamId)` que chama `GET https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=...&steamid=...&relationship=friend` e devolve `data.friendslist.friends.map(f => f.steamid)`; em qualquer erro/HTTP não-200 (inclui perfil privado → 401), devolve `[]`. Seguir o mesmo módulo/estilo de `fetchBans`. Passar `fetchFriendList` no `createApp` em `index.js`. Se `createApp` tiver um default para testes, deixar `fetchFriendList = async () => []` como fallback (auto-friend vira no-op sem chave).

- [ ] **Step 5: Rodar e ver passar**

Run: `cd site/server && npx vitest run test/auth.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/server/src/routes/auth.js site/server/src/index.js site/server/src/steam-api.js site/server/test/auth.test.js
git commit -m "feat: auto-friend via Steam no login + marca conta_criada_em"
```

---

## Task 5: Trocar visibilidade em `matches.js` para viewer

Remove `requireGroupMember`, troca `req.groupId` por `req.player.steamId`, troca o import pra `friendships.js`, e **remove todo `or partidaPublicaExpr(...)`**.

**Files:**
- Modify: `site/server/src/routes/matches.js`
- Modify: `site/server/test/matches.test.js`

- [ ] **Step 1: Ajustar/rodar o teste existente pra ver falhar**

Os testes de `matches.test.js` hoje passam `X-Group-Id` e esperam `group_id`/`partidaPublicaExpr`. Atualizar os casos pra: (a) não enviar `X-Group-Id`; (b) esperar que o SQL contenha `from friendships f` e `mv.steam_id64 = $` e **não** contenha `ranking_publico` nem `group_id`. Rodar:

Run: `cd site/server && npx vitest run test/matches.test.js`
Expected: FAIL (código ainda usa group_id/partidaPublicaExpr).

- [ ] **Step 2: Editar `matches.js`**

Trocar o import (linha 3):
```js
import { partidaVisivelExpr } from '../friendships.js'
```

Trocar a assinatura (linha 23) removendo `requireGroupMember`:
```js
export function createMatchesRouter({ db, requireAuth, r2Client, r2Bucket, config }) {
```

Em **cada** rota do arquivo, aplicar a transformação:
- Remover o middleware `requireGroupMember` da lista (deixar só `requireAuth`).
- Trocar `req.groupId` por `req.player.steamId` em todo array de params.
- Trocar cada `(${partidaVisivelExpr('X', '$N')} or ${partidaPublicaExpr('X')})` por só `${partidaVisivelExpr('X', '$N')}` (remove o `partidaPublicaExpr`).

Call sites concretos (linhas de referência): `router.get('/')` (30–33, `params=[req.player.steamId]`), `/sync-status` (124/132), `/:id` (139/142/143), `/:id/jogador/:steamId/detalhe` (303/306/307), `/:id/head-to-head/:steamId` (368/372/373), `/:id/lado/:filtro` (461/465/466), `/:id/highlight/:highlightId/allstar-clip` (516/527/528), `/:id/replay` (575/578/579), `/:id/replay/round/:n` (593/597/598), `/:id/demo` (612/615/616). Em `/:id/demo` já não havia `partidaPublicaExpr` — só trocar groupId→steamId.

- [ ] **Step 3: Rodar e ver passar**

Run: `cd site/server && npx vitest run test/matches.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add site/server/src/routes/matches.js site/server/test/matches.test.js
git commit -m "refactor: matches.js usa visibilidade por amizade (remove grupo e partidaPublica)"
```

---

## Task 6: Trocar visibilidade em ranking, recordes, ladoPorMapa, sessions

Mesma transformação mecânica (sem `partidaPublicaExpr` nesses — só `requireGroupMember`/`req.groupId`/import).

**Files:**
- Modify: `site/server/src/routes/ranking.js`, `site/server/src/routes/recordes.js`, `site/server/src/routes/ladoPorMapa.js`, `site/server/src/routes/sessions.js`
- Modify: `site/server/test/ranking.test.js`, `site/server/test/recordes.test.js`, `site/server/test/ladoPorMapa.test.js`, `site/server/test/sessions.test.js`

- [ ] **Step 1: Atualizar os 4 testes pra viewer**

Em cada arquivo de teste: parar de enviar `X-Group-Id`; onde o teste casava SQL por `group_members`/`group_id`, casar por `from friendships f`; params esperam o steamId do cookie (ex.: `'111'`) no lugar do groupId. Rodar:

Run: `cd site/server && npx vitest run test/ranking.test.js test/recordes.test.js test/ladoPorMapa.test.js test/sessions.test.js`
Expected: FAIL.

- [ ] **Step 2: Editar `ranking.js`**

- Import (linha 3): `import { partidaVisivelExpr } from '../friendships.js'`
- Assinatura (linha 10): `export function createRankingRouter({ db, requireAuth }) {`
- Rota `/` (linha 15): remover `requireGroupMember`; `const params = [req.player.steamId]` (linha 16); `[req.player.steamId]` na linha 44. As `partidaVisivelExpr('m', '$1')` (linhas 41/69/84) não mudam de forma — só passam a receber o viewer via `$1`. O `.replaceAll('m.','mh.')` dos aces segue funcionando (Task 2 garante).

- [ ] **Step 3: Editar `recordes.js`**

- Assinatura (linha 15): `export function createRecordesRouter({ db, requireAuth }) {`
- Rota `/` (linha 21): remover `requireGroupMember`. As duas queries que hoje filtram `group_id = $1` (linhas ~23/33 usando `[req.groupId]`) passam a escopar por amizade. **Atenção:** hoje `recordes.js` filtra `matches ... where status='parsed' and group_id = $1` e `match_players ... where match_id in (select id from matches where status='parsed' and group_id=$1)`. Trocar os dois por `partidaVisivelExpr` com o viewer:

```js
  router.get('/', requireAuth, async (req, res) => {
    const eu = req.player.steamId
    const matchesQ = await db.query(
      `select id, map, played_at from matches m where status = 'parsed'
         and ${partidaVisivelExpr('m', '$1')}
       order by played_at asc nulls last`,
      [eu],
    )
    const playersQ = await db.query(
      `select mp.match_id, mp.steam_id64, p.nick, mp.kills, mp.damage, mp.rounds_played,
              mp.won, mp.clutch_wins, coalesce(p.avatar_url, sa.avatar_url) as avatar_url
       from match_players mp
       join players p on p.steam_id64 = mp.steam_id64
       left join steam_avatares sa on sa.steam_id64 = mp.steam_id64
       where mp.match_id in (select id from matches m where status = 'parsed' and ${partidaVisivelExpr('m', '$1')})`,
      [eu],
    )
    // ...resto do handler inalterado
```
Adicionar `import { partidaVisivelExpr } from '../friendships.js'` no topo.

- [ ] **Step 4: Editar `ladoPorMapa.js` e `sessions.js`**

- `ladoPorMapa.js`: assinatura (linha 3) sem `requireGroupMember`; rota (13) sem o middleware; `[req.groupId]` (34) → `[req.player.steamId]`. Se a query filtra por `group_id`, trocar pela `partidaVisivelExpr` (adicionar import). Ler o arquivo e aplicar o mesmo padrão do `recordes.js`.
- `sessions.js`: assinatura (16) sem `requireGroupMember`; rota (23) sem o middleware; os três `[req.groupId]` (27/37/43) → `[req.player.steamId]`; trocar filtros `group_id` por `partidaVisivelExpr` (import).

- [ ] **Step 5: Rodar e ver passar**

Run: `cd site/server && npx vitest run test/ranking.test.js test/recordes.test.js test/ladoPorMapa.test.js test/sessions.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/server/src/routes/ranking.js site/server/src/routes/recordes.js site/server/src/routes/ladoPorMapa.js site/server/src/routes/sessions.js site/server/test/ranking.test.js site/server/test/recordes.test.js site/server/test/ladoPorMapa.test.js site/server/test/sessions.test.js
git commit -m "refactor: ranking/recordes/ladoPorMapa/sessions escopam por amizade"
```

---

## Task 7: Trocar `profile.js` e remover o modo `?publico`

`profile.js` tem o filtro por grupo, o `?publico=1` (remover) e o compare.

**Files:**
- Modify: `site/server/src/routes/profile.js`
- Modify: `site/server/test/profile.test.js`

- [ ] **Step 1: Atualizar o teste**

Remover casos que exercitam `?publico=1`. Ajustar os demais pra não enviar `X-Group-Id` e esperar `from friendships f` no SQL, com params usando o steamId do viewer. Rodar:

Run: `cd site/server && npx vitest run test/profile.test.js`
Expected: FAIL.

- [ ] **Step 2: Editar `profile.js`**

- Import (linha 3): `import { partidaVisivelExpr } from '../friendships.js'`
- O helper interno `grupoWhere`/`grupoPerfil` (linhas ~26–36, 298, 422–430): renomear/reescrever pra escopar por viewer. Substituir a função que hoje monta ` and ${partidaVisivelExpr('m', ...groupId...)}` por uma que empurra `req.player.steamId`.
- Assinatura (273): `export function createProfileRouter({ db, requireAuth }) {`
- Em cada rota (`/compare` 278, `/:steamId/posicoes` 337, `/:steamId` 368): remover `requireGroupMember`; trocar `req.groupId` por `req.player.steamId` (linhas 298, 300–303, 346, 357, 391, 406, 483).
- **Remover o modo público** (linhas ~413–495): eliminar a variável `publico`/`grupoPerfil = publico ? null : req.groupId` — passa a ser sempre `req.player.steamId`. Remover o ramo que montava listas não-clicáveis via `partidaPublicaExpr` e qualquer leitura de `req.query.publico`.

- [ ] **Step 3: Rodar e ver passar**

Run: `cd site/server && npx vitest run test/profile.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add site/server/src/routes/profile.js site/server/test/profile.test.js
git commit -m "refactor: profile.js escopa por amizade e remove o modo ?publico"
```

---

## Task 8: Trocar clips, lineups, curso, upload, players

Últimos consumidores de grupo. `clips`/`teams` usavam `group_id = $2` direto; aqui trocamos por visibilidade de amizade. `players` perde o filtro de grupo (bans e lista = "eu + meus amigos").

**Files:**
- Modify: `site/server/src/routes/clips.js`, `site/server/src/routes/lineups.js`, `site/server/src/routes/curso.js`, `site/server/src/routes/upload.js`, `site/server/src/routes/players.js`
- Modify: testes correspondentes (`clips.test.js`, `lineups.test.js`, `curso.test.js`, `upload.test.js`, `players.test.js`)
- Delete: `site/server/src/matchVisibility.js`, `site/server/test/matchVisibility.test.js`

- [ ] **Step 1: Atualizar os testes**

Em cada: não enviar `X-Group-Id`; esperar viewer steamId nos params. Para `players.js`, a lista de amigos/bans passa a ser derivada de `friendships` (casar `from friendships f`). Rodar:

Run: `cd site/server && npx vitest run test/clips.test.js test/lineups.test.js test/curso.test.js test/upload.test.js test/players.test.js`
Expected: FAIL.

- [ ] **Step 2: Editar os 5 routers**

- **`clips.js`**: assinatura (27) sem `requireGroupMember`; rota (31) sem o middleware; a checagem de dono (linha 43) `select 1 from matches where id = $1 and group_id = $2` → visibilidade por amizade:
```js
import { partidaVisivelExpr } from '../friendships.js'
// ...
    const dono = await db.query(
      `select 1 from matches m where m.id = $1 and ${partidaVisivelExpr('m', '$2')}`,
      [matchId, req.player.steamId],
    )
```
- **`lineups.js`**: assinatura (5) sem `requireGroupMember`; rota (10) sem o middleware; `const params = [req.player.steamId]` (12); trocar filtro `group_id` por `partidaVisivelExpr` (import).
- **`curso.js`**: assinatura (52) sem `requireGroupMember`; rotas (56/79/87) sem o middleware. Se o progresso do curso é por jogador (não por grupo), simplesmente remover o gate de grupo e usar `req.player.steamId`. Ler o arquivo pra confirmar que nenhuma query filtra `group_id` (curso é progresso pessoal); se filtrar, remover o filtro.
- **`upload.js`**: assinatura (16) sem `requireGroupMember`; rota (19) sem o middleware; o insert (39) hoje `[req.groupId, req.player.steamId, ...]` — remover `req.groupId` do insert em `uploads_pendentes` (a coluna some na migração 0038; nesta task o insert para de mandar group_id). Ajustar a query de insert pra não incluir a coluna `group_id`.
- **`players.js`**: assinatura (4) sem `requireGroupMember`; rotas `/bans` (11) e `/` (32) sem o middleware. As duas queries (linhas ~19/40 com `[req.groupId]`) hoje listam "jogadores do grupo". Passam a listar **eu + meus amigos accepted**:
```js
    const eu = req.player.steamId
    // eu + meus amigos accepted (substitui a antiga lista do grupo)
    const { rows } = await db.query(
      `select p.steam_id64, p.nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url, p.is_super_admin
       from players p left join steam_avatares sa on sa.steam_id64 = p.steam_id64
       where p.steam_id64 = $1 or p.steam_id64 in (
         select case when f.player_a = $1 then f.player_b else f.player_a end
         from friendships f where (f.player_a = $1 or f.player_b = $1) and f.status = 'accepted')
       order by p.nick asc`,
      [eu],
    )
```
Aplicar o mesmo escopo na query de `/bans`. Remover a rota `PUT /me/ranking-publico` (linhas 106–109) — Ranking Público some (Task 9).

- [ ] **Step 3: Deletar `matchVisibility.js`**

Confirmar que nenhum arquivo ainda importa de `../matchVisibility.js`:
```bash
grep -rn "matchVisibility" site/server/src && echo "AINDA HÁ IMPORTS" || echo "limpo"
```
Deletar `site/server/src/matchVisibility.js` e `site/server/test/matchVisibility.test.js`.

- [ ] **Step 4: Rodar a suíte inteira do server**

Run: `cd site/server && npx vitest run --no-file-parallelism`
Expected: PASS (menos os testes de groups/teams/rankingPublico, removidos na Task 9/10/11 — se ainda existirem aqui, podem falhar por importar arquivos que só somem depois; nesse caso rodar só os arquivos tocados nesta task).

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/clips.js site/server/src/routes/lineups.js site/server/src/routes/curso.js site/server/src/routes/upload.js site/server/src/routes/players.js site/server/test/*.test.js
git rm site/server/src/matchVisibility.js site/server/test/matchVisibility.test.js
git commit -m "refactor: clips/lineups/curso/upload/players por amizade; remove matchVisibility"
```

---

## Task 9: Remover Ranking Público (server)

**Files:**
- Delete: `site/server/src/routes/rankingPublico.js`, `site/server/test/rankingPublico.test.js`
- Modify: `site/server/src/app.js`
- Modify: `site/server/src/routes/auth.js` (parar de expor `ranking_publico` no `/me`)

- [ ] **Step 1: Remover a rota e o wiring**

- `git rm site/server/src/routes/rankingPublico.js site/server/test/rankingPublico.test.js`
- Em `app.js`: remover o import `createRankingPublicoRouter` (linha 24) e o `app.use('/api/ranking-publico', ...)` (linha 80).
- Em `auth.js` `/me` (linha 65): remover `ranking_publico` do `select` e do objeto de resposta.

- [ ] **Step 2: Rodar a suíte do server**

Run: `cd site/server && npx vitest run --no-file-parallelism`
Expected: PASS (nenhum teste referencia mais ranking-publico).

- [ ] **Step 3: Commit**

```bash
git add site/server/src/app.js site/server/src/routes/auth.js
git rm site/server/src/routes/rankingPublico.js site/server/test/rankingPublico.test.js
git commit -m "refactor: remove Ranking Publico do server"
```

---

## Task 10: Remover Times (server)

**Files:**
- Delete: `site/server/src/routes/teams.js`, `site/server/test/teams.test.js`
- Modify: `site/server/src/app.js`

- [ ] **Step 1: Remover**

- `git rm site/server/src/routes/teams.js site/server/test/teams.test.js`
- Em `app.js`: remover o import `createTeamsRouter` (linha 23) e o `app.use('/api/teams', ...)` (linha 79).

- [ ] **Step 2: Rodar a suíte do server**

Run: `cd site/server && npx vitest run --no-file-parallelism`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add site/server/src/app.js
git rm site/server/src/routes/teams.js site/server/test/teams.test.js
git commit -m "refactor: remove Times do server"
```

---

## Task 11: Remover grupos + Discord + `requireGroupMember` (server)

**Files:**
- Delete: `site/server/src/routes/groups.js`, `site/server/test/groups.test.js`
- Modify: `site/server/src/app.js`, `site/server/src/auth/middleware.js`, `site/server/src/routes/auth.js`

- [ ] **Step 1: Remover grupos, convites, Discord e o middleware**

- `git rm site/server/src/routes/groups.js site/server/test/groups.test.js` (Discord webhook morava aqui).
- Em `app.js`: remover imports `createGroupsRouter, createConvitesRouter` (22) e `createRequireGroupMember` (25); remover `app.use('/api/groups', ...)` (75) e `app.use('/api/convites', ...)` (76); remover a linha `const requireGroupMember = createRequireGroupMember(db)` (72).
- Em `auth/middleware.js`: remover `createRequireGroupMember` inteiro (linhas 33–47) e o `UUID_RE` se ficar sem uso.
- Em `auth.js` `/me`: remover `grupo_ativo_id` do select e do objeto de resposta; remover o `update players set grupo_ativo_id...` (linhas ~71–74). O `/me` passa a devolver `{ steamId, nick, avatarUrl, isSuperAdmin, faceitNick, tourConcluido }` (sem `grupoAtivoId`/`rankingPublico`).

- [ ] **Step 2: Confirmar que nada mais referencia grupo no server**

```bash
grep -rn "requireGroupMember\|req.groupId\|grupo_ativo\|group_id\|group_members\|X-Group-Id" site/server/src && echo "AINDA HÁ REFERÊNCIAS" || echo "server limpo de grupos"
```
Resolver o que aparecer (exceto os arquivos de migração SQL, que são histórico).

- [ ] **Step 3: Rodar a suíte inteira do server**

Run: `cd site/server && npx vitest run --no-file-parallelism`
Expected: PASS (todas as suítes, sem grupos/teams/rankingPublico).

- [ ] **Step 4: Commit**

```bash
git add site/server/src/app.js site/server/src/auth/middleware.js site/server/src/routes/auth.js
git rm site/server/src/routes/groups.js site/server/test/groups.test.js
git commit -m "refactor: remove grupos, convites, Discord webhook e requireGroupMember do server"
```

---

## Task 12: Coletor — remover `group_id` do db.py

**Files:**
- Modify: `coletor/src/coletor/db.py`
- Modify: testes do Coletor que exercitam inserção (`coletor/tests/` — localizar os que passam `group_id`).

- [ ] **Step 1: Atualizar os testes do Coletor**

Localizar os testes que chamam `store_parsed`/`_insert_match`/`record_pending_match`/`list_tracked_players` com `group_id`/`grupo_ativo_id`. Removê-los desses argumentos e das asserções. Rodar:

Run: `cd coletor && python -m pytest -q`
Expected: FAIL (assinaturas ainda pedem group_id).

- [ ] **Step 2: Editar `db.py`**

- `_insert_match` (linha 23): remover o parâmetro `group_id` e a coluna `group_id` do `insert into matches (...)` e do tuple de valores (linhas 79/106).
- `store_parsed` (linha 397): remover o parâmetro `group_id` e o repasse pra `_insert_match` (linha 407); ajustar a docstring.
- `record_pending_match` (linha 425): remover `group_id` (a coluna some); ajustar o insert (438) e o tuple (443).
- `list_tracked_players` (linha 490): remover `grupo_ativo_id` do select e do retorno (volta `[(steam_id64, match_auth_code, last_share_code)]`).
- `grupo_para_ingest` (502): **deletar a função inteira.**
- `listar_uploads_pendentes` (550): remover `group_id` do select (556) e o consumidor no main.py (Task 13).
- `enfileirar_faceit` (662) / `listar_faceit_pendentes` (675): remover `group_id`.
- Funções de Discord (747–~820): **deletar** `grupos_da_partida`, `webhook_do_grupo`, `ja_notificado_discord`, `marcar_notificado_discord`, `resumo_da_partida_para_grupo`.

- [ ] **Step 3: Rodar e ver passar**

Run: `cd coletor && python -m pytest -q`
Expected: PASS (testes de db sem group_id).

- [ ] **Step 4: Commit**

```bash
git add coletor/src/coletor/db.py coletor/tests
git commit -m "refactor: coletor db.py sem group_id (insert, pending, tracked, faceit, discord)"
```

---

## Task 13: Coletor — remover fluxo de grupo/Discord do main.py

**Files:**
- Modify: `coletor/src/coletor/main.py`
- Delete: `coletor/src/coletor/discord_notify.py` (+ teste correlato se houver)
- Modify: testes de `main` que exercitam discovery/discord

- [ ] **Step 1: Atualizar os testes**

Remover asserções sobre `discord_notify`, `grupo_ativo_id` (skip por falta de grupo), e passagem de `group_id` no ingest. Rodar:

Run: `cd coletor && python -m pytest -q`
Expected: FAIL.

- [ ] **Step 2: Editar `main.py`**

- Discovery (linhas ~41–54): `list_tracked_players` agora devolve 3-tuplas; parar de pular por `grupo_ativo_id` e de passar `group_id` pra `record_pending_match`.
- Bloco de Discord (linhas ~132–147): **deletar** (o loop de `grupos_da_partida`/`webhook_do_grupo`/notificação).
- Uploads (linhas ~403–416): `listar_uploads_pendentes` sem `group_id`; `_finalizar_ingest` sem `group_id`.
- `_finalizar_ingest` (589–623): remover o parâmetro `group_id`, o ramo `if group_id is None: group_id = grupo_para_ingest(...)` e o repasse `group_id=` pra `store_parsed`.
- Remover o import de `discord_notify` no topo do arquivo.
- `git rm coletor/src/coletor/discord_notify.py` (+ teste, se existir).
- Checar `coletor/src/coletor/transform.py`: o grep de "discord" bate lá — se for
  só comentário, limpar a menção; se houver código de resumo pro Discord (ex.:
  função que monta o texto do embed), removê-lo também.

- [ ] **Step 3: Confirmar Coletor limpo de grupo/discord**

```bash
grep -rn "group_id\|grupo_ativo\|grupo_para_ingest\|discord" coletor/src && echo "AINDA HÁ REFERÊNCIAS" || echo "coletor limpo"
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd coletor && python -m pytest -q`
Expected: PASS (suíte inteira do Coletor).

- [ ] **Step 5: Commit**

```bash
git add coletor/src/coletor/main.py coletor/tests
git rm coletor/src/coletor/discord_notify.py
git commit -m "refactor: coletor main.py sem grupo/discord (discovery, ingest, uploads, faceit)"
```

---

## Task 14: Client — remover X-Group-Id, grupoAtivo e gate de onboarding

**Files:**
- Modify: `site/client/src/main.jsx`, `site/client/src/auth/AuthContext.jsx`, `site/client/src/App.jsx`
- Delete: `site/client/src/lib/grupoAtivo.js`
- Modify: testes de client (`src/test/App.test.jsx`, `src/test/Tour.test.jsx`)

- [ ] **Step 1: Atualizar os testes de App/Tour**

Em `App.test.jsx`/`Tour.test.jsx`: remover `grupoAtivoId` dos mocks de `mockMe`. Ajustar as asserções de rota — não deve mais redirecionar pra `/bem-vindo`. Rodar:

Run: `cd site/client && npx vitest run src/test/App.test.jsx src/test/Tour.test.jsx`
Expected: FAIL.

- [ ] **Step 2: Editar `main.jsx`**

Remover o wrapper de `fetch` que anexa `X-Group-Id` (linhas ~4–14) e o import de `grupoAtivo`. `fetch` volta ao padrão.

- [ ] **Step 3: Editar `AuthContext.jsx`**

Remover o import de `grupoAtivo` (linha 2) e o bloco que sincroniza `grupoAtivoId`/`getGrupoAtivo` (linhas ~15–16).

- [ ] **Step 4: Editar `App.jsx`**

- Remover imports `Onboarding`, `AceitarConvite`, `Times`, `CompararTimes`, `RankingPublico`, `Jogadores` (linhas 9, 20–24).
- Adicionar `import Amigos from './pages/Amigos.jsx'` (criada na Task 16).
- Em `RotaProtegida`/`RotaTour`/`RotaAdmin` (linhas 33/42/99): remover `if (!jogador.grupoAtivoId) return <Navigate to="/bem-vindo" replace />`.
- Remover as rotas `/convite/:token`, `/bem-vindo`, `/times`, `/times/comparar`, `/ranking-publico` (linhas 57–58, 67–69).
- Remover o wrapper `RotaBemVindo` (linhas ~84–90).
- Trocar a rota `/jogadores` pra renderizar `<Amigos />` (linha 64).

- [ ] **Step 5: Deletar `grupoAtivo.js`**

`git rm site/client/src/lib/grupoAtivo.js` (após confirmar que nada mais importa: `grep -rn grupoAtivo site/client/src`).

- [ ] **Step 6: Rodar e ver passar**

Run: `cd site/client && npx vitest run src/test/App.test.jsx src/test/Tour.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add site/client/src/main.jsx site/client/src/auth/AuthContext.jsx site/client/src/App.jsx site/client/src/test/App.test.jsx site/client/src/test/Tour.test.jsx
git rm site/client/src/lib/grupoAtivo.js
git commit -m "refactor: client sem X-Group-Id, grupoAtivo e gate de onboarding"
```

---

## Task 15: Client — Shell (menu, SeletorGrupo, Jogadores→Amigos)

**Files:**
- Modify: `site/client/src/components/Shell.jsx`

- [ ] **Step 1: Editar o menu**

- No array `ITENS` (linhas 9–24): remover o item `/ranking-publico` (12). Trocar `{ to: '/jogadores', label: 'Jogadores', ... }` (14) por `{ to: '/jogadores', label: 'Amigos', num: '04', icone: 'jogadores' }`. Remover `/times` (16). Renumerar os `num` em sequência.
- Remover o `import { setGrupoAtivo }` (linha 4) e o componente `SeletorGrupo` inteiro (linhas 369–396) e seu uso no header (linha 279).
- Remover o `import { Select }` se ficar sem uso.

- [ ] **Step 2: Verificar no browser**

Rodar o dev server e conferir que o menu carrega sem "Ranking Público"/"Times", com "Amigos", e sem seletor de grupo no header. (Preview: `resenha-client` + `resenha-server`; login exige Steam OAuth real, então validar ao menos que o app monta sem erro de console.)

Run: `cd site/client && npx vitest run`
Expected: PASS (suíte de client inteira).

- [ ] **Step 3: Commit**

```bash
git add site/client/src/components/Shell.jsx
git commit -m "refactor: Shell sem SeletorGrupo/Ranking Publico/Times; Jogadores vira Amigos"
```

---

## Task 16: Client — página Amigos (substitui Jogadores)

Lista amigos + pedidos pendentes (receber/aceitar/recusar, enviados/cancelar) + adicionar amigo. Herda o alerta de VAC/Game ban da antiga Jogadores.

**Files:**
- Create: `site/client/src/pages/Amigos.jsx`
- Delete: `site/client/src/pages/Jogadores.jsx`
- Create: `site/client/src/test/Amigos.test.jsx`

- [ ] **Step 1: Escrever o teste**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Amigos from '../pages/Amigos.jsx'

function mockFetch(map) {
  return vi.fn((url) => {
    for (const [needle, body] of map) if (String(url).includes(needle)) return Promise.resolve({ ok: true, json: async () => body })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

describe('Amigos', () => {
  beforeEach(() => { global.fetch = mockFetch([
    ['/api/amigos', { amigos: [{ steamId: '1', nick: 'AmigoUm', avatarUrl: null }], recebidos: [{ steamId: '2', nick: 'Pediu', avatarUrl: null }], enviados: [] }],
    ['/api/players/bans', []],
  ]) })

  it('mostra amigos e pedidos recebidos', async () => {
    render(<MemoryRouter><Amigos /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('AmigoUm')).toBeInTheDocument())
    expect(screen.getByText('Pediu')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/client && npx vitest run src/test/Amigos.test.jsx`
Expected: FAIL — `Amigos.jsx` não existe.

- [ ] **Step 3: Escrever `Amigos.jsx`**

Base na `Jogadores.jsx` atual (mantém avatar + tag admin + alerta de ban), somando as três listas e as ações. Buscar de `/api/amigos` e `/api/players/bans`.

```jsx
import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Card, SectionHeader, Badge } from '../components/ui'

function LinhaJogador({ j, ban, acao }) {
  return (
    <Card className="flex items-center gap-3 p-3">
      {j.avatarUrl && <img src={j.avatarUrl} alt="" className="panel-cut-sm h-8 w-8 shrink-0 border border-borda object-cover" />}
      <Link to={`/jogador/${j.steamId}`} className="min-w-0 flex-1 truncate font-mono text-sm text-texto hover:text-destaque">
        {j.nick || j.steamId}
      </Link>
      {ban?.vacBanned && <Badge tom="perigo" title={`VAC ban — ${ban.numVacBans} conta(s)`}>VAC ban</Badge>}
      {!ban?.vacBanned && ban?.gameBanned && <Badge tom="perigo" title={`Game ban — ${ban.numGameBans}`}>Game ban</Badge>}
      {acao}
    </Card>
  )
}

export default function Amigos() {
  const [dados, setDados] = useState({ amigos: [], recebidos: [], enviados: [] })
  const [bans, setBans] = useState(null)
  const [novo, setNovo] = useState('')
  const [erro, setErro] = useState(null)

  const recarregar = useCallback(() => {
    fetch('/api/amigos').then((r) => (r.ok ? r.json() : { amigos: [], recebidos: [], enviados: [] })).then(setDados)
  }, [])

  useEffect(() => {
    recarregar()
    fetch('/api/players/bans').then((r) => (r.ok ? r.json() : [])).then((rows) => setBans(new Map(rows.map((r) => [r.steamId, r.ban])))).catch(() => setBans(new Map()))
  }, [recarregar])

  async function pedir(e) {
    e.preventDefault()
    setErro(null)
    const res = await fetch('/api/amigos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ steamId: novo.trim().split('/').filter(Boolean).pop() }) })
    if (!res.ok) return setErro((await res.json().catch(() => ({}))).erro ?? 'Erro ao adicionar')
    setNovo(''); recarregar()
  }
  const aceitar = async (steamId) => { await fetch(`/api/amigos/${steamId}/aceitar`, { method: 'POST' }); recarregar() }
  const remover = async (steamId) => { await fetch(`/api/amigos/${steamId}`, { method: 'DELETE' }); recarregar() }

  const btn = 'panel-cut-sm shrink-0 border px-2 py-1 font-mono text-[11px] uppercase tracking-wide'

  return (
    <div className="space-y-6">
      <SectionHeader titulo="Amigos" acao={<span className="font-mono text-xs text-texto-fraco">{dados.amigos.length} amigo(s)</span>} />

      <Card className="p-4">
        <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-texto">Adicionar amigo</h3>
        <form onSubmit={pedir} className="flex gap-2">
          <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="SteamID64 ou link do perfil" className="panel-cut-sm min-h-10 flex-1 border border-borda bg-superficie px-3 py-2 font-mono text-sm" />
          <button type="submit" disabled={!novo.trim()} className={`${btn} border-destaque bg-destaque text-fundo disabled:opacity-40`}>Pedir</button>
        </form>
        {erro && <p className="mt-2 font-mono text-sm text-perigo">{erro}</p>}
      </Card>

      {dados.recebidos.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">Pedidos recebidos</h3>
          {dados.recebidos.map((j) => (
            <LinhaJogador key={j.steamId} j={j} ban={bans?.get(j.steamId)} acao={
              <span className="flex gap-1">
                <button onClick={() => aceitar(j.steamId)} className={`${btn} border-sucesso text-sucesso`}>Aceitar</button>
                <button onClick={() => remover(j.steamId)} className={`${btn} border-borda text-texto-fraco`}>Recusar</button>
              </span>
            } />
          ))}
        </section>
      )}

      {dados.enviados.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">Pedidos enviados</h3>
          {dados.enviados.map((j) => (
            <LinhaJogador key={j.steamId} j={j} ban={bans?.get(j.steamId)} acao={
              <button onClick={() => remover(j.steamId)} className={`${btn} border-borda text-texto-fraco`}>Cancelar</button>
            } />
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">Amigos</h3>
        {dados.amigos.length === 0
          ? <p className="font-mono text-sm text-texto-fraco">Você ainda não tem amigos. Adicione pelo SteamID acima.</p>
          : dados.amigos.map((j) => (
            <LinhaJogador key={j.steamId} j={j} ban={bans?.get(j.steamId)} acao={
              <button onClick={() => remover(j.steamId)} className={`${btn} border-borda text-texto-fraco hover:border-perigo hover:text-perigo`}>Remover</button>
            } />
          ))}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Deletar `Jogadores.jsx`**

`git rm site/client/src/pages/Jogadores.jsx` (App.jsx já aponta pra `Amigos` desde a Task 14).

- [ ] **Step 5: Rodar e ver passar**

Run: `cd site/client && npx vitest run src/test/Amigos.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/client/src/pages/Amigos.jsx site/client/src/test/Amigos.test.jsx
git rm site/client/src/pages/Jogadores.jsx
git commit -m "feat: pagina Amigos (lista + pedidos + adicionar), substitui Jogadores"
```

---

## Task 17: Client — deletar páginas mortas e limpar Perfil/JogadorPerfil

**Files:**
- Delete: `site/client/src/pages/Onboarding.jsx`, `site/client/src/pages/AceitarConvite.jsx`, `site/client/src/pages/RankingPublico.jsx`, `site/client/src/pages/Times.jsx`, `site/client/src/pages/CompararTimes.jsx`
- Modify: `site/client/src/pages/Perfil.jsx`, `site/client/src/pages/JogadorPerfil.jsx`

- [ ] **Step 1: Deletar as páginas órfãs**

```bash
git rm site/client/src/pages/Onboarding.jsx site/client/src/pages/AceitarConvite.jsx site/client/src/pages/RankingPublico.jsx site/client/src/pages/Times.jsx site/client/src/pages/CompararTimes.jsx
```

- [ ] **Step 2: Limpar `Perfil.jsx`**

Remover a seção de gerar convite de grupo (usa `jogador.grupoAtivoId` + `/api/groups/.../convites`, linha ~61), a seção de webhook do Discord (`/api/groups/.../discord-webhook`, linha ~83) e o toggle de Ranking Público (`/api/players/me/ranking-publico`). Buscar e remover todos os blocos que referenciam `grupo`/`discord`/`ranking-publico`/`publico` nesse arquivo.

- [ ] **Step 3: Limpar `JogadorPerfil.jsx`**

Remover o modo `?publico=1` (leitura de `searchParams`/links com `?publico`). O perfil sempre carrega no modo autenticado normal.

- [ ] **Step 4: Confirmar client limpo**

```bash
grep -rn "grupo\|Grupo\|discord\|Discord\|publico\|Publico\|convite\|Times\|Onboarding" site/client/src && echo "AINDA HÁ REFERÊNCIAS" || echo "client limpo"
```
Resolver o que sobrar (ex.: imports mortos).

- [ ] **Step 5: Rodar a suíte inteira do client**

Run: `cd site/client && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/client/src/pages/Perfil.jsx site/client/src/pages/JogadorPerfil.jsx
git rm site/client/src/pages/Onboarding.jsx site/client/src/pages/AceitarConvite.jsx site/client/src/pages/RankingPublico.jsx site/client/src/pages/Times.jsx site/client/src/pages/CompararTimes.jsx
git commit -m "refactor: remove paginas de grupo/convite/ranking-publico/times e limpa Perfil"
```

---

## Task 18: Migração destrutiva (dropar grupos, ranking_publico, group_id)

Só depois que server, client e Coletor pararam de referenciar grupos e já estão deployados. Aplicada pelo controller.

**Files:**
- Create: `supabase/migrations/0038_remove_grupos.sql`

- [ ] **Step 1: Escrever a migração**

```sql
-- Drop final de tudo que era grupo (ver spec 2026-07-21). Só rodar depois que server,
-- client e Coletor pararam de referenciar essas colunas/tabelas e estão em produção.

-- Ranking público (removido da app): coluna some.
alter table players drop column if exists ranking_publico;

-- group_id nas partidas e filas: visibilidade agora é por amizade, ninguém mais lê.
alter table matches drop column if exists group_id;
alter table uploads_pendentes drop column if exists group_id;
alter table faceit_pendentes drop column if exists group_id;

-- grupo ativo do jogador: conceito morto.
alter table players drop column if exists grupo_ativo_id;

-- Discord por grupo: tabela de idempotência + webhook. discord_notifications tem FK
-- pra groups (cascade), mas dropamos explícito na ordem certa.
drop table if exists discord_notifications;

-- Convites e membros e o próprio grupo (webhook_url mora em groups e vai junto).
drop table if exists group_invites;
drop table if exists group_members;
drop table if exists groups;
```

- [ ] **Step 2: Controller aplica em produção e valida**

O controller aplica via Supabase MCP `apply_migration` e confirma:
```sql
select
  (select count(*) from information_schema.columns where table_name='matches' and column_name='group_id') as matches_group_id,
  (select count(*) from information_schema.tables where table_name='groups') as groups_tbl,
  (select count(*) from friendships) as amizades;
```
Esperado: `matches_group_id = 0`, `groups_tbl = 0`, `amizades > 0` (amizades preservadas).

- [ ] **Step 3: Rodar as suítes completas (regressão final)**

Run: `cd site/server && npx vitest run --no-file-parallelism`
Run: `cd site/client && npx vitest run`
Run: `cd coletor && python -m pytest -q`
Expected: todas PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0038_remove_grupos.sql
git commit -m "feat: migracao destrutiva final (dropa grupos, ranking_publico, group_id, discord)"
```

---

## Ordem de deploy (crítica)

1. Task 1 (migração aditiva) — aplicar em produção **antes** de qualquer deploy de código.
2. Tasks 2–17 — server + Coletor + client. Deploy do server/Coletor/client com o código novo (que já não lê `group_id`, mas a coluna ainda existe — tudo bem, ninguém a lê).
3. Task 18 (migração destrutiva) — aplicar **depois** que o código novo está em produção e estável.

Nunca aplicar a Task 18 antes do deploy das Tasks 2–17: o Coletor/servidor antigo ainda em produção quebraria (insert em `matches.group_id` not-null que não existe mais). A ordem aditiva-primeiro / destrutiva-por-último é o que torna o rollout seguro.
