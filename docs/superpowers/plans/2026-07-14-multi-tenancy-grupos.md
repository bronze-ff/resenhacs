# Multi-tenancy (Grupos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a whitelist global por Grupos (N por jogador), login aberto a qualquer Steam, um "grupo ativo" persistido no servidor que escopa Feed/Ranking/Comparar/Jogadores, convite por link, e renomear a flag de admin global pra `is_super_admin` (mantendo Granadas/Táticas/Admin/Partidas Pro restritos só a você).

**Architecture:** Postgres ganha 3 tabelas novas (`groups`, `group_members`, `group_invites`) + `matches.group_id` + `players.grupo_ativo_id`. O grupo ativo é fonte-de-verdade no servidor (coluna em `players`), espelhado em `localStorage` no client só pra um wrapper de `fetch` conseguir anexar o header `X-Group-Id` de forma síncrona em toda chamada `/api/`. Toda rota que lê dado por-grupo passa por um middleware novo (`requireGroupMember`) que valida o header contra `group_members` antes de responder.

**Tech Stack:** Express + node-postgres (server), React Router v6 (client), Vitest/supertest + Vitest/Testing Library (testes).

## Global Constraints

- `players` continua uma tabela global (identidade Steam) — `group_id` NUNCA vai nela; quem liga jogador↔grupo é `group_members`.
- `lineups_curados` e `taticas` **não ganham `group_id`** — permanecem globais (decisão já tomada no spec).
- Toda rota nova ou alterada usa `requireGroupMember` (não confiar no header sem validar contra `group_members` no banco).
- O Coletor Python (job agendado, fora deste repo de rotas web) **não é alterado neste plano** — a coluna `players.grupo_ativo_id` já fica disponível no banco pra ele usar como `group_id` das partidas que descobre sozinho via auto-import; a mudança no código do Coletor fica pra uma iteração seguinte (fora de escopo aqui).
- Trocar de grupo ativo recarrega a página inteira (`window.location.reload()`) no client — simplificação deliberada de MVP em vez de invalidar cache de cada página manualmente.

---

### Task 1: Migration — schema de Grupos + backfill

**Files:**
- Create: `supabase/migrations/0020_grupos.sql`

**Interfaces:**
- Produces: tabelas `groups`, `group_members`, `group_invites`; colunas `matches.group_id` (not null ao final), `players.grupo_ativo_id`, `players.is_super_admin` (renomeada de `is_admin`).

- [ ] **Step 1: Escrever a migration completa**

```sql
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
```

- [ ] **Step 2: Aplicar a migration no Supabase de produção**

Use a ferramenta MCP do Supabase (`apply_migration`, nome `0020_grupos`, mesmo SQL acima) contra o projeto de produção. Depois, `list_tables` pra conferir que `groups`, `group_members`, `group_invites` existem e `matches.group_id` está `not null`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0020_grupos.sql
git commit -m "feat: migration de grupos (multi-tenancy) com backfill do grupo original"
```

---

### Task 2: Servidor — renomear admin global pra super-admin

**Files:**
- Modify: `site/server/src/auth/jwt.js`
- Modify: `site/server/src/auth/middleware.js`
- Modify: `site/server/src/routes/auth.js`
- Modify: `site/server/src/routes/players.js`, `partidasPro.js`, `taticas.js`, `granadas.js`, `taticasCuradas.js`
- Test: `site/server/test/*.test.js` (todos que usam `isAdmin: true/false` no `signToken`)

**Interfaces:**
- Produces: `requireSuperAdmin` (substitui `requireAdmin`), `req.player.isSuperAdmin`, payload JWT `isSuperAdmin`.

- [ ] **Step 1: `jwt.js`**

```js
export function signToken({ steamId, isSuperAdmin }, secret) {
  return jwt.sign({ steamId, isSuperAdmin }, secret, { expiresIn: '7d' })
}
```

- [ ] **Step 2: `middleware.js`**

```js
export function createRequireAuth(jwtSecret) {
  return function requireAuth(req, res, next) {
    const payload = verifyToken(req.cookies?.resenha_token, jwtSecret)
    if (!payload) return res.status(401).json({ erro: 'Não autenticado' })
    req.player = { steamId: payload.steamId, isSuperAdmin: Boolean(payload.isSuperAdmin) }
    next()
  }
}

export function requireSuperAdmin(req, res, next) {
  if (!req.player?.isSuperAdmin) return res.status(403).json({ erro: 'Apenas administradores' })
  next()
}
```

- [ ] **Step 3: `auth.js`** — trocar as duas linhas que leem/gravam `is_admin`/`isAdmin`

Linha 39: `const token = signToken({ steamId, isSuperAdmin: rows[0].is_super_admin }, config.jwtSecret)`
Linha 56 (dentro de `/me`): trocar o `select` pra `is_super_admin` e o `res.json` pra `isSuperAdmin: p.is_super_admin` (a Task 3 volta a mexer nessa rota pro login aberto — aqui só o rename).

- [ ] **Step 4: Trocar `requireAdmin` → `requireSuperAdmin` nos 5 arquivos de rota**

Em `players.js`, `partidasPro.js`, `taticas.js`, `granadas.js`, `taticasCuradas.js`: trocar o import
`import { requireAdmin } from '../auth/middleware.js'` por
`import { requireSuperAdmin } from '../auth/middleware.js'`, e cada uso de `requireAdmin` no meio de uma
chain de rota (`router.get('/', requireAuth, requireAdmin, ...)` etc.) por `requireSuperAdmin`. Em
`players.js`, a linha `isAdmin: p.is_admin` (dentro de `GET /`) vira `isSuperAdmin: p.is_super_admin`
(e a query troca `p.is_admin` por `p.is_super_admin`).

- [ ] **Step 5: Atualizar os testes que assinam token com `isAdmin`**

Em todo arquivo de teste do server que faz `signToken({ steamId: '...', isAdmin: true/false }, ...)`
(granadas.test.js, taticas.test.js, taticasCuradas.test.js, partidasPro.test.js, players.test.js,
auth.test.js — confirmar com `grep -rl "isAdmin" site/server/test`), trocar `isAdmin` por `isSuperAdmin`
nesses `signToken(...)`. Onde o teste faz asserção sobre o corpo de resposta (`isAdmin: true` em
`res.body`), trocar pra `isSuperAdmin: true`.

- [ ] **Step 6: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: PASS em tudo.

- [ ] **Step 7: Commit**

```bash
git add site/server/src/auth site/server/src/routes site/server/test
git commit -m "feat: renomeia admin global para super-admin (is_super_admin)"
```

---

### Task 3: Servidor — login aberto (sem whitelist)

**Files:**
- Modify: `site/server/src/routes/auth.js`

**Interfaces:**
- Consumes: nada novo.
- Produces: login sempre sucede pra qualquer Steam válido; `players` ganha upsert.

- [ ] **Step 1: Trocar o lookup por upsert em `GET /steam/return`**

Substituir (linhas 24–28 do arquivo original, já renumeradas pela Task 2):

```js
    const { rows } = await db.query(
      'select steam_id64, is_super_admin from players where steam_id64 = $1',
      [steamId],
    )
    if (rows.length === 0) return res.redirect(`${config.appUrl}/acesso-negado`)
```

por:

```js
    const { rows } = await db.query(
      `insert into players (steam_id64) values ($1)
       on conflict (steam_id64) do nothing
       returning steam_id64, is_super_admin`,
      [steamId],
    )
    // on conflict do nothing não retorna linha se já existia — busca de novo.
    const jogador = rows[0] ?? (await db.query(
      'select steam_id64, is_super_admin from players where steam_id64 = $1',
      [steamId],
    )).rows[0]
```

E a linha logo abaixo que usava `rows[0].is_admin` no `signToken` passa a usar `jogador.is_super_admin`.

- [ ] **Step 2: Atualizar o teste de login que hoje espera redirect pra `/acesso-negado`**

Em `site/server/test/auth.test.js`, localizar o teste de "steamId fora da whitelist" (ou equivalente) e
trocar a asserção: em vez de esperar redirect pra `/acesso-negado`, esperar sucesso (redirect pro
`appUrl`, cookie setado) — ler o teste primeiro (`Read site/server/test/auth.test.js`) antes de editar,
pra manter o resto do arquivo intacto e não duplicar mocks de `db.query`.

- [ ] **Step 3: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add site/server/src/routes/auth.js site/server/test/auth.test.js
git commit -m "feat: login Steam sem whitelist (upsert em players)"
```

---

### Task 4: Servidor — router de Grupos + convites + `requireGroupMember`

**Files:**
- Create: `site/server/src/routes/groups.js`
- Modify: `site/server/src/auth/middleware.js`
- Modify: `site/server/src/app.js`
- Modify: `site/server/src/routes/auth.js` (`GET /me` passa a incluir `grupoAtivoId`)
- Test: `site/server/test/groups.test.js`

**Interfaces:**
- Produces: `requireGroupMember(db)` (middleware factory, seta `req.groupId`); rotas
  `POST /api/groups`, `GET /api/groups/meus`, `PUT /api/groups/ativo`,
  `POST /api/groups/:id/convites`, `GET /api/convites/:token`, `POST /api/convites/:token/aceitar`.
- Consumes: `requireAuth`, `db`.

- [ ] **Step 1: `requireGroupMember` em `middleware.js`**

```js
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createRequireGroupMember(db) {
  return async function requireGroupMember(req, res, next) {
    const groupId = req.get('X-Group-Id')
    if (!groupId || !UUID_RE.test(groupId)) {
      return res.status(400).json({ erro: 'Cabeçalho X-Group-Id ausente ou inválido' })
    }
    const { rows } = await db.query(
      'select 1 from group_members where group_id = $1 and steam_id64 = $2',
      [groupId, req.player.steamId],
    )
    if (rows.length === 0) return res.status(403).json({ erro: 'Você não pertence a esse grupo' })
    req.groupId = groupId
    next()
  }
}
```

- [ ] **Step 2: `groups.js`**

```js
import { Router } from 'express'

export function createGroupsRouter({ db }) {
  const router = Router()

  router.post('/', async (req, res) => {
    const nome = String(req.body?.nome ?? '').trim()
    if (!nome || nome.length > 60) {
      return res.status(400).json({ erro: 'Nome do grupo é obrigatório (até 60 caracteres)' })
    }
    const client = await db.connect()
    try {
      await client.query('begin')
      const { rows } = await client.query(
        'insert into groups (nome, criado_por) values ($1, $2) returning id, nome',
        [nome, req.player.steamId],
      )
      const grupo = rows[0]
      await client.query(
        "insert into group_members (group_id, steam_id64, role) values ($1, $2, 'admin')",
        [grupo.id, req.player.steamId],
      )
      await client.query('update players set grupo_ativo_id = $1 where steam_id64 = $2', [
        grupo.id,
        req.player.steamId,
      ])
      await client.query('commit')
      res.status(201).json({ id: grupo.id, nome: grupo.nome })
    } catch (err) {
      await client.query('rollback')
      throw err
    } finally {
      client.release()
    }
  })

  router.get('/meus', async (req, res) => {
    const { rows } = await db.query(
      `select g.id, g.nome, gm.role
       from group_members gm join groups g on g.id = gm.group_id
       where gm.steam_id64 = $1 order by g.nome`,
      [req.player.steamId],
    )
    res.json(rows.map((r) => ({ id: r.id, nome: r.nome, role: r.role })))
  })

  router.put('/ativo', async (req, res) => {
    const groupId = String(req.body?.groupId ?? '')
    const { rows } = await db.query(
      'select 1 from group_members where group_id = $1 and steam_id64 = $2',
      [groupId, req.player.steamId],
    )
    if (rows.length === 0) return res.status(403).json({ erro: 'Você não pertence a esse grupo' })
    await db.query('update players set grupo_ativo_id = $1 where steam_id64 = $2', [
      groupId,
      req.player.steamId,
    ])
    res.json({ ok: true, groupId })
  })

  router.post('/:id/convites', async (req, res) => {
    const { rows: membro } = await db.query(
      "select role from group_members where group_id = $1 and steam_id64 = $2",
      [req.params.id, req.player.steamId],
    )
    if (membro.length === 0 || membro[0].role !== 'admin') {
      return res.status(403).json({ erro: 'Só o admin do grupo pode gerar convite' })
    }
    const { rows } = await db.query(
      'insert into group_invites (group_id, criado_por) values ($1, $2) returning token',
      [req.params.id, req.player.steamId],
    )
    res.status(201).json({ token: rows[0].token })
  })

  return router
}

export function createConvitesRouter({ db }) {
  const router = Router()

  router.get('/:token', async (req, res) => {
    const { rows } = await db.query(
      `select gi.revogado_em, g.nome
       from group_invites gi join groups g on g.id = gi.group_id
       where gi.token = $1`,
      [req.params.token],
    )
    if (rows.length === 0) return res.status(404).json({ erro: 'Convite não encontrado' })
    if (rows[0].revogado_em) return res.status(410).json({ erro: 'Convite revogado' })
    res.json({ grupoNome: rows[0].nome })
  })

  router.post('/:token/aceitar', async (req, res) => {
    const { rows } = await db.query(
      `select gi.group_id, gi.revogado_em, g.nome
       from group_invites gi join groups g on g.id = gi.group_id
       where gi.token = $1`,
      [req.params.token],
    )
    if (rows.length === 0) return res.status(404).json({ erro: 'Convite não encontrado' })
    if (rows[0].revogado_em) return res.status(410).json({ erro: 'Convite revogado' })
    const groupId = rows[0].group_id
    await db.query(
      `insert into group_members (group_id, steam_id64) values ($1, $2)
       on conflict (group_id, steam_id64) do nothing`,
      [groupId, req.player.steamId],
    )
    await db.query('update players set grupo_ativo_id = $1 where steam_id64 = $2', [
      groupId,
      req.player.steamId,
    ])
    res.json({ ok: true, groupId, nome: rows[0].nome })
  })

  return router
}
```

- [ ] **Step 3: Montar as rotas em `app.js`**

Adicionar aos imports:

```js
import { createGroupsRouter, createConvitesRouter } from './routes/groups.js'
```

E depois da linha `app.use('/api/players', ...)`:

```js
  app.use('/api/groups', requireAuth, createGroupsRouter({ db }))
  app.use('/api/convites', requireAuth, createConvitesRouter({ db }))
```

- [ ] **Step 4: `GET /api/auth/me` passa a incluir `grupoAtivoId`**

Em `auth.js`, dentro de `/me`: adicionar `grupo_ativo_id` no `select` e `grupoAtivoId: p.grupo_ativo_id`
no `res.json`.

- [ ] **Step 5: Escrever `site/server/test/groups.test.js`**

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookieA = `resenha_token=${signToken({ steamId: '111' }, config.jwtSecret)}`
const cookieB = `resenha_token=${signToken({ steamId: '222' }, config.jwtSecret)}`

function appWith(handlers, connectHandlers = handlers) {
  const query = vi.fn().mockImplementation((sql) => {
    for (const [needle, rows] of handlers) {
      if (sql.includes(needle)) return Promise.resolve({ rows })
    }
    return Promise.resolve({ rows: [] })
  })
  const clientQuery = vi.fn().mockImplementation((sql) => {
    for (const [needle, rows] of connectHandlers) {
      if (sql.includes(needle)) return Promise.resolve({ rows })
    }
    return Promise.resolve({ rows: [] })
  })
  const client = { query: clientQuery, release: vi.fn() }
  const db = { query, connect: vi.fn().mockResolvedValue(client) }
  return { app: createApp({ config, db }), db, client }
}

describe('POST /api/groups', () => {
  it('cria grupo, vira admin e grupo ativo', async () => {
    const { app, client } = appWith([
      ['insert into groups', [{ id: 'g1', nome: 'Time A' }]],
    ])
    const res = await request(app).post('/api/groups').set('Cookie', cookieA).send({ nome: 'Time A' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 'g1', nome: 'Time A' })
    expect(client.query.mock.calls.some((c) => c[0].includes('insert into group_members'))).toBe(true)
  })

  it('sem nome: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/groups').set('Cookie', cookieA).send({ nome: '  ' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/groups/meus', () => {
  it('lista grupos do jogador logado', async () => {
    const { app } = appWith([['from group_members', [{ id: 'g1', nome: 'Time A', role: 'admin' }]]])
    const res = await request(app).get('/api/groups/meus').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 'g1', nome: 'Time A', role: 'admin' }])
  })
})

describe('POST /api/groups/:id/convites', () => {
  it('nao-admin do grupo: 403', async () => {
    const { app } = appWith([['role from group_members', [{ role: 'membro' }]]])
    const res = await request(app).post('/api/groups/g1/convites').set('Cookie', cookieA)
    expect(res.status).toBe(403)
  })

  it('admin do grupo gera convite', async () => {
    const { app } = appWith([
      ['role from group_members', [{ role: 'admin' }]],
      ['insert into group_invites', [{ token: 'tok1' }]],
    ])
    const res = await request(app).post('/api/groups/g1/convites').set('Cookie', cookieA)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ token: 'tok1' })
  })
})

describe('POST /api/convites/:token/aceitar', () => {
  it('convite revogado: 410', async () => {
    const { app } = appWith([
      ['from group_invites', [{ group_id: 'g1', revogado_em: '2026-01-01', nome: 'Time A' }]],
    ])
    const res = await request(app).post('/api/convites/tok1/aceitar').set('Cookie', cookieB)
    expect(res.status).toBe(410)
  })

  it('aceita e vira grupo ativo', async () => {
    const { app, db } = appWith([
      ['from group_invites', [{ group_id: 'g1', revogado_em: null, nome: 'Time A' }]],
    ])
    const res = await request(app).post('/api/convites/tok1/aceitar').set('Cookie', cookieB)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, groupId: 'g1', nome: 'Time A' })
    expect(db.query.mock.calls.some((c) => c[0].includes('update players set grupo_ativo_id'))).toBe(true)
  })
})
```

- [ ] **Step 6: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add site/server/src/routes/groups.js site/server/src/auth/middleware.js site/server/src/app.js site/server/src/routes/auth.js site/server/test/groups.test.js
git commit -m "feat: rotas de grupos, convites e requireGroupMember"
```

---

### Task 5: Servidor — escopar Feed/Ranking/Jogadores/Comparar por grupo ativo

**Files:**
- Modify: `site/server/src/routes/matches.js`
- Modify: `site/server/src/routes/ranking.js`
- Modify: `site/server/src/routes/players.js`
- Modify: `site/server/src/app.js`
- Test: `site/server/test/matches.test.js`, `ranking.test.js`, `players.test.js`

**Interfaces:**
- Consumes: `requireGroupMember` (Task 4), `req.groupId`.

- [ ] **Step 1: Montar `requireGroupMember` nas rotas escopadas em `app.js`**

Trocar:

```js
  app.use('/api/matches', createMatchesRouter({ db, requireAuth, r2Client, r2Bucket: config.r2Bucket }))
  ...
  app.use('/api/ranking', createRankingRouter({ db, requireAuth }))
```

por (criar o middleware uma vez e passar pros routers que precisam):

```js
  const requireGroupMember = createRequireGroupMember(db)
  app.use('/api/matches', createMatchesRouter({ db, requireAuth, requireGroupMember, r2Client, r2Bucket: config.r2Bucket }))
  ...
  app.use('/api/ranking', createRankingRouter({ db, requireAuth, requireGroupMember }))
```

(import `createRequireGroupMember` de `./auth/middleware.js`, junto de `createRequireAuth`.) `players.js`
recebe o mesmo tratamento na Step 3 abaixo.

- [ ] **Step 2: `matches.js` — filtrar por `req.groupId`**

Assinatura do router ganha `requireGroupMember`:

```js
export function createMatchesRouter({ db, requireAuth, requireGroupMember, r2Client, r2Bucket }) {
```

`GET /` (listagem): adicionar `requireGroupMember` na chain e um `and m.group_id = $N` na query. A
condição de grupo entra ANTES do `mvpJoin` ser montado, porque também usa `params`:

```js
  router.get('/', requireAuth, requireGroupMember, async (req, res) => {
    const cond = ["m.status = 'parsed'"]
    const params = []
    const { from, to, map, source, mvp } = req.query
    params.push(req.groupId)
    cond.push(`m.group_id = $${params.length}`)
    let limit = parseInt(req.query.limit, 10)
    ...
```

(o resto da função continua igual — os `params.push` seguintes já respeitam `params.length` dinamicamente,
então inserir o group_id primeiro não quebra nada.)

`GET /:id`: adicionar `requireGroupMember` e o filtro na query principal:

```js
  router.get('/:id', requireAuth, requireGroupMember, async (req, res) => {
    const { id } = req.params
    const matchQ = await db.query(
      'select id, map, played_at, score_a, score_b, source, status, demo_url, replay_url from matches where id = $1 and group_id = $2',
      [id, req.groupId],
    )
```

`GET /:id/replay` e `GET /:id/demo`: mesma coisa — adicionar `requireGroupMember` e
`and group_id = $2` / `[req.params.id, req.groupId]` nas respectivas queries de `select replay_url`/
`select demo_url`.

`GET /sync-status` **não muda** — é uma contagem agregada de todo o Coletor (pending/failed/parsed),
não expõe conteúdo de nenhuma Partida específica; decisão deliberada de deixar global (documentada nos
Global Constraints).

- [ ] **Step 3: Atualizar `matches.test.js`**

Ler `site/server/test/matches.test.js` primeiro. Toda chamada que hoje faz
`.set('Cookie', cookieJogador)` ou similar em `/api/matches...` passa a precisar também de
`.set('X-Group-Id', 'g1')` (usar um uuid fixo de teste, ex. `'11111111-1111-1111-1111-111111111111'`), e
o `appWith(...)` desse arquivo precisa responder `[rows]` não-vazio pra query de
`from group_members where group_id` (senão todo teste cai em 403 do `requireGroupMember`). Adicionar esse
handler no helper `appWith` do arquivo (`['from group_members', [{ }]]` — uma linha basta pra "é membro").
Adicionar também 1 teste novo: sem o header `X-Group-Id`, `GET /api/matches` retorna 400.

- [ ] **Step 4: `ranking.js` e `players.js` — mesmo padrão**

`ranking.js`: assinatura ganha `requireGroupMember`; a rota `GET /` ganha `requireGroupMember` na chain,
e a query principal precisa que `mp` (o `left join` de `match_players`) só traga partidas do grupo — como
já filtra por `join matches m on m.id = mp.match_id`, o `where true${periodo}` vira
`where m.group_id = $N${periodo}` (adicionar `req.groupId` no início de `params`, igual matches.js). O
`from players p` continua sem filtro (queremos mostrar todo mundo que já jogou no grupo mesmo que hoje
tenha 0 partidas nesse grupo específico seria estranho — então em vez disso, trocar `from players p` por
`from (select distinct steam_id64 from group_members where group_id = $1) gm join players p on p.steam_id64 = gm.steam_id64`,
mantendo `req.groupId` como primeiro parâmetro).

`players.js`: `GET /` (lista "Jogadores") ganha `requireGroupMember` e troca
`from players p` por `from group_members gm join players p on p.steam_id64 = gm.steam_id64 where gm.group_id = $1`
(primeiro parâmetro = `req.groupId`). `GET /bans` e `POST /`, `POST /promote`, `PUT /me` **não mudam** — bans
e cadastro/promoção continuam globais (cadastro de super-admin, fora do fluxo de grupo por ora).

- [ ] **Step 5: Atualizar `ranking.test.js` e `players.test.js`**

Mesmo padrão da Step 3: ler os arquivos primeiro, adicionar `.set('X-Group-Id', ...)` nas chamadas às
rotas alteradas e um handler de `from group_members`/`group_id` no `appWith` de cada arquivo.

- [ ] **Step 6: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add site/server/src/app.js site/server/src/routes/matches.js site/server/src/routes/ranking.js site/server/src/routes/players.js site/server/test/matches.test.js site/server/test/ranking.test.js site/server/test/players.test.js
git commit -m "feat: escopa feed, ranking e lista de jogadores pelo grupo ativo"
```

---

### Task 6: Servidor — escopar Comparar (`profile.js`) por grupo

**Files:**
- Modify: `site/server/src/routes/profile.js`
- Modify: `site/server/src/app.js`
- Test: `site/server/test/profile.test.js`

**Interfaces:**
- Consumes: `requireGroupMember`.

- [ ] **Step 1: Ler `profile.js` inteiro antes de editar**

Read: `site/server/src/routes/profile.js` — o arquivo tem várias queries que fazem
`join matches m on m.id = mp.match_id` (linhas identificadas: 66, 135, 157, 180, 284, 372, 380 na versão
atual). Cada uma delas precisa ganhar `and m.group_id = $N` na cláusula `where`/`join ... on`, com
`req.groupId` entrado nos `params` daquela query específica. As duas ocorrências de `from players p`
(linhas 266 e 351) que buscam o jogador em si (não a agregação de partidas) **não mudam** — a identidade
do jogador é global, só as partidas/stats agregadas são por grupo.

- [ ] **Step 2: Montar `requireGroupMember` na rota `GET /compare` (e nas demais rotas do router que
agregam partidas) em `app.js`**

```js
  app.use('/api/profile', createProfileRouter({ db, requireAuth, requireGroupMember }))
```

E dentro de `profile.js`, cada `router.get(...)` que hoje só tem `requireAuth` na chain e toca
`match_players`/`matches` ganha `requireGroupMember` também, e cada uma dessas queries recebe
`req.groupId` como parâmetro adicional na posição usada pelo novo `and m.group_id = $N`.

- [ ] **Step 3: Atualizar `profile.test.js`**

Mesmo padrão das tasks anteriores: ler o arquivo primeiro, adicionar `X-Group-Id` nas chamadas e o
handler de "é membro" no `appWith`.

- [ ] **Step 4: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/profile.js site/server/src/app.js site/server/test/profile.test.js
git commit -m "feat: escopa comparar/perfil pelo grupo ativo"
```

---

### Task 7: Servidor — login com redirect pós-convite

**Files:**
- Modify: `site/server/src/routes/auth.js`

**Interfaces:**
- Produces: `GET /api/auth/steam?returnTo=/convite/:token` preserva o destino pós-login.

- [ ] **Step 1: `GET /steam` aceita `returnTo` e guarda num cookie curto**

```js
  router.get('/steam', (req, res) => {
    const returnTo = String(req.query.returnTo ?? '')
    // só aceita path relativo interno — nunca um destino externo (open redirect).
    if (/^\/[a-zA-Z0-9/_-]*$/.test(returnTo)) {
      res.cookie('resenha_post_login', returnTo, { httpOnly: true, sameSite: 'lax', maxAge: 5 * 60 * 1000 })
    }
    res.redirect(buildSteamRedirectUrl(config.appUrl))
  })
```

- [ ] **Step 2: `GET /steam/return` usa o cookie no redirect final**

Trocar a linha final `res.redirect(config.appUrl)` por:

```js
    const destino = req.cookies?.resenha_post_login
    res.clearCookie('resenha_post_login')
    res.redirect(destino ? `${config.appUrl}${destino}` : config.appUrl)
```

- [ ] **Step 3: Teste**

Em `site/server/test/auth.test.js`, adicionar um teste: `GET /api/auth/steam?returnTo=/convite/tok1`
seta o cookie `resenha_post_login=/convite/tok1`; um login válido em seguida (mock de
`verifySteamLogin`) redireciona pra `${appUrl}/convite/tok1` em vez do `appUrl` puro.

- [ ] **Step 4: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/auth.js site/server/test/auth.test.js
git commit -m "feat: preserva destino pos-login (fluxo de convite)"
```

---

### Task 8: Client — grupo ativo (fetch wrapper + AuthContext)

**Files:**
- Create: `site/client/src/lib/grupoAtivo.js`
- Modify: `site/client/src/main.jsx`
- Modify: `site/client/src/auth/AuthContext.jsx`
- Test: `site/client/src/test/ui.test.jsx` (ou novo arquivo, se preferir isolar)

**Interfaces:**
- Produces: `getGrupoAtivo()`, `setGrupoAtivo(id)` (módulo síncrono, cache em memória + `localStorage`).
- Consumes: nada.

- [ ] **Step 1: `lib/grupoAtivo.js`**

```js
const CHAVE = 'resenha_grupo_ativo'
let cache = null
try {
  cache = localStorage.getItem(CHAVE)
} catch {
  cache = null
}

export function getGrupoAtivo() {
  return cache
}

export function setGrupoAtivo(groupId) {
  cache = groupId || null
  try {
    if (groupId) localStorage.setItem(CHAVE, groupId)
    else localStorage.removeItem(CHAVE)
  } catch {
    // ignora (ex.: storage indisponível)
  }
}
```

- [ ] **Step 2: Instalar o wrapper de `fetch` em `main.jsx`, antes do `createRoot`**

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { getGrupoAtivo } from './lib/grupoAtivo.js'
import './index.css'

// Anexa X-Group-Id em toda chamada /api/ automaticamente — evita editar cada
// fetch() espalhado pelas páginas pra escopar por grupo.
const fetchOriginal = window.fetch.bind(window)
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url ?? ''
  const grupoId = getGrupoAtivo()
  if (url.startsWith('/api/') && grupoId) {
    init = { ...init, headers: { ...(init.headers ?? {}), 'X-Group-Id': grupoId } }
  }
  return fetchOriginal(input, init)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 3: `AuthContext.jsx` sincroniza o cache com o `grupoAtivoId` do servidor**

```jsx
import { createContext, useContext, useEffect, useState } from 'react'
import { getGrupoAtivo, setGrupoAtivo } from '../lib/grupoAtivo.js'

const AuthContext = createContext({ carregando: true, jogador: null })

export function AuthProvider({ children }) {
  const [estado, setEstado] = useState({ carregando: true, jogador: null })

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((jogador) => {
        // Primeira carga: o cache local pode estar vazio (dispositivo novo) ou
        // desatualizado (trocou de grupo em outra aba/dispositivo) — o servidor manda.
        if (jogador?.grupoAtivoId && jogador.grupoAtivoId !== getGrupoAtivo()) {
          setGrupoAtivo(jogador.grupoAtivoId)
        }
        setEstado({ carregando: false, jogador })
      })
      .catch(() => setEstado({ carregando: false, jogador: null }))
  }, [])

  return <AuthContext.Provider value={estado}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
```

- [ ] **Step 4: Rodar a suíte do client**

Run: `cd site/client && npm run build && npm test`
Expected: build limpo, testes PASS (o `App.test.jsx` mocka `/api/auth/me` sem `grupoAtivoId` — o `if`
acima trata `undefined` como falsy e não quebra).

- [ ] **Step 5: Commit**

```bash
git add site/client/src/lib/grupoAtivo.js site/client/src/main.jsx site/client/src/auth/AuthContext.jsx
git commit -m "feat: grupo ativo sincronizado via fetch wrapper + AuthContext"
```

---

### Task 9: Client — seletor de grupo no Shell + onboarding + aceitar convite

**Files:**
- Create: `site/client/src/pages/Onboarding.jsx`
- Create: `site/client/src/pages/AceitarConvite.jsx`
- Modify: `site/client/src/components/Shell.jsx`
- Modify: `site/client/src/App.jsx`

**Interfaces:**
- Consumes: `GET /api/groups/meus`, `POST /api/groups`, `PUT /api/groups/ativo`,
  `GET /api/convites/:token`, `POST /api/convites/:token/aceitar`, `getGrupoAtivo`/`setGrupoAtivo`.

- [ ] **Step 1: `Onboarding.jsx`**

```jsx
import { useState } from 'react'
import { Card, SectionHeader } from '../components/ui'
import { setGrupoAtivo } from '../lib/grupoAtivo.js'

export default function Onboarding() {
  const [nome, setNome] = useState('')
  const [tokenConvite, setTokenConvite] = useState('')
  const [erro, setErro] = useState(null)
  const [enviando, setEnviando] = useState(false)

  async function criar(e) {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome }),
    })
    const body = await res.json().catch(() => ({}))
    setEnviando(false)
    if (!res.ok) return setErro(body.erro ?? 'Erro ao criar grupo')
    setGrupoAtivo(body.id)
    window.location.href = '/'
  }

  function irParaConvite(e) {
    e.preventDefault()
    const token = tokenConvite.trim().split('/').pop()
    if (token) window.location.href = `/convite/${token}`
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-10">
      <SectionHeader titulo="Bem-vindo ao Resenha" />
      <p className="font-mono text-sm text-texto-fraco">
        Você ainda não faz parte de nenhum grupo. Crie o seu ou entre com um link de convite.
      </p>

      <Card className="p-4 sm:p-5">
        <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-texto">
          Criar um grupo
        </h3>
        <form onSubmit={criar} className="space-y-3">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do grupo"
            className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={!nome.trim() || enviando}
            className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo disabled:opacity-40"
          >
            Criar grupo
          </button>
        </form>
      </Card>

      <Card className="p-4 sm:p-5">
        <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-texto">
          Tenho um convite
        </h3>
        <form onSubmit={irParaConvite} className="space-y-3">
          <input
            value={tokenConvite}
            onChange={(e) => setTokenConvite(e.target.value)}
            placeholder="Cole o link do convite"
            className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={!tokenConvite.trim()}
            className="panel-cut-sm min-h-10 w-full border border-borda px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-texto disabled:opacity-40"
          >
            Continuar
          </button>
        </form>
      </Card>

      {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}
    </div>
  )
}
```

- [ ] **Step 2: `AceitarConvite.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card, SectionHeader } from '../components/ui'
import { useAuth } from '../auth/AuthContext.jsx'
import { setGrupoAtivo } from '../lib/grupoAtivo.js'

export default function AceitarConvite() {
  const { token } = useParams()
  const { carregando, jogador } = useAuth()
  const [info, setInfo] = useState(null)
  const [erro, setErro] = useState(null)
  const [aceitando, setAceitando] = useState(false)

  useEffect(() => {
    if (!jogador) return
    fetch(`/api/convites/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).erro ?? 'Convite inválido')
        return res.json()
      })
      .then(setInfo)
      .catch((e) => setErro(e.message))
  }, [token, jogador])

  async function aceitar() {
    setAceitando(true)
    const res = await fetch(`/api/convites/${token}/aceitar`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setAceitando(false)
      return setErro(body.erro ?? 'Erro ao aceitar convite')
    }
    setGrupoAtivo(body.groupId)
    window.location.href = '/'
  }

  if (carregando) return <p className="p-8 text-texto-fraco">Carregando…</p>
  if (!jogador) {
    window.location.href = `/api/auth/steam?returnTo=${encodeURIComponent(`/convite/${token}`)}`
    return <p className="p-8 text-texto-fraco">Redirecionando pro login…</p>
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <SectionHeader titulo="Convite de grupo" />
      <Card className="mt-4 p-4 sm:p-5">
        {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}
        {!erro && !info && <p className="font-mono text-sm text-texto-fraco">Carregando convite…</p>}
        {info && (
          <div className="space-y-3">
            <p className="font-mono text-sm text-texto">
              Você foi convidado pro grupo <span className="text-destaque">{info.grupoNome}</span>.
            </p>
            <button
              onClick={aceitar}
              disabled={aceitando}
              className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo disabled:opacity-40"
            >
              Entrar no grupo
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Rotas em `App.jsx`**

Adicionar import de `Onboarding` e `AceitarConvite`, e as rotas:

```jsx
          <Route path="/convite/:token" element={<AceitarConvite />} />
          <Route path="/bem-vindo" element={<RotaProtegida><Onboarding /></RotaProtegida>} />
```

(`/convite/:token` fica FORA do `RotaProtegida` porque a própria página trata o caso deslogado
redirecionando pro Steam com `returnTo`.)

- [ ] **Step 4: `RotaProtegida` redireciona pra onboarding quando não há grupo ativo**

Em `App.jsx`, `RotaProtegida`:

```jsx
function RotaProtegida({ children }) {
  const { carregando, jogador } = useAuth()
  if (carregando) return <p className="p-8 text-texto-fraco">Carregando…</p>
  if (!jogador) return <Navigate to="/entrar" replace />
  if (!jogador.grupoAtivoId) return <Navigate to="/bem-vindo" replace />
  return <Shell>{children}</Shell>
}
```

(`RotaAdmin`, que já checa `isAdmin`/`isSuperAdmin` — Task 10 renomeia isso — ganha o mesmo `if` logo
depois do check de `!jogador`, mesmo padrão.)

- [ ] **Step 5: Seletor de grupo no header do `Shell.jsx`**

Adicionar um componente `SeletorGrupo` (novo, dentro do próprio `Shell.jsx`) que busca
`GET /api/groups/meus` ao montar, mostra um `<select>` com o grupo ativo marcado, e no `onChange` chama
`PUT /api/groups/ativo` com `{ groupId }`, atualiza `setGrupoAtivo(groupId)` (import de `../lib/grupoAtivo.js`)
e recarrega a página:

```jsx
function SeletorGrupo({ grupoAtivoId }) {
  const [grupos, setGrupos] = useState([])

  useEffect(() => {
    fetch('/api/groups/meus').then((res) => (res.ok ? res.json() : [])).then(setGrupos)
  }, [])

  async function trocar(e) {
    const groupId = e.target.value
    await fetch('/api/groups/ativo', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId }),
    })
    setGrupoAtivo(groupId)
    window.location.reload()
  }

  if (grupos.length <= 1) return null
  return (
    <select
      value={grupoAtivoId ?? ''}
      onChange={trocar}
      className="cursor-pointer rounded border border-borda bg-superficie px-2 py-1 font-mono text-xs"
    >
      {grupos.map((g) => (
        <option key={g.id} value={g.id}>{g.nome}</option>
      ))}
    </select>
  )
}
```

E no header (`<div className="flex items-center gap-3">` que já tem avatar/nick/sair), inserir
`<SeletorGrupo grupoAtivoId={jogador?.grupoAtivoId} />` antes do `<span>` do nick. Import de `useEffect`
já existe no arquivo (usado no `colapsada`); adicionar `setGrupoAtivo` de `../lib/grupoAtivo.js` ao topo.

- [ ] **Step 6: Build e testes do client**

Run: `cd site/client && npm run build && npm test`
Expected: build limpo, testes PASS.

- [ ] **Step 7: Commit**

```bash
git add site/client/src/pages/Onboarding.jsx site/client/src/pages/AceitarConvite.jsx site/client/src/components/Shell.jsx site/client/src/App.jsx
git commit -m "feat: onboarding, aceitar convite e seletor de grupo ativo"
```

---

### Task 10: Client — renomear `isAdmin` → `isSuperAdmin`

**Files:**
- Modify: `site/client/src/components/Shell.jsx`
- Modify: `site/client/src/App.jsx`
- Modify: `site/client/src/pages/Partida.jsx`
- Modify: `site/client/src/pages/Jogadores.jsx`
- Modify: `site/client/src/components/granadas/PaginaMapa.jsx`
- Modify: `site/client/src/components/taticas/PaginaMapaTaticas.jsx`
- Test: `site/client/src/test/App.test.jsx`

**Interfaces:**
- Consumes: `jogador.isSuperAdmin` (era `jogador.isAdmin`) vindo de `/api/auth/me`.

- [ ] **Step 1: Substituir `isAdmin` por `isSuperAdmin` nos 6 arquivos**

`grep -rl "isAdmin" site/client/src` pra confirmar a lista exata antes de editar (deve bater com os 6
acima, já mapeados em `Grep pattern:isAdmin` durante o design). Trocar toda ocorrência de
`jogador?.isAdmin` / `jogador.isAdmin` por `jogador?.isSuperAdmin` / `jogador.isSuperAdmin`, e em
`Shell.jsx`/`App.jsx` também os `RotaAdmin`/blocos condicionais equivalentes.

- [ ] **Step 2: Atualizar `App.test.jsx`**

O mock em `mockMe({ ..., isAdmin: false })` vira `mockMe({ ..., isSuperAdmin: false })`.

- [ ] **Step 3: Build e testes do client**

Run: `cd site/client && npm run build && npm test`
Expected: build limpo, testes PASS.

- [ ] **Step 4: Commit**

```bash
git add site/client/src -A
git commit -m "feat: renomeia isAdmin para isSuperAdmin no client"
```

---

## Fora de escopo (fica pra depois)

- Alterar o Coletor Python pra usar `players.grupo_ativo_id` como `group_id` das partidas descobertas
  via auto-import (a coluna já existe no banco; o código do Coletor não é tocado neste plano).
- Sair de um grupo, remover membro, transferir dono, múltiplos admins além do criador promovendo outros.
- Times e Ranking público — próximos sub-projetos.
