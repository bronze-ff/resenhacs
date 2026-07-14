import { describe, it, expect, vi } from 'vitest'
import { Readable } from 'node:stream'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { detectProvider } from '../src/routes/clips.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos' }
const cookie = `resenha_token=${signToken({ steamId: '76561198000000009', isAdmin: false }, config.jwtSecret)}`

// Roteia por SQL para simular as várias queries de cada handler.
function appWith(handlers, extra = {}) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      for (const [needle, rows] of handlers) {
        if (sql.includes(needle)) return Promise.resolve({ rows })
      }
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db, ...extra }), db }
}

describe('GET /api/matches', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/matches')).status).toBe(401)
  })

  it('lista partidas do feed', async () => {
    const { app } = appWith([
      ['from matches m', [{ id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9, status: 'parsed', source: 'valve_mm', tracked: [{ steamId: '765', nick: 'fih', won: true }], mvp: { steamId: '765', nick: 'fih', rating: '1.35' } }]],
    ])
    const res = await request(app).get('/api/matches').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ id: 'm1', map: 'de_mirage', scoreA: 13, tracked: [{ nick: 'fih' }], mvp: { steamId: '765', nick: 'fih', rating: 1.35 } })
  })

  it('partida sem mvp rastreado devolve mvp null', async () => {
    const { app } = appWith([
      ['from matches m', [{ id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9, status: 'parsed', source: 'valve_mm', tracked: [], mvp: null }]],
    ])
    const res = await request(app).get('/api/matches').set('Cookie', cookie)
    expect(res.body[0].mvp).toBeNull()
  })

  it('filtra por mvp quando steamid válido é passado', async () => {
    const { app, db } = appWith([
      ['from matches m', [{ id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9, status: 'parsed', source: 'valve_mm', tracked: [], mvp: { steamId: '76561198000000009', nick: 'fih', rating: '1.35' } }]],
    ])
    const res = await request(app).get('/api/matches?mvp=76561198000000009').set('Cookie', cookie)
    expect(res.status).toBe(200)
    const sql = db.query.mock.calls.find(([s]) => s.includes('from matches m'))[0]
    expect(sql).toContain('mvp_filter')
  })

  it('ignora param mvp inválido (não é steamid 64-bit)', async () => {
    const { app, db } = appWith([
      ['from matches m', [{ id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9, status: 'parsed', source: 'valve_mm', tracked: [], mvp: null }]],
    ])
    const res = await request(app).get('/api/matches?mvp=abc').set('Cookie', cookie)
    expect(res.status).toBe(200)
    const sql = db.query.mock.calls.find(([s]) => s.includes('from matches m'))[0]
    expect(sql).not.toContain('mvp_filter')
  })

  it('aceita limit e offset e os manda como params parametrizados', async () => {
    const { app, db } = appWith([['from matches m', []]])
    const res = await request(app).get('/api/matches?limit=5&offset=10').set('Cookie', cookie)
    expect(res.status).toBe(200)
    const call = db.query.mock.calls.find(([s]) => s.includes('from matches m'))
    const [sql, params] = call
    expect(sql).toContain('limit $')
    expect(sql).toContain('offset $')
    expect(params.slice(-2)).toEqual([5, 10])
  })

  it('limit/offset inválidos caem no default (20/0)', async () => {
    const { app, db } = appWith([['from matches m', []]])
    const res = await request(app).get('/api/matches?limit=abc&offset=-3').set('Cookie', cookie)
    expect(res.status).toBe(200)
    const call = db.query.mock.calls.find(([s]) => s.includes('from matches m'))
    const [, params] = call
    expect(params.slice(-2)).toEqual([20, 0])
  })

  it('limit fora do range 1..100 cai no default', async () => {
    const { app, db } = appWith([['from matches m', []]])
    await request(app).get('/api/matches?limit=500').set('Cookie', cookie)
    const call = db.query.mock.calls.find(([s]) => s.includes('from matches m'))
    const [, params] = call
    expect(params.slice(-2)).toEqual([20, 0])
  })

  it('sem limit/offset usa default (20/0) e não quebra filtros existentes', async () => {
    const { app, db } = appWith([['from matches m', []]])
    await request(app).get('/api/matches?map=de_mirage').set('Cookie', cookie)
    const call = db.query.mock.calls.find(([s]) => s.includes('from matches m'))
    const [sql, params] = call
    expect(sql).toContain('m.map = $1')
    expect(params).toEqual(['de_mirage', 20, 0])
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
      ['from match_players mp', [{ steam_id64: '765', nick: 'fih', team: 'A', kills: 25, team_kills: 1, deaths: 10, assists: 5, headshot_kills: 12, damage: 2500, rounds_played: 22, rating: '1.35', won: true, is_tracked: true, avatar_url: 'https://avatars.steamstatic.com/fih.jpg' }]],
      ['from rounds where match_id', [{ round_number: 1, winner_team: 'A', win_reason: 'elim' }]],
      ['from highlights h', [{ id: 'h1', steam_id64: '765', round_number: 5, kind: 'ace', description: 'ACE', frame: 12, nick: 'fih' }]],
      ['from clips where match_id', [{ id: 'c1', steam_id64: '765', url: 'https://allstar.gg/x', provider: 'allstar', title: 'meu ace', highlight_id: 'h1' }]],
    ])
    const res = await request(app).get('/api/matches/m1').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.players[0]).toMatchObject({ nick: 'fih', rating: 1.35, isTracked: true, teamKills: 1, avatarUrl: 'https://avatars.steamstatic.com/fih.jpg' })
    expect(res.body.rounds[0]).toMatchObject({ roundNumber: 1, winnerTeam: 'A' })
    expect(res.body.highlights[0]).toMatchObject({ kind: 'ace', nick: 'fih', frame: 12 })
    expect(res.body.clips[0]).toMatchObject({ provider: 'allstar', url: 'https://allstar.gg/x' })
    expect(res.body.demoUrl).toBeNull() // sem demo_url no fixture
  })

  it('jogador sem cadastro no grupo usa o avatar em cache da steam_avatares (fallback)', async () => {
    const { app } = appWith([
      ['from matches where id', [{ id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9, source: 'valve_mm', status: 'parsed', demo_url: null }]],
      ['from match_players mp', [{ steam_id64: '999', nick: 'adversario', team: 'B', kills: 10, team_kills: 0, deaths: 15, assists: 2, headshot_kills: 3, damage: 1200, rounds_played: 22, rating: '0.85', won: false, is_tracked: false, avatar_url: 'https://avatars.steamstatic.com/cache.jpg' }]],
      ['from rounds where match_id', []],
      ['from highlights h', []],
      ['from clips where match_id', []],
    ])
    const res = await request(app).get('/api/matches/m1').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.players[0]).toMatchObject({ nick: 'adversario', isTracked: false, avatarUrl: 'https://avatars.steamstatic.com/cache.jpg' })
  })

  it('replayUrl aponta pro proxy do servidor, nunca pra URL crua do R2', async () => {
    const { app } = appWith([
      ['from matches where id', [{
        id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9,
        source: 'valve_mm', status: 'parsed',
        demo_url: 'https://acc.r2.cloudflarestorage.com/resenha-demos/demos/1.dem.bz2',
        replay_url: 'https://acc.r2.cloudflarestorage.com/resenha-demos/replays/1.json',
      }]],
    ])
    const res = await request(app).get('/api/matches/m1').set('Cookie', cookie)
    expect(res.body.demoUrl).toBe('/api/matches/m1/demo')
    expect(res.body.replayUrl).toBe('/api/matches/m1/replay')
    expect(res.body.replayUrl).not.toContain('r2.cloudflarestorage.com')
  })
})

describe('GET /api/matches/:id/replay', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/matches/m1/replay')).status).toBe(401)
  })

  it('R2 não configurado: 503', async () => {
    const { app } = appWith([], { r2Client: null })
    const res = await request(app).get('/api/matches/m1/replay').set('Cookie', cookie)
    expect(res.status).toBe(503)
  })

  it('partida sem replay: 404', async () => {
    const fakeR2 = { send: vi.fn() }
    const { app } = appWith([['select replay_url', [{ replay_url: null }]]], { r2Client: fakeR2 })
    const res = await request(app).get('/api/matches/m1/replay').set('Cookie', cookie)
    expect(res.status).toBe(404)
    expect(fakeR2.send).not.toHaveBeenCalled()
  })

  it('faz proxy autenticado do objeto no R2 (nunca expõe a URL crua)', async () => {
    const corpo = Readable.from([Buffer.from('{"map":"de_anubis"}')])
    const fakeR2 = {
      send: vi.fn().mockResolvedValue({ ContentType: 'application/json', Body: corpo }),
    }
    const { app } = appWith(
      [['select replay_url', [{ replay_url: 'https://acc.r2.cloudflarestorage.com/resenha-demos/replays/701c.json' }]]],
      { r2Client: fakeR2 },
    )
    const res = await request(app).get('/api/matches/701c/replay').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.text).toBe('{"map":"de_anubis"}')
    const cmd = fakeR2.send.mock.calls[0][0]
    expect(cmd.input).toMatchObject({ Bucket: 'resenha-demos', Key: 'replays/701c.json' })
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
