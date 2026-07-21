# Aba "Clipes" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nova página `/clipes` que lista os clipes reais gerados pelo Allstar (por período: semana/mês/sempre), ordenados por uma pontuação própria (tipo de jogada + bônus de headshot), com leaderboard de jogadores.

**Architecture:** Um módulo server puro (`clipesScore.js`) calcula a pontuação; uma rota (`routes/clipes.js`) agrega `allstar_clips` + `highlights` + `kill_positions` escopado por amizade e período; uma página client (`Clipes.jsx`) renderiza abas de período + leaderboard + grade de cards, reusando o player embutido do Allstar já usado em `Partida.jsx`.

**Tech Stack:** Node/Express, PostgreSQL, React + Vite + Tailwind, Vitest.

## Global Constraints

- **Escopo**: só `allstar_clips` com `status = 'Processed'` — links manuais da tabela `clips` ficam de fora.
- **Visibilidade**: mesma regra do resto do site — `partidaVisivelExpr` (de `site/server/src/friendships.js`) escopado por `req.player.steamId`.
- **Fórmula de pontuação** (ver spec `docs/superpowers/specs/2026-07-21-aba-clipes-design.md`):
  - Base por `kind`: `ace`=100, `clutch_1v5`=100, `clutch_1v4`=85, `quad`=80, `clutch_1v3`=65, `triple`=60, `clutch_1v2`=45, `clutch_1v1`=25, qualquer outro=10.
  - Bônus `+20` se todos os kills daquele round pelo jogador foram headshot.
- **Período**: `semana` (`played_at >= now() - interval '7 days'`), `mes` (`>= now() - interval '30 days'`), `sempre` (sem filtro). Default `sempre`.
- **PT-BR** em código/comentários/UI, seguindo o estilo do repo.

---

## File Structure

**Criados:**
- `site/server/src/clipesScore.js` — função pura de pontuação.
- `site/server/test/clipesScore.test.js`.
- `site/server/src/routes/clipes.js` — rota `GET /api/clipes`.
- `site/server/test/clipes.test.js`.
- `site/client/src/pages/Clipes.jsx` — página nova.
- `site/client/src/test/Clipes.test.jsx`.

**Modificados:**
- `site/server/src/app.js` — registra o router novo.
- `site/client/src/App.jsx` — importa `Clipes`, adiciona a rota `/clipes`.
- `site/client/src/components/Shell.jsx` — novo item de menu, renumeração.

---

## Task 1: Módulo de pontuação (`clipesScore.js`)

**Files:**
- Create: `site/server/src/clipesScore.js`
- Test: `site/server/test/clipesScore.test.js`

**Interfaces:**
- Produces: `calcularPontuacao({ kind, todosHeadshot }) -> { base: number, kind: string, bonusHeadshot: number, total: number }`

- [ ] **Step 1: Escrever os testes**

```js
import { describe, it, expect } from 'vitest'
import { calcularPontuacao } from '../src/clipesScore.js'

describe('calcularPontuacao', () => {
  it('base por tipo de jogada, sem bonus', () => {
    expect(calcularPontuacao({ kind: 'ace', todosHeadshot: false })).toEqual({ base: 100, kind: 'ace', bonusHeadshot: 0, total: 100 })
    expect(calcularPontuacao({ kind: 'clutch_1v5', todosHeadshot: false }).base).toBe(100)
    expect(calcularPontuacao({ kind: 'clutch_1v4', todosHeadshot: false }).base).toBe(85)
    expect(calcularPontuacao({ kind: 'quad', todosHeadshot: false }).base).toBe(80)
    expect(calcularPontuacao({ kind: 'clutch_1v3', todosHeadshot: false }).base).toBe(65)
    expect(calcularPontuacao({ kind: 'triple', todosHeadshot: false }).base).toBe(60)
    expect(calcularPontuacao({ kind: 'clutch_1v2', todosHeadshot: false }).base).toBe(45)
    expect(calcularPontuacao({ kind: 'clutch_1v1', todosHeadshot: false }).base).toBe(25)
  })

  it('kind desconhecido usa o piso de 10 pontos', () => {
    expect(calcularPontuacao({ kind: 'algo_novo', todosHeadshot: false })).toEqual({ base: 10, kind: 'algo_novo', bonusHeadshot: 0, total: 10 })
  })

  it('bonus de +20 quando todosHeadshot é true', () => {
    expect(calcularPontuacao({ kind: 'triple', todosHeadshot: true })).toEqual({ base: 60, kind: 'triple', bonusHeadshot: 20, total: 80 })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/server && npx vitest run test/clipesScore.test.js`
Expected: FAIL — `Cannot find module '../src/clipesScore.js'`.

- [ ] **Step 3: Escrever o módulo**

```js
// Pontuação própria dos clipes (aba Clipes) — a Allstar não expõe a fórmula deles no
// webhook (só clipUrl/clipTitle/clipSnapshotURL/status), então esta é uma fórmula
// nossa: base pelo tipo da jogada + bônus se todos os kills daquele round foram
// headshot. Ver docs/superpowers/specs/2026-07-21-aba-clipes-design.md.
const BASE_POR_KIND = {
  ace: 100,
  clutch_1v5: 100,
  clutch_1v4: 85,
  quad: 80,
  clutch_1v3: 65,
  triple: 60,
  clutch_1v2: 45,
  clutch_1v1: 25,
}
const BASE_PADRAO = 10
const BONUS_TODOS_HEADSHOT = 20

export function calcularPontuacao({ kind, todosHeadshot }) {
  const base = BASE_POR_KIND[kind] ?? BASE_PADRAO
  const bonusHeadshot = todosHeadshot ? BONUS_TODOS_HEADSHOT : 0
  return { base, kind, bonusHeadshot, total: base + bonusHeadshot }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd site/server && npx vitest run test/clipesScore.test.js`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add site/server/src/clipesScore.js site/server/test/clipesScore.test.js
git commit -m "feat: modulo de pontuacao dos clipes (clipesScore.js)"
```

---

## Task 2: Rota `GET /api/clipes`

**Files:**
- Create: `site/server/src/routes/clipes.js`
- Test: `site/server/test/clipes.test.js`
- Modify: `site/server/src/app.js`

**Interfaces:**
- Consumes: `calcularPontuacao` de `../clipesScore.js` (Task 1); `partidaVisivelExpr(alias, viewerParam)` de `../friendships.js`.
- Produces: `createClipesRouter({ db, requireAuth }) -> Router`, montado em `/api/clipes`.
  - `GET /?periodo=semana|mes|sempre` → `{ clipes: [...], leaderboard: [...] }` (shape abaixo).

- [ ] **Step 1: Escrever os testes**

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookieA = `resenha_token=${signToken({ steamId: '111' }, config.jwtSecret)}`

const CLIPE_ROW = {
  id: 'c1', clip_url: 'https://allstar.gg/clip/1', clip_snapshot_url: 'https://x/snap.jpg',
  highlight_id: 'h1', steam_id64: '111', round_number: 5, kind: 'ace', match_id: 'm1',
  map: 'de_mirage', played_at: '2026-07-20T00:00:00Z', nick: 'bronze', avatar_url: null,
}

function appWith({ clipes = [], killPositions = { hs: 0, total: 0 } } = {}) {
  const query = vi.fn().mockImplementation((sql) => {
    if (sql.includes('from allstar_clips')) return Promise.resolve({ rows: clipes })
    if (sql.includes('from kill_positions')) return Promise.resolve({ rows: [killPositions] })
    return Promise.resolve({ rows: [] })
  })
  const db = { query }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/clipes', () => {
  it('sem clipes: devolve listas vazias', async () => {
    const { app } = appWith({ clipes: [] })
    const res = await request(app).get('/api/clipes').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ clipes: [], leaderboard: [] })
  })

  it('um clipe ace sem headshot total: pontuação 100', async () => {
    const { app } = appWith({ clipes: [CLIPE_ROW], killPositions: { hs: 1, total: 2 } })
    const res = await request(app).get('/api/clipes').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    expect(res.body.clipes).toHaveLength(1)
    expect(res.body.clipes[0]).toMatchObject({
      id: 'c1', steamId: '111', nick: 'bronze', kind: 'ace', roundNumber: 5, map: 'de_mirage',
      pontuacao: { base: 100, kind: 'ace', bonusHeadshot: 0, total: 100 },
    })
  })

  it('todos os kills do round foram headshot: bonus aplicado', async () => {
    const { app } = appWith({ clipes: [CLIPE_ROW], killPositions: { hs: 2, total: 2 } })
    const res = await request(app).get('/api/clipes').set('Cookie', cookieA)
    expect(res.body.clipes[0].pontuacao).toEqual({ base: 100, kind: 'ace', bonusHeadshot: 20, total: 120 })
  })

  it('leaderboard agrega por jogador: contagem e melhor pontuação', async () => {
    const outroClipe = { ...CLIPE_ROW, id: 'c2', kind: 'triple' }
    const { app } = appWith({ clipes: [CLIPE_ROW, outroClipe], killPositions: { hs: 0, total: 2 } })
    const res = await request(app).get('/api/clipes').set('Cookie', cookieA)
    expect(res.body.leaderboard).toEqual([
      { steamId: '111', nick: 'bronze', avatarUrl: null, clipes: 2, melhorPontuacao: 100 },
    ])
  })

  it('periodo semana: filtra played_at por 7 dias', async () => {
    const { app, db } = appWith({ clipes: [] })
    await request(app).get('/api/clipes?periodo=semana').set('Cookie', cookieA)
    const call = db.query.mock.calls.find((c) => c[0].includes('from allstar_clips'))
    expect(call[0]).toContain("interval '7 days'")
  })

  it('periodo mes: filtra played_at por 30 dias', async () => {
    const { app, db } = appWith({ clipes: [] })
    await request(app).get('/api/clipes?periodo=mes').set('Cookie', cookieA)
    const call = db.query.mock.calls.find((c) => c[0].includes('from allstar_clips'))
    expect(call[0]).toContain("interval '30 days'")
  })

  it('so aceita clipes com status Processed (filtro fixo na query)', async () => {
    const { app, db } = appWith({ clipes: [] })
    await request(app).get('/api/clipes').set('Cookie', cookieA)
    const call = db.query.mock.calls.find((c) => c[0].includes('from allstar_clips'))
    expect(call[0]).toContain("ac.status = 'Processed'")
  })

  it('escopa por amizade via partidaVisivelExpr (sem group_id)', async () => {
    const { app, db } = appWith({ clipes: [] })
    await request(app).get('/api/clipes').set('Cookie', cookieA)
    const call = db.query.mock.calls.find((c) => c[0].includes('from allstar_clips'))
    expect(call[0]).toContain('from friendships f')
    expect(call[0]).not.toContain('group_id')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/server && npx vitest run test/clipes.test.js`
Expected: FAIL — rota `/api/clipes` responde 404 (router não existe).

- [ ] **Step 3: Escrever o router**

```js
import { Router } from 'express'
import { partidaVisivelExpr } from '../friendships.js'
import { calcularPontuacao } from '../clipesScore.js'

const PERIODOS = {
  semana: "and m.played_at >= now() - interval '7 days'",
  mes: "and m.played_at >= now() - interval '30 days'",
  sempre: '',
}

// Verifica, pra um round específico de um jogador, se TODOS os kills dele naquele
// round foram headshot — vira o bônus "ALL HEADSHOTS" da pontuação (ver clipesScore.js).
async function todosHeadshotNoRound(db, { matchId, roundNumber, steamId }) {
  const { rows } = await db.query(
    `select count(*) filter (where kp.headshot) as hs, count(*) as total
     from kill_positions kp
     where kp.match_id = $1 and kp.round_number = $2 and kp.killer = $3`,
    [matchId, roundNumber, steamId],
  )
  const hs = Number(rows[0]?.hs ?? 0)
  const total = Number(rows[0]?.total ?? 0)
  return total > 0 && hs === total
}

export function createClipesRouter({ db, requireAuth }) {
  const router = Router()

  // Clipes reais do Allstar (status='Processed'), escopados por amizade e período,
  // com pontuação própria (a Allstar não expõe a fórmula deles) + leaderboard de
  // jogadores. Links manuais (tabela `clips`) ficam de fora — não têm highlight/round
  // pra pontuar. Ver docs/superpowers/specs/2026-07-21-aba-clipes-design.md.
  router.get('/', requireAuth, async (req, res) => {
    const periodo = PERIODOS[req.query.periodo] !== undefined ? req.query.periodo : 'sempre'
    const eu = req.player.steamId
    const { rows } = await db.query(
      `select ac.id, ac.clip_url, ac.clip_snapshot_url,
              h.round_number, h.kind, h.match_id, h.steam_id64,
              m.map, m.played_at,
              p.nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url
       from allstar_clips ac
       join highlights h on h.id = ac.highlight_id
       join matches m on m.id = h.match_id
       join players p on p.steam_id64 = h.steam_id64
       left join steam_avatares sa on sa.steam_id64 = h.steam_id64
       where ac.status = 'Processed' and ${partidaVisivelExpr('m', '$1')} ${PERIODOS[periodo]}
       order by m.played_at desc`,
      [eu],
    )

    const clipes = await Promise.all(
      rows.map(async (r) => {
        const todosHeadshot = await todosHeadshotNoRound(db, {
          matchId: r.match_id, roundNumber: r.round_number, steamId: r.steam_id64,
        })
        return {
          id: r.id,
          matchId: r.match_id,
          steamId: r.steam_id64,
          nick: r.nick,
          avatarUrl: r.avatar_url,
          clipUrl: r.clip_url,
          clipSnapshotUrl: r.clip_snapshot_url,
          kind: r.kind,
          roundNumber: r.round_number,
          map: r.map,
          playedAt: r.played_at,
          pontuacao: calcularPontuacao({ kind: r.kind, todosHeadshot }),
        }
      }),
    )
    clipes.sort((a, b) => b.pontuacao.total - a.pontuacao.total)

    const porJogador = new Map()
    for (const c of clipes) {
      const atual = porJogador.get(c.steamId) ?? { steamId: c.steamId, nick: c.nick, avatarUrl: c.avatarUrl, clipes: 0, melhorPontuacao: 0 }
      atual.clipes += 1
      atual.melhorPontuacao = Math.max(atual.melhorPontuacao, c.pontuacao.total)
      porJogador.set(c.steamId, atual)
    }
    const leaderboard = [...porJogador.values()].sort((a, b) => b.melhorPontuacao - a.melhorPontuacao)

    res.json({ clipes, leaderboard })
  })

  return router
}
```

- [ ] **Step 4: Registrar em `app.js`**

Adicionar o import junto aos outros routers (perto de `createFriendshipsRouter`):

```js
import { createClipesRouter } from './routes/clipes.js'
```

E montar (logo após `/api/clips`, o de links manuais):

```js
  app.use('/api/clipes', createClipesRouter({ db, requireAuth }))
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd site/server && npx vitest run test/clipes.test.js`
Expected: PASS (7/7).

Rodar a suíte inteira do server: `cd site/server && npx vitest run --no-file-parallelism` — confirmar que os testes existentes continuam passando, sem regressão.

- [ ] **Step 6: Commit**

```bash
git add site/server/src/routes/clipes.js site/server/test/clipes.test.js site/server/src/app.js
git commit -m "feat: rota GET /api/clipes com pontuacao e leaderboard"
```

---

## Task 3: Página `Clipes.jsx`

**Files:**
- Create: `site/client/src/pages/Clipes.jsx`
- Test: `site/client/src/test/Clipes.test.jsx`

**Interfaces:**
- Consumes: `GET /api/clipes?periodo=...` (Task 2), shape `{ clipes: [{ id, matchId, steamId, nick, avatarUrl, clipUrl, clipSnapshotUrl, kind, roundNumber, map, playedAt, pontuacao: { base, kind, bonusHeadshot, total } }], leaderboard: [{ steamId, nick, avatarUrl, clipes, melhorPontuacao }] }`.
- Componentes reusados: `Card`, `SectionHeader`, `DataTable`, `Badge` (de `../components/ui`).

- [ ] **Step 1: Escrever o teste**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Clipes from '../pages/Clipes.jsx'

const RESPOSTA = {
  clipes: [{
    id: 'c1', matchId: 'm1', steamId: '111', nick: 'bronze', avatarUrl: null,
    clipUrl: 'https://allstar.gg/clip/1', clipSnapshotUrl: null,
    kind: 'ace', roundNumber: 5, map: 'de_mirage', playedAt: '2026-07-20T00:00:00Z',
    pontuacao: { base: 100, kind: 'ace', bonusHeadshot: 20, total: 120 },
  }],
  leaderboard: [{ steamId: '111', nick: 'bronze', avatarUrl: null, clipes: 1, melhorPontuacao: 120 }],
}

describe('Clipes', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPOSTA })
  })

  it('mostra o clipe com a pontuação e o leaderboard', async () => {
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('bronze').length ?? screen.getAllByText('bronze').length).toBeGreaterThan(0))
    expect(screen.getByText('120')).toBeInTheDocument()
  })

  it('troca de período dispara novo fetch com o query param certo', async () => {
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/clipes?periodo=sempre'))
    screen.getByText('Semana').click()
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/clipes?periodo=semana'))
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/client && npx vitest run src/test/Clipes.test.jsx`
Expected: FAIL — `Clipes.jsx` não existe.

- [ ] **Step 3: Escrever a página**

```jsx
import { useEffect, useState } from 'react'
import { Card, SectionHeader, DataTable, Badge } from '../components/ui'

const PERIODOS = [
  { valor: 'semana', label: 'Semana' },
  { valor: 'mes', label: 'Mês' },
  { valor: 'sempre', label: 'Sempre' },
]

const NOME_KIND = {
  ace: 'ACE', quad: 'QUAD KILL', triple: 'TRIPLE KILL',
  clutch_1v5: 'CLUTCH 1v5', clutch_1v4: 'CLUTCH 1v4', clutch_1v3: 'CLUTCH 1v3',
  clutch_1v2: 'CLUTCH 1v2', clutch_1v1: 'CLUTCH 1v1',
}

function nomeDoKind(kind) {
  return NOME_KIND[kind] ?? kind
}

// Player embutido do Allstar — mesmo padrão usado na aba Clipes de Partida.jsx
// (site/client/src/pages/Partida.jsx), reaproveitado aqui pro modo "assistir" do card.
function PlayerClipe({ clipUrl }) {
  return (
    <div className="mt-3 aspect-video w-full">
      <iframe
        src={`${clipUrl}&location=melhoresClipes`}
        allow="clipboard-write; autoplay"
        className="h-full w-full border border-borda"
      />
    </div>
  )
}

function CardClipe({ clipe, aberto, onAbrir }) {
  const { pontuacao } = clipe
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge tom="destaque">{nomeDoKind(clipe.kind)}</Badge>
            {pontuacao.bonusHeadshot > 0 && <Badge tom="sucesso">ALL HEADSHOTS</Badge>}
          </div>
          <p className="mt-1 truncate font-mono text-sm text-texto">
            {clipe.nick} · round {clipe.roundNumber} · {clipe.map}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div
            className="font-display text-lg font-bold text-destaque"
            title={`${pontuacao.kind} (${pontuacao.base})${pontuacao.bonusHeadshot ? ` + All Headshots (+${pontuacao.bonusHeadshot})` : ''} = ${pontuacao.total}`}
          >
            {pontuacao.total}
          </div>
        </div>
      </div>
      {clipe.clipSnapshotUrl && !aberto && (
        <img src={clipe.clipSnapshotUrl} alt="" className="mt-3 aspect-video w-full border border-borda object-cover" />
      )}
      <button
        type="button"
        onClick={() => onAbrir(aberto ? null : clipe.id)}
        className="panel-cut-sm mt-3 min-h-10 w-full border border-borda px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-texto-fraco hover:border-destaque/50 hover:text-destaque lg:min-h-0"
      >
        {aberto ? 'Fechar' : '▶ Assistir'}
      </button>
      {aberto && <PlayerClipe clipUrl={clipe.clipUrl} />}
    </Card>
  )
}

export default function Clipes() {
  const [periodo, setPeriodo] = useState('sempre')
  const [dados, setDados] = useState(null)
  const [clipeAberto, setClipeAberto] = useState(null)

  useEffect(() => {
    setDados(null)
    fetch(`/api/clipes?periodo=${periodo}`)
      .then((res) => (res.ok ? res.json() : { clipes: [], leaderboard: [] }))
      .then(setDados)
      .catch(() => setDados({ clipes: [], leaderboard: [] }))
  }, [periodo])

  return (
    <div className="space-y-6">
      <SectionHeader
        titulo="Clipes"
        className="flex-wrap"
        acao={
          <div className="flex gap-2">
            {PERIODOS.map((p) => (
              <button
                key={p.valor}
                onClick={() => setPeriodo(p.valor)}
                className={`panel-cut-sm min-h-10 border px-3 py-1.5 font-mono text-xs uppercase tracking-wide lg:min-h-0 ${
                  periodo === p.valor ? 'border-destaque bg-destaque/10 text-destaque' : 'border-borda text-texto-fraco'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />
      <p className="font-mono text-xs text-texto-fraco">
        Pontuação calculada pelo Resenha (tipo de jogada + bônus de headshot) — não é a fórmula da Allstar.
      </p>

      {dados === null ? (
        <p className="font-mono text-sm text-texto-fraco">Carregando…</p>
      ) : dados.clipes.length === 0 ? (
        <p className="font-mono text-sm text-texto-fraco">Nenhum clipe nesse período ainda.</p>
      ) : (
        <>
          {dados.leaderboard.length > 0 && (
            <section>
              <h3 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">
                Leaderboard
              </h3>
              <div className="panel-cut border border-borda">
                <DataTable
                  head={<tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Jogador</th><th className="px-2 py-2 text-right">Clipes</th><th className="px-3 py-2 text-right">Melhor pontuação</th></tr>}
                >
                  {dados.leaderboard.map((l, i) => (
                    <tr key={l.steamId}>
                      <td className="px-3 py-2 font-mono text-texto-fraco">{i + 1}º</td>
                      <td className="px-3 py-2 font-mono text-texto">{l.nick}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{l.clipes}</td>
                      <td className="px-3 py-2 text-right font-display font-bold text-destaque tabular-nums">{l.melhorPontuacao}</td>
                    </tr>
                  ))}
                </DataTable>
              </div>
            </section>
          )}

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dados.clipes.map((c) => (
              <CardClipe key={c.id} clipe={c} aberto={clipeAberto === c.id} onAbrir={setClipeAberto} />
            ))}
          </section>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd site/client && npx vitest run src/test/Clipes.test.jsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add site/client/src/pages/Clipes.jsx site/client/src/test/Clipes.test.jsx
git commit -m "feat: pagina Clipes (melhores clipes + leaderboard)"
```

---

## Task 4: Menu e rota no client

**Files:**
- Modify: `site/client/src/App.jsx`
- Modify: `site/client/src/components/Shell.jsx`

**Interfaces:**
- Consumes: `Clipes` de `./pages/Clipes.jsx` (Task 3).

- [ ] **Step 1: `App.jsx`**

Adicionar o import (perto dos outros `import ... from './pages/...'`):

```js
import Clipes from './pages/Clipes.jsx'
```

Adicionar a rota, logo após `/enviar-demo` e antes de `/jogadores`:

```jsx
          <Route path="/clipes" element={<RotaProtegida><Clipes /></RotaProtegida>} />
```

- [ ] **Step 2: `Shell.jsx` — inserir item e renumerar**

O array `ITENS` atual (`site/client/src/components/Shell.jsx`) é:

```js
const ITENS = [
  { to: '/', end: true, label: 'Partidas', num: '01', icone: 'partidas' },
  { to: '/ranking', label: 'Ranking', num: '02', icone: 'ranking' },
  { to: '/enviar-demo', label: 'Enviar demo', num: '03', icone: 'enviarDemo' },
  { to: '/jogadores', label: 'Amigos', num: '04', icone: 'jogadores' },
  { to: '/comparar', label: 'Comparar', num: '05', icone: 'comparar' },
  { to: '/granadas', label: 'Granadas', num: '06', icone: 'granadas' },
  { to: '/taticas', label: 'Táticas', num: '07', icone: 'taticas' },
  { to: '/conta', label: 'Minha conta', num: '08', icone: 'perfil' },
  { to: '/curso', label: 'Curso de mira', num: '09', icone: 'curso' },
]
```

Trocar para (insere "Clipes" como `04`, empurra o resto):

```js
const ITENS = [
  { to: '/', end: true, label: 'Partidas', num: '01', icone: 'partidas' },
  { to: '/ranking', label: 'Ranking', num: '02', icone: 'ranking' },
  { to: '/enviar-demo', label: 'Enviar demo', num: '03', icone: 'enviarDemo' },
  { to: '/clipes', label: 'Clipes', num: '04', icone: 'clipes' },
  { to: '/jogadores', label: 'Amigos', num: '05', icone: 'jogadores' },
  { to: '/comparar', label: 'Comparar', num: '06', icone: 'comparar' },
  { to: '/granadas', label: 'Granadas', num: '07', icone: 'granadas' },
  { to: '/taticas', label: 'Táticas', num: '08', icone: 'taticas' },
  { to: '/conta', label: 'Minha conta', num: '09', icone: 'perfil' },
  { to: '/curso', label: 'Curso de mira', num: '10', icone: 'curso' },
]
```

Adicionar um ícone novo em `NAV_ICONES` (objeto de ícones SVG no mesmo arquivo, perto de `enviarDemo`/`jogadores`):

```js
  clipes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="M9 9L15 12L9 15V9Z" fill="currentColor" stroke="none" />
    </svg>
  ),
```

Os itens de super-admin (`Admin`/`Partidas pro`), numerados separado no JSX
(fora do array `ITENS`, em `site/client/src/components/Shell.jsx:231,242` —
os dois `<span>` com o número fixo `10`/`11`), sobem pra **`11`/`12`**:

```jsx
                <span className={`font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque ${colapsada ? 'lg:hidden' : ''}`}>11</span>
                <span className={colapsada ? 'lg:hidden' : ''}>Admin</span>
```
```jsx
                <span className={`font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque ${colapsada ? 'lg:hidden' : ''}`}>12</span>
                <span className={colapsada ? 'lg:hidden' : ''}>Partidas pro</span>
```

- [ ] **Step 3: Verificar no browser**

Rodar o dev server (`resenha-client` + `resenha-server`) e conferir visualmente que o
menu mostra "Clipes" (04) entre "Enviar demo" e "Amigos", com Admin/Partidas pro em
11/12 sem gaps. Login exige Steam OAuth real — se não for possível logar no preview,
ao menos confirmar que o app monta sem erro de console e a rota `/clipes` existe.

- [ ] **Step 4: Rodar a suíte inteira do client**

Run: `cd site/client && npx vitest run`
Expected: PASS, sem regressão nos testes existentes de `App.test.jsx`/`Shell`.

- [ ] **Step 5: Commit**

```bash
git add site/client/src/App.jsx site/client/src/components/Shell.jsx
git commit -m "feat: adiciona Clipes ao menu (04), renumera itens seguintes"
```
