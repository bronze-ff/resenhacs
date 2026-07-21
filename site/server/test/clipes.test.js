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

  it('clipe gerado por jogador (sem highlight nosso batendo o round) ainda aparece, com pontuação padrão', async () => {
    // Clipe gerado pelo novo fluxo por jogador (BP, ver allstarClip.js) — a Allstar
    // escolheu um round que não bate com nenhum highlight nosso, então o subquery de
    // kind não acha nada (null). O clipe não pode sumir da lista por isso.
    const semKind = { ...CLIPE_ROW, id: 'c3', kind: null, round_number: 9 }
    const { app } = appWith({ clipes: [semKind], killPositions: { hs: 0, total: 0 } })
    const res = await request(app).get('/api/clipes').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    expect(res.body.clipes).toHaveLength(1)
    expect(res.body.clipes[0]).toMatchObject({
      id: 'c3', steamId: '111', roundNumber: 9, kind: null,
      pontuacao: { base: 10, kind: null, bonusHeadshot: 0, total: 10 },
    })
  })

  it('escopa por amizade via partidaVisivelExpr (sem group_id)', async () => {
    const { app, db } = appWith({ clipes: [] })
    await request(app).get('/api/clipes').set('Cookie', cookieA)
    const call = db.query.mock.calls.find((c) => c[0].includes('from allstar_clips'))
    expect(call[0]).toContain('from friendships f')
    expect(call[0]).not.toContain('group_id')
  })
})
