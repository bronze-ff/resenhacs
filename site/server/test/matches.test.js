import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { detectProvider } from '../src/routes/clips.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '76561198000000009', isAdmin: false }, config.jwtSecret)}`

// Roteia por SQL para simular as várias queries de cada handler.
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

describe('GET /api/matches', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/matches')).status).toBe(401)
  })

  it('lista partidas do feed', async () => {
    const { app } = appWith([
      ['from matches m', [{ id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9, status: 'parsed', source: 'valve_mm', tracked: [{ steamId: '765', nick: 'fih', won: true }] }]],
    ])
    const res = await request(app).get('/api/matches').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ id: 'm1', map: 'de_mirage', scoreA: 13, tracked: [{ nick: 'fih' }] })
  })
})

describe('GET /api/matches/:id', () => {
  it('404 quando não existe', async () => {
    const { app } = appWith([['from matches where id', []]])
    const res = await request(app).get('/api/matches/xxx').set('Cookie', cookie)
    expect(res.status).toBe(404)
  })

  it('devolve placar, rounds, highlights e clipes', async () => {
    const { app } = appWith([
      ['from matches where id', [{ id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9, source: 'valve_mm', status: 'parsed', demo_url: null }]],
      ['from match_players where match_id', [{ steam_id64: '765', nick: 'fih', team: 'A', kills: 25, deaths: 10, assists: 5, headshot_kills: 12, damage: 2500, rounds_played: 22, rating: '1.35', won: true, is_tracked: true }]],
      ['from rounds where match_id', [{ round_number: 1, winner_team: 'A', win_reason: 'elim' }]],
      ['from highlights h', [{ id: 'h1', steam_id64: '765', round_number: 5, kind: 'ace', description: 'ACE', nick: 'fih' }]],
      ['from clips where match_id', [{ id: 'c1', steam_id64: '765', url: 'https://allstar.gg/x', provider: 'allstar', title: 'meu ace', highlight_id: 'h1' }]],
    ])
    const res = await request(app).get('/api/matches/m1').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.players[0]).toMatchObject({ nick: 'fih', rating: 1.35, isTracked: true })
    expect(res.body.rounds[0]).toMatchObject({ roundNumber: 1, winnerTeam: 'A' })
    expect(res.body.highlights[0]).toMatchObject({ kind: 'ace', nick: 'fih' })
    expect(res.body.clips[0]).toMatchObject({ provider: 'allstar', url: 'https://allstar.gg/x' })
  })
})

describe('detectProvider', () => {
  it('reconhece os provedores', () => {
    expect(detectProvider('https://allstar.gg/clip/123')).toBe('allstar')
    expect(detectProvider('https://medal.tv/games/cs2/clips/abc')).toBe('medal')
    expect(detectProvider('https://youtu.be/xyz')).toBe('youtube')
    expect(detectProvider('https://www.youtube.com/watch?v=1')).toBe('youtube')
    expect(detectProvider('https://exemplo.com/v')).toBe('other')
    expect(detectProvider('não é url')).toBeNull()
  })
})
