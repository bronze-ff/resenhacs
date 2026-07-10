import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '76561198000000009', isAdmin: false }, config.jwtSecret)}`

function appWith(handlers) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      for (const [needle, rows] of handlers) {
        if (sql.includes(needle)) return Promise.resolve({ rows })
      }
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/profile/:steamId', () => {
  it('404 quando jogador não existe', async () => {
    const { app } = appWith([['from players where steam_id64', []]])
    const res = await request(app).get('/api/profile/765').set('Cookie', cookie)
    expect(res.status).toBe(404)
  })

  it('agrega stats, winrate, ADR, HS% e sinergia', async () => {
    const { app } = appWith([
      ['from players where steam_id64', [{ steam_id64: '765', nick: 'fih', avatar_url: null, is_admin: false }]],
      ['count(*)::int as partidas', [{ partidas: 10, vitorias: 6, kills: 200, deaths: 150, assists: 40, hs: 100, damage: 3300, rounds: 220, rating: '1.15' }]],
      ['group by m.map', [{ map: 'de_mirage', partidas: 5, vitorias: 3, rating: '1.2' }]],
      ["m.status = 'parsed'", [{ id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9, kills: 20, deaths: 15, rating: '1.1', won: true }]],
      ['from synergy_pairs', [{ steam_id64: '999', nick: 'parça', avatar_url: null, partidas: 8, vitorias: 6 }]],
    ])
    const res = await request(app).get('/api/profile/765').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.jogador).toMatchObject({ nick: 'fih' })
    expect(res.body.stats).toMatchObject({ partidas: 10, vitorias: 6, winrate: 60, kills: 200 })
    expect(res.body.stats.kd).toBeCloseTo(1.33, 2)
    expect(res.body.stats.hsPct).toBe(50)
    expect(res.body.stats.adr).toBe(15) // 3300/220
    expect(res.body.sinergia[0]).toMatchObject({ nick: 'parça', partidas: 8, vitorias: 6, winrate: 75 })
  })
})
