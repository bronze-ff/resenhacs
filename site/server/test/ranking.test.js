import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '76561198000000009', isAdmin: false }, config.jwtSecret)}`

function appWith(rows) {
  const db = { query: vi.fn().mockResolvedValue({ rows }) }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/ranking', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/ranking')).status).toBe(401)
  })

  it('calcula winrate/kd/hs e ordena por rating desc', async () => {
    const { app } = appWith([
      { steam_id64: '1', nick: 'baixo', avatar_url: null, partidas: 4, vitorias: 1, kills: 40, deaths: 50, hs: 10, rating: '0.80', aces: 0, clutches: 0 },
      { steam_id64: '2', nick: 'alto', avatar_url: null, partidas: 10, vitorias: 7, kills: 200, deaths: 150, hs: 100, rating: '1.35', aces: 3, clutches: 5 },
    ])
    const res = await request(app).get('/api/ranking').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0]).toMatchObject({ nick: 'alto', winrate: 70, kd: 1.33, hsPct: 50, rating: 1.35, aces: 3, clutches: 5 })
    expect(res.body[1].nick).toBe('baixo')
  })

  it('jogador sem partidas ainda: rating null vai pro fim', async () => {
    const { app } = appWith([
      { steam_id64: '1', nick: 'novato', avatar_url: null, partidas: 0, vitorias: 0, kills: 0, deaths: 0, hs: 0, rating: null, aces: 0, clutches: 0 },
      { steam_id64: '2', nick: 'veterano', avatar_url: null, partidas: 5, vitorias: 3, kills: 80, deaths: 60, hs: 20, rating: '1.10', aces: 1, clutches: 0 },
    ])
    const res = await request(app).get('/api/ranking').set('Cookie', cookie)
    expect(res.body.map((r) => r.nick)).toEqual(['veterano', 'novato'])
    expect(res.body[1].rating).toBeNull()
  })
})
