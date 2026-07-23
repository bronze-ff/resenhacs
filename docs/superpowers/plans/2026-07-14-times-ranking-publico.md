# Times + Ranking Público Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Times (roster de N jogadores dentro de um grupo, admin-only pra criar/editar), Comparar Time x Time (inclusive entre grupos diferentes se ambos forem públicos), e Ranking Público (Jogadores + Times) com opt-in.

**Architecture:** 2 tabelas novas (`teams`, `team_members`) + 1 coluna (`players.ranking_publico`). "Jogaram juntos" é definido como 2+ membros do Time na mesma partida e mesmo lado (`match_players.team`) — usado tanto pras stats agregadas do Time quanto pro confronto direto entre dois Times.

**Tech Stack:** Express + node-postgres, React Router v6, Vitest.

## Global Constraints

- Só o **admin do grupo** cria/edita/apaga Times e mexe no toggle público de um Time
  (`requireGroupMember` + checagem de `role = 'admin'` em `group_members`, mesmo padrão de
  `POST /api/groups/:id/convites`).
- Qualquer membro do grupo **vê** os Times do grupo (leitura não é admin-only).
- Ranking público (`/api/ranking-publico/*`) exige login (`requireAuth`) mas NÃO
  `requireGroupMember` — é cross-grupo por definição.
- Opt-in de jogador no ranking público é **pessoal** (`players.ranking_publico`,
  alterado só pelo próprio `req.player.steamId`, nunca por outro).
- Novos trechos de UI usam os primitivos existentes (`Card`, `SectionHeader`, `DataTable`,
  `RatingBadge`, `Badge`) — sem HTML cru novo.

---

### Task 1: Migration — `teams`, `team_members`, `players.ranking_publico`

**Files:**
- Create: `supabase/migrations/0021_times.sql`

- [ ] **Step 1: Escrever a migration**

```sql
create table teams (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  nome text not null,
  publico boolean not null default false,
  criado_por text not null references players(steam_id64),
  criado_em timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  steam_id64 text not null references players(steam_id64),
  primary key (team_id, steam_id64)
);

alter table players add column ranking_publico boolean not null default false;
```

- [ ] **Step 2: Aplicar no Supabase de produção**

Use a ferramenta MCP do Supabase (`apply_migration`, projeto `hrpgbrfqxqjxpsjeymec`, nome
`0021_times`, mesmo SQL acima). Depois `list_tables` pra confirmar `teams`/`team_members`
existem e `players.ranking_publico` foi criada.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0021_times.sql
git commit -m "feat: migration de times (roster por grupo) e opt-in de ranking publico"
```

---

### Task 2: Servidor — CRUD de Times

**Files:**
- Create: `site/server/src/routes/teams.js`
- Modify: `site/server/src/app.js`
- Test: `site/server/test/teams.test.js`

**Interfaces:**
- Produces: `POST /api/teams`, `GET /api/teams`, `PATCH /api/teams/:id`,
  `DELETE /api/teams/:id` (todas `requireGroupMember`, escritas também checam admin do grupo).

- [ ] **Step 1: `teams.js` — criar, listar, editar, apagar**

```js
import { Router } from 'express'

async function ehAdminDoGrupo(db, groupId, steamId) {
  const { rows } = await db.query(
    'select role from group_members where group_id = $1 and steam_id64 = $2',
    [groupId, steamId],
  )
  return rows[0]?.role === 'admin'
}

function validarMembros(body) {
  const membros = Array.isArray(body?.membros) ? body.membros.filter((s) => /^\d{17}$/.test(s)) : []
  if (membros.length === 0) return null
  return membros
}

export function createTeamsRouter({ db, requireAuth, requireGroupMember }) {
  const router = Router()

  router.post('/', requireAuth, requireGroupMember, async (req, res) => {
    if (!(await ehAdminDoGrupo(db, req.groupId, req.player.steamId))) {
      return res.status(403).json({ erro: 'Só o admin do grupo cria Times' })
    }
    const nome = String(req.body?.nome ?? '').trim()
    const membros = validarMembros(req.body)
    if (!nome) return res.status(400).json({ erro: 'Nome do Time é obrigatório' })
    if (!membros) return res.status(400).json({ erro: 'Informe ao menos 1 membro (steamId válido)' })

    const client = await db.connect()
    try {
      await client.query('begin')
      const { rows } = await client.query(
        'insert into teams (group_id, nome, criado_por) values ($1, $2, $3) returning id, nome, publico',
        [req.groupId, nome, req.player.steamId],
      )
      const time = rows[0]
      for (const steamId of membros) {
        await client.query(
          'insert into team_members (team_id, steam_id64) values ($1, $2) on conflict do nothing',
          [time.id, steamId],
        )
      }
      await client.query('commit')
      res.status(201).json({ id: time.id, nome: time.nome, publico: time.publico, membros })
    } catch (err) {
      await client.query('rollback')
      throw err
    } finally {
      client.release()
    }
  })

  router.get('/', requireAuth, requireGroupMember, async (req, res) => {
    const { rows } = await db.query(
      `select t.id, t.nome, t.publico,
              coalesce(json_agg(jsonb_build_object('steamId', p.steam_id64, 'nick', p.nick, 'avatarUrl', coalesce(p.avatar_url, sa.avatar_url)))
                filter (where p.steam_id64 is not null), '[]') as membros
       from teams t
       left join team_members tm on tm.team_id = t.id
       left join players p on p.steam_id64 = tm.steam_id64
       left join steam_avatares sa on sa.steam_id64 = p.steam_id64
       where t.group_id = $1
       group by t.id, t.nome, t.publico
       order by t.nome`,
      [req.groupId],
    )
    res.json(rows.map((t) => ({ id: t.id, nome: t.nome, publico: t.publico, membros: t.membros })))
  })

  router.patch('/:id', requireAuth, requireGroupMember, async (req, res) => {
    if (!(await ehAdminDoGrupo(db, req.groupId, req.player.steamId))) {
      return res.status(403).json({ erro: 'Só o admin do grupo edita Times' })
    }
    const dono = await db.query('select id from teams where id = $1 and group_id = $2', [req.params.id, req.groupId])
    if (dono.rows.length === 0) return res.status(404).json({ erro: 'Time não encontrado' })

    const sets = []
    const params = []
    if (typeof req.body?.nome === 'string' && req.body.nome.trim()) {
      params.push(req.body.nome.trim())
      sets.push(`nome = $${params.length}`)
    }
    if (typeof req.body?.publico === 'boolean') {
      params.push(req.body.publico)
      sets.push(`publico = $${params.length}`)
    }
    if (sets.length > 0) {
      params.push(req.params.id)
      await db.query(`update teams set ${sets.join(', ')} where id = $${params.length}`, params)
    }
    if (Array.isArray(req.body?.membros)) {
      const membros = validarMembros(req.body)
      if (!membros) return res.status(400).json({ erro: 'membros precisa ter ao menos 1 steamId válido' })
      await db.query('delete from team_members where team_id = $1', [req.params.id])
      for (const steamId of membros) {
        await db.query('insert into team_members (team_id, steam_id64) values ($1, $2)', [req.params.id, steamId])
      }
    }
    res.json({ ok: true })
  })

  router.delete('/:id', requireAuth, requireGroupMember, async (req, res) => {
    if (!(await ehAdminDoGrupo(db, req.groupId, req.player.steamId))) {
      return res.status(403).json({ erro: 'Só o admin do grupo apaga Times' })
    }
    const { rowCount } = await db.query('delete from teams where id = $1 and group_id = $2', [req.params.id, req.groupId])
    if (rowCount === 0) return res.status(404).json({ erro: 'Time não encontrado' })
    res.json({ ok: true })
  })

  return router
}
```

- [ ] **Step 2: Montar em `app.js`**

Adicionar import `import { createTeamsRouter } from './routes/teams.js'` e, logo após a
linha de `/api/players`:

```js
  app.use('/api/teams', createTeamsRouter({ db, requireAuth, requireGroupMember }))
```

- [ ] **Step 3: Escrever `site/server/test/teams.test.js`**

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '111' }, config.jwtSecret)}`
const GRUPO = '11111111-1111-1111-1111-111111111111'

// handlers: [needle, rows, rowCount?] — rowCount só é preciso pros testes de
// DELETE (o handler lê rowCount pra decidir 404 vs 200).
function appWith(handlers, connectHandlers = handlers) {
  const query = vi.fn().mockImplementation((sql) => {
    for (const [needle, rows, rowCount] of [...handlers, ['group_members where group_id = $1 and steam_id64', [{}]]]) {
      if (sql.includes(needle)) return Promise.resolve({ rows, rowCount: rowCount ?? rows.length })
    }
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
  const clientQuery = vi.fn().mockImplementation((sql) => {
    for (const [needle, rows] of [...connectHandlers, ['group_members where group_id = $1 and steam_id64', [{}]]]) {
      if (sql.includes(needle)) return Promise.resolve({ rows })
    }
    return Promise.resolve({ rows: [] })
  })
  const client = { query: clientQuery, release: vi.fn() }
  const db = { query, connect: vi.fn().mockResolvedValue(client) }
  return { app: createApp({ config, db }), db, client }
}

describe('POST /api/teams', () => {
  it('nao-admin do grupo: 403', async () => {
    const { app } = appWith([['role from group_members', [{ role: 'membro' }]]])
    const res = await request(app).post('/api/teams').set('Cookie', cookie).set('X-Group-Id', GRUPO)
      .send({ nome: 'Titulares', membros: ['76561198000000001'] })
    expect(res.status).toBe(403)
  })

  it('admin: cria time com membros', async () => {
    const { app } = appWith([
      ['role from group_members', [{ role: 'admin' }]],
      ['insert into teams', [{ id: 't1', nome: 'Titulares', publico: false }]],
    ])
    const res = await request(app).post('/api/teams').set('Cookie', cookie).set('X-Group-Id', GRUPO)
      .send({ nome: 'Titulares', membros: ['76561198000000001', '76561198000000002'] })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: 't1', nome: 'Titulares', publico: false })
  })

  it('sem membros validos: 400', async () => {
    const { app } = appWith([['role from group_members', [{ role: 'admin' }]]])
    const res = await request(app).post('/api/teams').set('Cookie', cookie).set('X-Group-Id', GRUPO)
      .send({ nome: 'Titulares', membros: [] })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/teams', () => {
  it('lista times do grupo ativo com membros', async () => {
    const { app } = appWith([
      ['from teams t', [{ id: 't1', nome: 'Titulares', publico: true, membros: [{ steamId: '1', nick: 'a', avatarUrl: null }] }]],
    ])
    const res = await request(app).get('/api/teams').set('Cookie', cookie).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 't1', nome: 'Titulares', publico: true, membros: [{ steamId: '1', nick: 'a', avatarUrl: null }] }])
  })
})

describe('PATCH /api/teams/:id', () => {
  it('nao-admin: 403', async () => {
    const { app } = appWith([['role from group_members', [{ role: 'membro' }]]])
    const res = await request(app).patch('/api/teams/t1').set('Cookie', cookie).set('X-Group-Id', GRUPO).send({ publico: true })
    expect(res.status).toBe(403)
  })

  it('admin: torna publico', async () => {
    const { app, db } = appWith([
      ['role from group_members', [{ role: 'admin' }]],
      ['id from teams', [{ id: 't1' }]],
    ])
    const res = await request(app).patch('/api/teams/t1').set('Cookie', cookie).set('X-Group-Id', GRUPO).send({ publico: true })
    expect(res.status).toBe(200)
    expect(db.query.mock.calls.some((c) => c[0].includes('update teams set') && c[0].includes('publico'))).toBe(true)
  })
})

describe('DELETE /api/teams/:id', () => {
  it('nao-admin: 403', async () => {
    const { app } = appWith([['role from group_members', [{ role: 'membro' }]]])
    const res = await request(app).delete('/api/teams/t1').set('Cookie', cookie).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(403)
  })

  it('admin: apaga', async () => {
    const { app } = appWith([
      ['role from group_members', [{ role: 'admin' }]],
      ['delete from teams', [], 1],
    ])
    const res = await request(app).delete('/api/teams/t1').set('Cookie', cookie).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(200)
  })

  it('id inexistente: 404', async () => {
    const { app } = appWith([
      ['role from group_members', [{ role: 'admin' }]],
      ['delete from teams', [], 0],
    ])
    const res = await request(app).delete('/api/teams/tx').set('Cookie', cookie).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 4: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/teams.js site/server/src/app.js site/server/test/teams.test.js
git commit -m "feat: CRUD de times (roster admin-only por grupo)"
```

---

### Task 3: Servidor — Comparar Time x Time

**Files:**
- Modify: `site/server/src/routes/teams.js`
- Test: `site/server/test/teams.test.js`

**Interfaces:**
- Produces: `GET /api/teams/compare?a=<teamId>&b=<teamId>`.

- [ ] **Step 1: Autorização por Time + stats agregadas + confronto direto**

Adicionar em `teams.js`, antes do `return router`:

```js
  // Autoriza ver um Time: membro do grupo dono do Time, OU o Time é público.
  async function autorizaTime(teamId, steamId) {
    const { rows } = await db.query(
      `select t.id, t.nome, t.group_id, t.publico, g.nome as grupo_nome
       from teams t join groups g on g.id = t.group_id
       where t.id = $1`,
      [teamId],
    )
    const time = rows[0]
    if (!time) return null
    if (time.publico) return time
    const membro = await db.query(
      'select 1 from group_members where group_id = $1 and steam_id64 = $2',
      [time.group_id, steamId],
    )
    return membro.rows.length > 0 ? time : null
  }

  async function statsDoTime(teamId) {
    const { rows } = await db.query(
      `with membros as (select steam_id64 from team_members where team_id = $1),
            presencas as (
              select mp.match_id, mp.team, mp.rating, mp.kills, mp.deaths, mp.won
              from match_players mp
              join membros me on me.steam_id64 = mp.steam_id64
              join matches m on m.id = mp.match_id
              where m.status = 'parsed'
            ),
            grupos as (
              select match_id, team, count(*) as presentes, bool_or(won) as venceu,
                     avg(rating) as rating_medio,
                     sum(kills) as kills_total, sum(deaths) as deaths_total
              from presencas
              group by match_id, team
              having count(*) >= 2
            )
       select count(*)::int as partidas,
              coalesce(sum(case when venceu then 1 else 0 end), 0)::int as vitorias,
              avg(rating_medio) as rating,
              coalesce(sum(kills_total), 0)::int as kills,
              coalesce(sum(deaths_total), 0)::int as deaths
       from grupos`,
      [teamId],
    )
    const r = rows[0]
    return {
      partidas: r.partidas,
      vitorias: r.vitorias,
      winrate: r.partidas ? Math.round((r.vitorias / r.partidas) * 1000) / 10 : 0,
      rating: r.rating === null ? null : Math.round(Number(r.rating) * 100) / 100,
      kd: r.deaths ? Math.round((r.kills / r.deaths) * 100) / 100 : r.kills,
    }
  }

  router.get('/compare', requireAuth, async (req, res) => {
    const a = String(req.query.a ?? '')
    const b = String(req.query.b ?? '')
    if (!a || !b || a === b) return res.status(400).json({ erro: 'Informe dois teamId diferentes (a e b)' })

    const [timeA, timeB] = await Promise.all([autorizaTime(a, req.player.steamId), autorizaTime(b, req.player.steamId)])
    if (!timeA) return res.status(403).json({ erro: 'Time A não é público nem do seu grupo' })
    if (!timeB) return res.status(403).json({ erro: 'Time B não é público nem do seu grupo' })

    const [statsA, statsB, confrontoQ] = await Promise.all([
      statsDoTime(a),
      statsDoTime(b),
      db.query(
        `with membros_a as (select steam_id64 from team_members where team_id = $1),
              membros_b as (select steam_id64 from team_members where team_id = $2),
              lado_a as (
                select mp.match_id, mp.team, count(*) as presentes, bool_or(mp.won) as venceu
                from match_players mp join membros_a ma on ma.steam_id64 = mp.steam_id64
                group by mp.match_id, mp.team having count(*) >= 2
              ),
              lado_b as (
                select mp.match_id, mp.team, bool_or(mp.won) as venceu
                from match_players mp join membros_b mb on mb.steam_id64 = mp.steam_id64
                group by mp.match_id, mp.team having count(*) >= 2
              )
         select la.venceu as a_venceu
         from lado_a la join lado_b lb on lb.match_id = la.match_id and lb.team <> la.team`,
        [a, b],
      ),
    ])

    const confronto = confrontoQ.rows
    res.json({
      a: { id: timeA.id, nome: timeA.nome, grupoNome: timeA.grupo_nome, stats: statsA },
      b: { id: timeB.id, nome: timeB.nome, grupoNome: timeB.grupo_nome, stats: statsB },
      confronto: {
        partidasJuntos: confronto.length,
        aVenceu: confronto.filter((r) => r.a_venceu).length,
        bVenceu: confronto.filter((r) => !r.a_venceu).length,
      },
    })
  })
```

Nota: `GET /compare` precisa vir ANTES de nenhuma rota `/:id` conflitante — como `teams.js`
não tem `/:id` com esse nome literal (`compare` não bate no padrão UUID), não há conflito,
mas mantenha a ordem (compare declarado após as rotas de Step 1 do Task 2, o que já é o
caso já que é adicionado no fim do arquivo).

- [ ] **Step 2: Testes**

Adicionar em `teams.test.js`:

```js
describe('GET /api/teams/compare', () => {
  it('time nao publico e fora do meu grupo: 403', async () => {
    const { app } = appWith([
      ['from teams t join groups', [{ id: 'ta', group_id: 'g-outro', publico: false, grupo_nome: 'Outro' }]],
      ['select 1 from group_members where group_id = $1 and steam_id64 = $2', []],
    ])
    const res = await request(app).get('/api/teams/compare?a=ta&b=tb').set('Cookie', cookie)
    expect(res.status).toBe(403)
  })

  it('dois times publicos: compara e monta confronto', async () => {
    const { app } = appWith([
      ['from teams t join groups', [{ id: 'ta', nome: 'A', group_id: 'g1', publico: true, grupo_nome: 'Grupo A' }]],
      ['from grupos', [{ partidas: 5, vitorias: 3, rating: '1.1', kills: 300, deaths: 250 }]],
      ['lado_a la join lado_b', [{ a_venceu: true }, { a_venceu: false }]],
    ])
    const res = await request(app).get('/api/teams/compare?a=ta&b=tb').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.confronto).toEqual({ partidasJuntos: 2, aVenceu: 1, bVenceu: 1 })
  })
})
```

- [ ] **Step 3: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add site/server/src/routes/teams.js site/server/test/teams.test.js
git commit -m "feat: comparar time x time (cross-grupo se ambos publicos)"
```

---

### Task 4: Servidor — Ranking Público (Jogadores + Times) e toggle pessoal

**Files:**
- Create: `site/server/src/routes/rankingPublico.js`
- Modify: `site/server/src/routes/players.js`
- Modify: `site/server/src/app.js`
- Test: `site/server/test/rankingPublico.test.js`
- Test: `site/server/test/players.test.js`

**Interfaces:**
- Produces: `GET /api/ranking-publico/jogadores`, `GET /api/ranking-publico/times`,
  `PUT /api/players/me/ranking-publico`.

- [ ] **Step 1: Toggle pessoal em `players.js`**

Adicionar, após a rota `PUT /me` existente (antes do `return router`):

```js
  router.put('/me/ranking-publico', requireAuth, async (req, res) => {
    const publico = Boolean(req.body?.publico)
    await db.query('update players set ranking_publico = $2 where steam_id64 = $1', [req.player.steamId, publico])
    res.json({ ok: true, publico })
  })
```

- [ ] **Step 2: `rankingPublico.js`**

```js
import { Router } from 'express'

function pct(parte, total) {
  if (!total) return 0
  return Math.round((parte / total) * 1000) / 10
}

export function createRankingPublicoRouter({ db }) {
  const router = Router()

  router.get('/jogadores', async (req, res) => {
    const { rows } = await db.query(
      `select p.steam_id64, p.nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url,
              count(mp.match_id)::int as partidas,
              coalesce(sum(case when mp.won then 1 else 0 end), 0)::int as vitorias,
              coalesce(sum(mp.kills), 0)::int as kills,
              coalesce(sum(mp.deaths), 0)::int as deaths,
              avg(mp.rating) as rating
       from players p
       left join steam_avatares sa on sa.steam_id64 = p.steam_id64
       left join match_players mp on mp.steam_id64 = p.steam_id64
       where p.ranking_publico = true
       group by p.steam_id64, p.nick, p.avatar_url, sa.avatar_url
       having count(mp.match_id) > 0
       order by avg(mp.rating) desc nulls last`,
      [],
    )
    res.json(
      rows.map((r) => ({
        steamId: r.steam_id64,
        nick: r.nick,
        avatarUrl: r.avatar_url,
        partidas: r.partidas,
        vitorias: r.vitorias,
        winrate: pct(r.vitorias, r.partidas),
        kd: r.deaths ? Math.round((r.kills / r.deaths) * 100) / 100 : r.kills,
        rating: r.rating === null ? null : Math.round(Number(r.rating) * 100) / 100,
      })),
    )
  })

  router.get('/times', async (req, res) => {
    const { rows } = await db.query(
      `with membros as (
         select tm.team_id, tm.steam_id64 from team_members tm
       ),
       presencas as (
         select me.team_id, mp.match_id, mp.team, mp.rating, mp.won
         from match_players mp
         join membros me on me.steam_id64 = mp.steam_id64
         join matches m on m.id = mp.match_id
         where m.status = 'parsed'
       ),
       grupos as (
         select team_id, match_id, team, count(*) as presentes, bool_or(won) as venceu, avg(rating) as rating_medio
         from presencas
         group by team_id, match_id, team
         having count(*) >= 2
       )
       select t.id, t.nome, g.nome as grupo_nome,
              coalesce(count(gr.match_id), 0)::int as partidas,
              coalesce(sum(case when gr.venceu then 1 else 0 end), 0)::int as vitorias,
              avg(gr.rating_medio) as rating
       from teams t
       join groups g on g.id = t.group_id
       left join grupos gr on gr.team_id = t.id
       where t.publico = true
       group by t.id, t.nome, g.nome
       order by avg(gr.rating_medio) desc nulls last`,
      [],
    )
    res.json(
      rows.map((t) => ({
        id: t.id,
        nome: t.nome,
        grupoNome: t.grupo_nome,
        partidas: t.partidas,
        vitorias: t.vitorias,
        winrate: pct(t.vitorias, t.partidas),
        rating: t.rating === null ? null : Math.round(Number(t.rating) * 100) / 100,
      })),
    )
  })

  return router
}
```

- [ ] **Step 3: Montar em `app.js`**

Import `import { createRankingPublicoRouter } from './routes/rankingPublico.js'` e:

```js
  app.use('/api/ranking-publico', requireAuth, createRankingPublicoRouter({ db }))
```

- [ ] **Step 4: Testes**

`site/server/test/rankingPublico.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '111' }, config.jwtSecret)}`

function appWith(rows) {
  const db = { query: vi.fn().mockResolvedValue({ rows }) }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/ranking-publico/jogadores', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/ranking-publico/jogadores')).status).toBe(401)
  })

  it('lista jogadores publicos com rating', async () => {
    const { app } = appWith([
      { steam_id64: '1', nick: 'top', avatar_url: null, partidas: 10, vitorias: 7, kills: 200, deaths: 150, rating: '1.35' },
    ])
    const res = await request(app).get('/api/ranking-publico/jogadores').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ nick: 'top', rating: 1.35, winrate: 70 })
  })
})

describe('GET /api/ranking-publico/times', () => {
  it('lista times publicos', async () => {
    const { app } = appWith([
      { id: 't1', nome: 'Titulares', grupo_nome: 'Grupo A', partidas: 5, vitorias: 3, rating: '1.1' },
    ])
    const res = await request(app).get('/api/ranking-publico/times').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ nome: 'Titulares', grupoNome: 'Grupo A', winrate: 60 })
  })
})
```

Em `players.test.js`, adicionar:

```js
describe('PUT /api/players/me/ranking-publico', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    expect((await request(app).put('/api/players/me/ranking-publico').send({ publico: true })).status).toBe(401)
  })

  it('grava o proprio opt-in', async () => {
    const { app, db } = appWith()
    const res = await request(app).put('/api/players/me/ranking-publico').set('Cookie', memberCookie).send({ publico: true })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, publico: true })
    expect(db.query.mock.calls[0][1]).toEqual(['76561198000000002', true])
  })
})
```

- [ ] **Step 5: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/server/src/routes/rankingPublico.js site/server/src/routes/players.js site/server/src/app.js site/server/test/rankingPublico.test.js site/server/test/players.test.js
git commit -m "feat: ranking publico (jogadores e times) e toggle pessoal de opt-in"
```

---

### Task 5: Client — página "Times" (listar, criar/editar admin-only)

**Files:**
- Create: `site/client/src/pages/Times.jsx`
- Modify: `site/client/src/App.jsx`
- Modify: `site/client/src/components/Shell.jsx`

**Interfaces:**
- Consumes: `GET /api/teams`, `POST /api/teams`, `PATCH /api/teams/:id`,
  `DELETE /api/teams/:id`, `GET /api/players` (pra montar o seletor de membros).

- [ ] **Step 1: `Times.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { Card, SectionHeader, Badge } from '../components/ui'

function FormTime({ jogadoresDoGrupo, onCriado }) {
  const [nome, setNome] = useState('')
  const [selecionados, setSelecionados] = useState([])
  const [erro, setErro] = useState(null)
  const [enviando, setEnviando] = useState(false)

  function alternar(steamId) {
    setSelecionados((s) => (s.includes(steamId) ? s.filter((x) => x !== steamId) : [...s, steamId]))
  }

  async function criar(e) {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    const res = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, membros: selecionados }),
    })
    const body = await res.json().catch(() => ({}))
    setEnviando(false)
    if (!res.ok) return setErro(body.erro ?? 'Erro ao criar time')
    setNome('')
    setSelecionados([])
    onCriado()
  }

  return (
    <Card className="p-4 sm:p-5">
      <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-texto">Novo time</h3>
      <form onSubmit={criar} className="space-y-3">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome do time"
          className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
        />
        <div className="flex flex-wrap gap-2">
          {jogadoresDoGrupo.map((j) => (
            <button
              type="button"
              key={j.steamId}
              onClick={() => alternar(j.steamId)}
              className={`panel-cut-sm border px-2.5 py-1 font-mono text-xs ${
                selecionados.includes(j.steamId) ? 'border-destaque bg-destaque/10 text-destaque' : 'border-borda text-texto-fraco'
              }`}
            >
              {j.nick || j.steamId}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={!nome.trim() || selecionados.length === 0 || enviando}
          className="panel-cut-sm min-h-10 border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo disabled:opacity-40"
        >
          Criar time
        </button>
        {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}
      </form>
    </Card>
  )
}

function CardTime({ time, isAdmin, onMudou }) {
  async function alternarPublico() {
    await fetch(`/api/teams/${time.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publico: !time.publico }),
    })
    onMudou()
  }

  async function apagar() {
    if (!confirm(`Apagar o time "${time.nome}"?`)) return
    await fetch(`/api/teams/${time.id}`, { method: 'DELETE' })
    onMudou()
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold uppercase tracking-wide text-texto">{time.nome}</h3>
          <p className="font-mono text-xs text-texto-fraco">{time.membros.map((m) => m.nick || m.steamId).join(', ')}</p>
        </div>
        <Badge tom={time.publico ? 'sucesso' : 'neutro'}>{time.publico ? 'Público' : 'Privado'}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to={`/times/comparar?a=${time.id}`}
          className="panel-cut-sm border border-borda px-2.5 py-1 font-mono text-xs text-texto-fraco hover:border-destaque/60 hover:text-destaque"
        >
          Comparar
        </Link>
        {isAdmin && (
          <>
            <button onClick={alternarPublico} className="panel-cut-sm border border-borda px-2.5 py-1 font-mono text-xs text-texto-fraco hover:border-destaque/60 hover:text-destaque">
              {time.publico ? 'Tornar privado' : 'Tornar público'}
            </button>
            <button onClick={apagar} className="panel-cut-sm border border-borda px-2.5 py-1 font-mono text-xs text-texto-fraco hover:border-perigo/60 hover:text-perigo">
              Apagar
            </button>
          </>
        )}
      </div>
    </Card>
  )
}

export default function Times() {
  const { jogador } = useAuth()
  const [times, setTimes] = useState(null)
  const [jogadoresDoGrupo, setJogadoresDoGrupo] = useState([])

  function recarregar() {
    fetch('/api/teams').then((res) => (res.ok ? res.json() : [])).then(setTimes)
  }

  useEffect(() => {
    recarregar()
    fetch('/api/players').then((res) => (res.ok ? res.json() : [])).then(setJogadoresDoGrupo)
  }, [])

  if (times === null) return <p className="font-mono text-sm text-texto-fraco">Carregando…</p>

  return (
    <div className="space-y-6">
      <SectionHeader titulo="Times" />
      {times.length === 0 && <p className="font-mono text-sm text-texto-fraco">Nenhum time criado nesse grupo ainda.</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {times.map((t) => (
          <CardTime key={t.id} time={t} isAdmin={jogador?.souAdminDoGrupo} onMudou={recarregar} />
        ))}
      </div>
      {jogador?.souAdminDoGrupo && <FormTime jogadoresDoGrupo={jogadoresDoGrupo} onCriado={recarregar} />}
    </div>
  )
}
```

**Nota de implementação (resolver no início da Task 5, antes de codar):** `jogador` (de
`useAuth()`) hoje só carrega `isSuperAdmin` (super-admin site-wide), não "sou admin DESSE
grupo". Pra saber se o jogador logado é admin do grupo ativo, adicionar esse dado em
`GET /api/auth/me`: em `site/server/src/routes/auth.js`, no handler de `/me`, fazer um
segundo `select role from group_members where group_id = $1 and steam_id64 = $2` (usando
`p.grupo_ativo_id`) e incluir `souAdminDoGrupo: role === 'admin'` no JSON de resposta —
só quando `grupo_ativo_id` não é null. Atualizar `site/server/test/auth.test.js` de acordo
(mock da nova query, novo campo no `toEqual`). Sem esse dado, `FormTime`/botões de
editar/apagar Time nunca apareceriam pra ninguém.

- [ ] **Step 2: Rota em `App.jsx`**

Adicionar import `import Times from './pages/Times.jsx'` e:

```jsx
          <Route path="/times" element={<RotaProtegida><Times /></RotaProtegida>} />
```

- [ ] **Step 3: Item de menu em `Shell.jsx`**

Adicionar no array `ITENS` (não é admin-only — qualquer membro vê Times), entre "Comparar"
e "Minha conta", renumerando "Minha conta" de `06` pra `07`:

```js
  { to: '/comparar', label: 'Comparar', num: '05', icone: 'comparar' },
  { to: '/times', label: 'Times', num: '06', icone: 'jogadores' },
  { to: '/conta', label: 'Minha conta', num: '07', icone: 'perfil' },
```

(reaproveita o ícone `jogadores` — sem ícone dedicado de "time" no set atual; aceitável
pro MVP, pode ganhar ícone próprio depois.)

- [ ] **Step 4: Build e testes do client**

Run: `cd site/client && npm run build && npm test`
Expected: build limpo, testes PASS.

- [ ] **Step 5: Commit**

```bash
git add site/client/src/pages/Times.jsx site/client/src/App.jsx site/client/src/components/Shell.jsx site/server/src/routes/auth.js site/server/test/auth.test.js
git commit -m "feat: pagina de times (listar, criar/editar/apagar admin-only)"
```

---

### Task 6: Client — Comparar Time x Time

**Files:**
- Create: `site/client/src/pages/CompararTimes.jsx`
- Modify: `site/client/src/App.jsx`

**Interfaces:**
- Consumes: `GET /api/teams/compare?a=&b=`, `GET /api/ranking-publico/times` (pra montar o
  seletor de "Time B" entre times públicos de qualquer grupo).

- [ ] **Step 1: `CompararTimes.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, SectionHeader, StatTile } from '../components/ui'

const LINHAS = [
  { rotulo: 'Rating', chave: 'rating', formato: (v) => v?.toFixed(2) ?? '–' },
  { rotulo: 'Winrate', chave: 'winrate', formato: (v) => `${v}%` },
  { rotulo: 'K/D', chave: 'kd', formato: (v) => v },
  { rotulo: 'Partidas', chave: 'partidas', formato: (v) => v },
]

export default function CompararTimes() {
  const [params, setParams] = useSearchParams()
  const [meusTimes, setMeusTimes] = useState([])
  const [timesPublicos, setTimesPublicos] = useState([])
  const [a, setA] = useState(params.get('a') ?? '')
  const [b, setB] = useState(params.get('b') ?? '')
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    fetch('/api/teams').then((res) => (res.ok ? res.json() : [])).then(setMeusTimes)
    fetch('/api/ranking-publico/times').then((res) => (res.ok ? res.json() : [])).then(setTimesPublicos)
  }, [])

  useEffect(() => {
    setDados(null)
    setErro(null)
    if (!a || !b) return
    if (a === b) { setErro('Escolha dois times diferentes.'); return }
    setParams({ a, b })
    fetch(`/api/teams/compare?a=${a}&b=${b}`)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(setDados)
      .catch(() => setErro('Não foi possível comparar esses times (um deles pode não ser público).'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b])

  // Time B pode ser qualquer time público (de qualquer grupo) — não só os meus.
  const opcoesB = [...meusTimes.map((t) => ({ id: t.id, nome: t.nome })), ...timesPublicos.filter((t) => !meusTimes.some((m) => m.id === t.id))]

  return (
    <div className="space-y-6">
      <SectionHeader titulo="Comparar times" />
      <div className="flex flex-wrap items-center gap-3">
        <select value={a} onChange={(e) => setA(e.target.value)} className="cursor-pointer rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm">
          <option value="">Meu time…</option>
          {meusTimes.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
        <span className="font-display text-texto-fraco">vs</span>
        <select value={b} onChange={(e) => setB(e.target.value)} className="cursor-pointer rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm">
          <option value="">Time adversário (público)…</option>
          {opcoesB.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
      </div>

      {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}

      {dados && (
        <>
          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-center">
                <p className="font-display text-lg font-bold uppercase text-texto">{dados.a.nome}</p>
                <p className="font-mono text-xs text-texto-fraco">{dados.a.grupoNome}</p>
              </div>
              <span className="font-display text-xs uppercase tracking-widest text-texto-fraco">vs</span>
              <div className="text-center">
                <p className="font-display text-lg font-bold uppercase text-texto">{dados.b.nome}</p>
                <p className="font-mono text-xs text-texto-fraco">{dados.b.grupoNome}</p>
              </div>
            </div>
            <div className="mt-4 divide-y divide-borda border-t border-borda">
              {LINHAS.map((linha) => (
                <div key={linha.chave} className="grid grid-cols-3 items-center gap-2 py-2.5">
                  <span className="text-right font-mono text-sm font-bold tabular-nums text-texto">{linha.formato(dados.a.stats[linha.chave])}</span>
                  <span className="text-center text-[10px] font-display uppercase tracking-wider text-texto-fraco">{linha.rotulo}</span>
                  <span className="text-left font-mono text-sm font-bold tabular-nums text-texto">{linha.formato(dados.b.stats[linha.chave])}</span>
                </div>
              ))}
            </div>
          </Card>

          <section>
            <SectionHeader titulo="Confronto direto" />
            {dados.confronto.partidasJuntos === 0 ? (
              <p className="font-mono text-sm text-texto-fraco">Esses times nunca se enfrentaram ainda.</p>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <StatTile rotulo="Partidas" valor={dados.confronto.partidasJuntos} />
                <StatTile rotulo={`${dados.a.nome} venceu`} valor={dados.confronto.aVenceu} />
                <StatTile rotulo={`${dados.b.nome} venceu`} valor={dados.confronto.bVenceu} />
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Rota em `App.jsx`**

Adicionar import `import CompararTimes from './pages/CompararTimes.jsx'` e:

```jsx
          <Route path="/times/comparar" element={<RotaProtegida><CompararTimes /></RotaProtegida>} />
```

- [ ] **Step 3: Build e testes do client**

Run: `cd site/client && npm run build && npm test`
Expected: build limpo, testes PASS.

- [ ] **Step 4: Commit**

```bash
git add site/client/src/pages/CompararTimes.jsx site/client/src/App.jsx
git commit -m "feat: comparar time x time (cross-grupo se ambos publicos)"
```

---

### Task 7: Client — Ranking Público (2 abas) + toggle em Minha Conta

**Files:**
- Create: `site/client/src/pages/RankingPublico.jsx`
- Modify: `site/client/src/App.jsx`
- Modify: `site/client/src/components/Shell.jsx`
- Modify: `site/client/src/pages/Perfil.jsx`

**Interfaces:**
- Consumes: `GET /api/ranking-publico/jogadores`, `GET /api/ranking-publico/times`,
  `PUT /api/players/me/ranking-publico`.

- [ ] **Step 1: `RankingPublico.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SectionHeader, DataTable, RatingBadge } from '../components/ui'

export default function RankingPublico() {
  const [aba, setAba] = useState('jogadores')
  const [jogadores, setJogadores] = useState(null)
  const [times, setTimes] = useState(null)

  useEffect(() => {
    fetch('/api/ranking-publico/jogadores').then((res) => (res.ok ? res.json() : [])).then(setJogadores)
    fetch('/api/ranking-publico/times').then((res) => (res.ok ? res.json() : [])).then(setTimes)
  }, [])

  return (
    <div className="space-y-6">
      <SectionHeader titulo="Ranking público" />
      <div className="flex gap-2">
        {['jogadores', 'times'].map((a) => (
          <button
            key={a}
            onClick={() => setAba(a)}
            className={`panel-cut-sm border px-3 py-1.5 font-mono text-xs uppercase tracking-wide ${
              aba === a ? 'border-destaque bg-destaque/10 text-destaque' : 'border-borda text-texto-fraco'
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {aba === 'jogadores' && (
        jogadores === null ? <p className="font-mono text-sm text-texto-fraco">Carregando…</p> :
        jogadores.length === 0 ? <p className="font-mono text-sm text-texto-fraco">Ninguém optou por aparecer aqui ainda.</p> :
        <DataTable head={<tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Jogador</th><th className="px-2 py-2 text-right">Partidas</th><th className="px-2 py-2 text-right">Winrate</th><th className="px-2 py-2 text-right">K/D</th><th className="px-3 py-2 text-right">Rating</th></tr>}>
          {jogadores.map((j, i) => (
            <tr key={j.steamId}>
              <td className="px-3 py-2 font-mono text-texto-fraco">{i + 1}</td>
              <td className="px-3 py-2">
                <Link to={`/jogador/${j.steamId}`} className="flex items-center gap-2 font-mono text-texto hover:text-destaque">
                  {j.avatarUrl && <img src={j.avatarUrl} alt="" className="panel-cut-sm h-6 w-6 border border-borda object-cover" />}
                  {j.nick || j.steamId}
                </Link>
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{j.partidas}</td>
              <td className="px-2 py-2 text-right tabular-nums">{j.winrate}%</td>
              <td className="px-2 py-2 text-right tabular-nums">{j.kd}</td>
              <td className="px-3 py-2 text-right"><RatingBadge valor={j.rating} /></td>
            </tr>
          ))}
        </DataTable>
      )}

      {aba === 'times' && (
        times === null ? <p className="font-mono text-sm text-texto-fraco">Carregando…</p> :
        times.length === 0 ? <p className="font-mono text-sm text-texto-fraco">Nenhum time público ainda.</p> :
        <DataTable head={<tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Time</th><th className="px-2 py-2">Grupo</th><th className="px-2 py-2 text-right">Partidas</th><th className="px-2 py-2 text-right">Winrate</th><th className="px-3 py-2 text-right">Rating</th></tr>}>
          {times.map((t, i) => (
            <tr key={t.id}>
              <td className="px-3 py-2 font-mono text-texto-fraco">{i + 1}</td>
              <td className="px-3 py-2 font-mono text-texto">
                <Link to={`/times/comparar?a=${t.id}`} className="hover:text-destaque">{t.nome}</Link>
              </td>
              <td className="px-2 py-2 font-mono text-xs text-texto-fraco">{t.grupoNome}</td>
              <td className="px-2 py-2 text-right tabular-nums">{t.partidas}</td>
              <td className="px-2 py-2 text-right tabular-nums">{t.winrate}%</td>
              <td className="px-3 py-2 text-right"><RatingBadge valor={t.rating} /></td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Rota em `App.jsx`**

Adicionar import `import RankingPublico from './pages/RankingPublico.jsx'` e:

```jsx
          <Route path="/ranking-publico" element={<RotaProtegida><RankingPublico /></RotaProtegida>} />
```

- [ ] **Step 3: Item de menu em `Shell.jsx`**

No array `ITENS` (após Task 5 já ter inserido "Times" como `06` e renumerado "Minha conta"
pra `07`), inserir "Ranking público" logo depois de "Ranking" (mantém a numeração
sequencial — reordenar `num` de todos os itens seguintes):

```js
const ITENS = [
  { to: '/', end: true, label: 'Partidas', num: '01', icone: 'partidas' },
  { to: '/ranking', label: 'Ranking', num: '02', icone: 'ranking' },
  { to: '/ranking-publico', label: 'Ranking público', num: '03', icone: 'ranking' },
  { to: '/enviar-demo', label: 'Enviar demo', num: '04', icone: 'enviarDemo' },
  { to: '/jogadores', label: 'Jogadores', num: '05', icone: 'jogadores' },
  { to: '/comparar', label: 'Comparar', num: '06', icone: 'comparar' },
  { to: '/times', label: 'Times', num: '07', icone: 'jogadores' },
  { to: '/conta', label: 'Minha conta', num: '08', icone: 'perfil' },
]
```

- [ ] **Step 4: Toggle em `Perfil.jsx` (Minha conta)**

Adicionar `useEffect`/estado pro toggle. Reescrever o topo do componente:

```jsx
import { useEffect, useState } from 'react'
import { Card, SectionHeader, Badge } from '../components/ui'
import { useAuth } from '../auth/AuthContext.jsx'

export default function Perfil() {
  const { jogador } = useAuth()
  const [matchAuthCode, setMatchAuthCode] = useState('')
  const [lastShareCode, setLastShareCode] = useState('')
  const [mensagem, setMensagem] = useState(null)
  const [rankingPublico, setRankingPublico] = useState(false)

  useEffect(() => {
    if (jogador) setRankingPublico(Boolean(jogador.rankingPublico))
  }, [jogador])

  async function alternarRankingPublico() {
    const novo = !rankingPublico
    setRankingPublico(novo)
    await fetch('/api/players/me/ranking-publico', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publico: novo }),
    })
  }
```

E adicionar, entre a seção "Importação automática" e "Contas vinculadas" (dentro do
`return`, mesmo `<div className="max-w-lg space-y-6">`):

```jsx
      <section className="space-y-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">
          Ranking público
        </h3>
        <Card className="flex items-center justify-between gap-3 p-4 sm:p-5">
          <div>
            <p className="font-display text-sm font-semibold uppercase tracking-wide text-texto">Aparecer no ranking público</p>
            <p className="font-mono text-xs text-texto-fraco">Expõe seu nick e stats agregadas fora do seu grupo, num ranking global de jogadores.</p>
          </div>
          <button
            onClick={alternarRankingPublico}
            className={`panel-cut-sm border px-3 py-1.5 font-mono text-xs uppercase tracking-wide ${
              rankingPublico ? 'border-destaque bg-destaque/10 text-destaque' : 'border-borda text-texto-fraco'
            }`}
          >
            {rankingPublico ? 'Ativado' : 'Desativado'}
          </button>
        </Card>
      </section>
```

**Nota:** `jogador.rankingPublico` precisa vir de `GET /api/auth/me` — em `auth.js`,
adicionar `p.ranking_publico` no `select` de `/me` e `rankingPublico: p.ranking_publico` no
`res.json`. Atualizar `site/server/test/auth.test.js` de acordo (novo campo no fixture
`JOGADOR` e no `toEqual` do teste `/me`).

- [ ] **Step 5: Build e testes (client e server)**

Run: `cd site/client && npm run build && npm test`
Run: `cd site/server && npm test`
Expected: ambos limpos/PASS.

- [ ] **Step 6: Commit**

```bash
git add site/client/src/pages/RankingPublico.jsx site/client/src/App.jsx site/client/src/components/Shell.jsx site/client/src/pages/Perfil.jsx site/server/src/routes/auth.js site/server/test/auth.test.js
git commit -m "feat: ranking publico (client) e toggle de opt-in em minha conta"
```

---

## Fora de escopo (próximas iterações, se pedido)

- Exclusividade de Time (jogador em só 1 Time por grupo).
- Ícone dedicado pra "Times" no set de ícones do menu (reaproveita o de "Jogadores" por ora).
- Notificação quando alguém compara seu Time público.
