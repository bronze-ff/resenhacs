import { describe, it, expect, vi } from 'vitest'
import { Readable } from 'node:stream'
import request from 'supertest'

vi.mock('../src/r2.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, presignDownload: vi.fn().mockResolvedValue('https://r2.example/presigned-get') }
})
import { presignDownload } from '../src/r2.js'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { detectProvider } from '../src/routes/clips.js'

const config = {
  jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos',
  allstarApiKey: null, allstarSteamIds: new Set(),
}
const cookie = `resenha_token=${signToken({ steamId: '76561198000000009', isSuperAdmin: false }, config.jwtSecret)}`
const STEAM_ID = '76561198000000009'

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
    const { app, db } = appWith([
      ['from matches m', [{ id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9, status: 'parsed', source: 'valve_mm', tracked: [{ steamId: '765', nick: 'fih', won: true }], mvp: { steamId: '765', nick: 'fih', rating: '1.35' } }]],
    ])
    const res = await request(app).get('/api/matches').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ id: 'm1', map: 'de_mirage', scoreA: 13, tracked: [{ nick: 'fih' }], mvp: { steamId: '765', nick: 'fih', rating: 1.35 } })
    // Visibilidade por amizade (friendships.js): o feed inclui partidas em que o
    // viewer jogou OU em que um amigo accepted dele jogou — nada de group_id/ranking_publico.
    const sql = db.query.mock.calls.find(([s]) => s.includes('from matches m'))[0]
    expect(sql).toContain('mv.steam_id64 = $1')
    expect(sql).toContain('from friendships f')
    expect(sql).not.toContain('group_id')
    expect(sql).not.toContain('ranking_publico')
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
    expect(sql).toContain('m.map = $2')
    expect(params).toEqual([STEAM_ID, 'de_mirage', 20, 0])
  })
})

describe('GET /api/matches/sync-status', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/matches/sync-status')).status).toBe(401)
  })

  it('escopa pending/failed por discovered_by (eu ou amigo), parsed por participação/amizade', async () => {
    const { app, db } = appWith([
      ['count(*) filter', [{ pending: 2, failed: 1, parsed: 10, last_played_at: '2026-07-01T00:00:00.000Z' }]],
    ])
    const res = await request(app).get('/api/matches/sync-status').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ pending: 2, failed: 1, parsed: 10, lastPlayedAt: '2026-07-01T00:00:00.000Z' })
    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes('count(*) filter'))
    expect(sql).toContain('m.discovered_by = $1')
    expect(sql).toContain("status = 'pending'")
    expect(sql).toContain("status = 'failed'")
    expect(sql).toContain('mv.steam_id64 = $1')
    expect(sql).toContain('from friendships f')
    expect(params).toEqual([STEAM_ID])
  })
})

describe('GET /api/matches/:id', () => {
  it('404 quando não existe', async () => {
    const { app } = appWith([['from matches mt', []]])
    const res = await request(app).get('/api/matches/xxx').set('Cookie', cookie)
    expect(res.status).toBe(404)
  })

  it('devolve placar, rounds, highlights, clipes e armas por jogador', async () => {
    const { app } = appWith([
      ['from matches mt', [{ id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9, source: 'valve_mm', status: 'parsed', demo_url: null }]],
      ['from match_players mp', [{ steam_id64: '765', nick: 'fih', team: 'A', kills: 25, team_kills: 1, deaths: 10, assists: 5, headshot_kills: 12, damage: 2500, rounds_played: 22, rating: '1.35', kast_pct: '72.5', premier_rating_before: 15420, premier_rating_after: 15480, faceit_elo_before: 1400, faceit_elo_after: 1425, won: true, is_tracked: true, avatar_url: 'https://avatars.steamstatic.com/fih.jpg' }]],
      ['from rounds where match_id', [{ round_number: 1, winner_team: 'A', win_reason: 'elim' }]],
      ['from highlights h', [{ id: 'h1', steam_id64: '765', round_number: 5, kind: 'ace', description: 'ACE', frame: 12, nick: 'fih' }]],
      ['from clips where match_id', [{ id: 'c1', steam_id64: '765', url: 'https://allstar.gg/x', provider: 'allstar', title: 'meu ace', highlight_id: 'h1' }]],
      ['from match_player_weapons', [
        { steam_id64: '765', weapon: 'deagle', kills: 22, hs_kills: 10, shots_fired: 60, shots_hit: 25, damage: 2200 },
        { steam_id64: '765', weapon: 'knife', kills: 3, hs_kills: 0, shots_fired: 0, shots_hit: 0, damage: 150 },
      ]],
    ])
    const res = await request(app).get('/api/matches/m1').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.players[0]).toMatchObject({ nick: 'fih', rating: 1.35, kastPct: 72.5, premierBefore: 15420, premierAfter: 15480, faceitEloBefore: 1400, faceitEloAfter: 1425, isTracked: true, teamKills: 1, avatarUrl: 'https://avatars.steamstatic.com/fih.jpg' })
    expect(res.body.players[0].weapons).toEqual([
      { weapon: 'deagle', kills: 22, hsKills: 10, shotsFired: 60, shotsHit: 25, damage: 2200 },
      { weapon: 'knife', kills: 3, hsKills: 0, shotsFired: 0, shotsHit: 0, damage: 150 },
    ])
    expect(res.body.rounds[0]).toMatchObject({ roundNumber: 1, winnerTeam: 'A' })
    expect(res.body.highlights[0]).toMatchObject({ kind: 'ace', nick: 'fih', frame: 12 })
    expect(res.body.clips[0]).toMatchObject({ provider: 'allstar', url: 'https://allstar.gg/x' })
    expect(res.body.demoUrl).toBeNull() // sem demo_url no fixture
  })

  it('jogador sem kills registrados: weapons vem vazio', async () => {
    const { app } = appWith([
      ['from matches mt', [{ id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9, source: 'valve_mm', status: 'parsed', demo_url: null }]],
      ['from match_players mp', [{ steam_id64: '999', nick: 'zerado', team: 'B', kills: 0, team_kills: 0, deaths: 20, assists: 0, headshot_kills: 0, damage: 0, rounds_played: 22, rating: '0.2', won: false, is_tracked: false, avatar_url: null }]],
    ])
    const res = await request(app).get('/api/matches/m1').set('Cookie', cookie)
    expect(res.body.players[0].weapons).toEqual([])
    // Sem Premier rating registrado (partida antiga, coletada antes da Task 2): null, não undefined.
    expect(res.body.players[0].premierBefore).toBeNull()
    expect(res.body.players[0].premierAfter).toBeNull()
    expect(res.body.players[0].faceitEloBefore).toBeNull()
    expect(res.body.players[0].faceitEloAfter).toBeNull()
  })

  it('jogador sem cadastro no grupo usa o avatar em cache da steam_avatares (fallback)', async () => {
    const { app } = appWith([
      ['from matches mt', [{ id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9, source: 'valve_mm', status: 'parsed', demo_url: null }]],
      ['from match_players mp', [{ steam_id64: '999', nick: 'adversario', team: 'B', kills: 10, team_kills: 0, deaths: 15, assists: 2, headshot_kills: 3, damage: 1200, rounds_played: 22, rating: '0.85', won: false, is_tracked: false, avatar_url: 'https://avatars.steamstatic.com/cache.jpg' }]],
      ['from rounds where match_id', []],
      ['from highlights h', []],
      ['from clips where match_id', []],
    ])
    const res = await request(app).get('/api/matches/m1').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.players[0]).toMatchObject({ nick: 'adversario', isTracked: false, avatarUrl: 'https://avatars.steamstatic.com/cache.jpg' })
  })

  it('partida encerrada por abandono devolve endedEarly e abandonedBy com nick', async () => {
    const { app } = appWith([
      ['from matches mt', [{
        id: 'm1', map: 'de_mirage', played_at: null, score_a: 1, score_b: 4,
        source: 'valve_mm', status: 'parsed', demo_url: null,
        ended_early: true, abandoned_by_steam_id64: '765', abandoned_by_nick: 'krn',
      }]],
    ])
    const res = await request(app).get('/api/matches/m1').set('Cookie', cookie)
    expect(res.body.endedEarly).toBe(true)
    expect(res.body.abandonedBy).toEqual({ steamId: '765', nick: 'krn' })
  })

  it('partida normal devolve endedEarly false e abandonedBy null', async () => {
    const { app } = appWith([
      ['from matches mt', [{
        id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9,
        source: 'valve_mm', status: 'parsed', demo_url: null,
        ended_early: false, abandoned_by_steam_id64: null, abandoned_by_nick: null,
      }]],
    ])
    const res = await request(app).get('/api/matches/m1').set('Cookie', cookie)
    expect(res.body.endedEarly).toBe(false)
    expect(res.body.abandonedBy).toBeNull()
  })

  it('replayUrl aponta pro proxy do servidor, nunca pra URL crua do R2', async () => {
    const { app } = appWith([
      ['from matches mt', [{
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

describe('GET /api/matches/:id/lado/:filtro', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/matches/m1/lado/all')).status).toBe(401)
  })

  it('filtro invalido: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).get('/api/matches/m1/lado/xyz').set('Cookie', cookie)
    expect(res.status).toBe(400)
  })

  it('partida nao encontrada no grupo: 404', async () => {
    const { app } = appWith([['from matches where id', []]])
    const res = await request(app).get('/api/matches/m1/lado/all').set('Cookie', cookie)
    expect(res.status).toBe(404)
  })

  it('recalcula kills/mortes/rating por jogador a partir dos rounds e devolve nick/avatar', async () => {
    const { app } = appWith([
      ['from matches where id', [{ id: 'm1' }]],
      ['from match_players mp', [
        { steam_id64: 'A1', nick: 'fih', team: 'A', avatar_url: null },
        { steam_id64: 'B1', nick: 'adversario', team: 'B', avatar_url: null },
      ]],
      ['from rounds where match_id', [
        { round_number: 1, side_a: 'CT' },
        { round_number: 2, side_a: 'CT' },
      ]],
      ['from kill_positions where match_id', [
        { round_number: 1, tick: 100, killer: 'A1', victim: 'B1', assister: null, headshot: true },
      ]],
      ['from match_player_round_damage', [
        { round_number: 1, steam_id64: 'A1', damage: 100 },
      ]],
    ])
    const res = await request(app).get('/api/matches/m1/lado/all').set('Cookie', cookie)
    expect(res.status).toBe(200)
    const fih = res.body.find((p) => p.steamId === 'A1')
    expect(fih).toMatchObject({ nick: 'fih', team: 'A', kills: 1, deaths: 0, roundsPlayed: 2, damage: 100, adr: 50 })
  })
})

describe('POST /api/matches/:id/highlight/:highlightId/allstar-clip', () => {
  const configComAllstar = { ...config, allstarApiKey: 'api-key', allstarSteamIds: new Set(['765']) }

  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).post('/api/matches/m1/highlight/h1/allstar-clip')).status).toBe(401)
  })

  it('sem allstarApiKey configurado: 503', async () => {
    const { app } = appWith([], { config: { ...config, allstarApiKey: null }, r2Client: {} })
    const res = await request(app).post('/api/matches/m1/highlight/h1/allstar-clip').set('Cookie', cookie)
    expect(res.status).toBe(503)
  })

  it('sem r2Client: 503', async () => {
    const { app } = appWith([], { config: configComAllstar, r2Client: null })
    const res = await request(app).post('/api/matches/m1/highlight/h1/allstar-clip').set('Cookie', cookie)
    expect(res.status).toBe(503)
  })

  it('highlight nao encontrado: 404', async () => {
    const { app } = appWith([['from highlights h', []]], { config: configComAllstar, r2Client: {} })
    const res = await request(app).post('/api/matches/m1/highlight/h1/allstar-clip').set('Cookie', cookie)
    expect(res.status).toBe(404)
  })

  it('jogador fora da allowlist: 403', async () => {
    const { app } = appWith(
      [['from highlights h', [{ id: 'h1', kind: 'ace', steam_id64: '999', round_number: 1, nick: 'outro', demo_url: 'https://r2/demos/x.dem.bz2' }]]],
      { config: configComAllstar, r2Client: {} },
    )
    const res = await request(app).post('/api/matches/m1/highlight/h1/allstar-clip').set('Cookie', cookie)
    expect(res.status).toBe(403)
  })

  it('ja tem clipe pedido: devolve o status existente sem pedir de novo', async () => {
    const { app } = appWith(
      [
        ['from highlights h', [{ id: 'h1', kind: 'ace', steam_id64: '765', round_number: 1, nick: 'bronze', demo_url: 'https://r2/demos/x.dem.bz2' }]],
        ['from allstar_clips where highlight_id', [{ status: 'Processed', clip_url: 'https://allstar.gg/iframe?clip=x' }]],
      ],
      { config: configComAllstar, r2Client: {} },
    )
    const res = await request(app).post('/api/matches/m1/highlight/h1/allstar-clip').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'Processed' })
  })

  it('pedido anterior com Error: permite tentar de novo (substitui a linha falhada)', async () => {
    const deletados = []
    const gravados = []
    const db = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (sql.includes('from highlights h')) {
          return Promise.resolve({ rows: [{ id: 'h1', kind: 'ace', steam_id64: '765', round_number: 3, nick: 'bronze', demo_url: 'https://acc.r2.cloudflarestorage.com/resenha-demos/demos/x.dem.bz2' }] })
        }
        // O delete também contém "from allstar_clips where highlight_id" — checar antes do select.
        if (sql.includes('delete from allstar_clips')) { deletados.push(params); return Promise.resolve({ rows: [] }) }
        if (sql.includes('from allstar_clips where highlight_id')) return Promise.resolve({ rows: [{ status: 'Error', clip_url: null }] })
        if (sql.includes('insert into allstar_clips')) { gravados.push(params); return Promise.resolve({ rows: [] }) }
        return Promise.resolve({ rows: [] })
      }),
    }
    const app = createApp({ config: configComAllstar, db, r2Client: {} })
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ requestId: 'req-2' }) })
    try {
      const res = await request(app).post('/api/matches/m1/highlight/h1/allstar-clip').set('Cookie', cookie)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ status: 'Submitted' })
      expect(deletados).toEqual([['h1']])
      expect(gravados).toEqual([['h1', 'req-2']])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('pede o clipe, salva o request_id e devolve Submitted', async () => {
    const gravados = []
    const db = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (sql.includes('from highlights h')) {
          return Promise.resolve({ rows: [{ id: 'h1', kind: 'ace', steam_id64: '765', round_number: 14, nick: 'bronze', demo_url: 'https://acc.r2.cloudflarestorage.com/resenha-demos/demos/x.dem.bz2' }] })
        }
        if (sql.includes('from allstar_clips where highlight_id')) return Promise.resolve({ rows: [] })
        if (sql.includes('insert into allstar_clips')) { gravados.push(params); return Promise.resolve({ rows: [] }) }
        return Promise.resolve({ rows: [] })
      }),
    }
    const app = createApp({ config: configComAllstar, db, r2Client: {} })
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ requestId: 'req-1' }) })
    try {
      const res = await request(app).post('/api/matches/m1/highlight/h1/allstar-clip').set('Cookie', cookie)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ status: 'Submitted' })
      expect(gravados).toEqual([['h1', 'req-1']])
      expect(presignDownload).toHaveBeenCalledWith({}, 'resenha-demos', 'demos/x.dem.bz2', 86400)
      const [, opts] = globalThis.fetch.mock.calls[0]
      expect(JSON.parse(opts.body).rounds).toEqual([14])
    } finally {
      globalThis.fetch = originalFetch
    }
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

describe('GET /api/matches/:id/replay/round/:n', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/matches/m1/replay/round/1')).status).toBe(401)
  })

  it('n não numérico: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).get('/api/matches/m1/replay/round/abc').set('Cookie', cookie)
    expect(res.status).toBe(400)
  })

  it('busca a chave do round trocando .json pelo prefixo /round-N.json do índice', async () => {
    const fakeR2 = {
      send: vi.fn().mockResolvedValue({ ContentType: 'application/json', Body: Readable.from([Buffer.from('{"round":2}')]) }),
    }
    const { app } = appWith(
      [['select replay_url', [{ replay_url: 'https://acc.r2.cloudflarestorage.com/resenha-demos/replays/701c.json' }]]],
      { r2Client: fakeR2 },
    )
    const res = await request(app).get('/api/matches/701c/replay/round/2').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.text).toBe('{"round":2}')
    const cmd = fakeR2.send.mock.calls[0][0]
    expect(cmd.input).toMatchObject({ Bucket: 'resenha-demos', Key: 'replays/701c/round-2.json' })
  })

  it('partida sem replay: 404', async () => {
    const fakeR2 = { send: vi.fn() }
    const { app } = appWith([['select replay_url', [{ replay_url: null }]]], { r2Client: fakeR2 })
    const res = await request(app).get('/api/matches/m1/replay/round/1').set('Cookie', cookie)
    expect(res.status).toBe(404)
    expect(fakeR2.send).not.toHaveBeenCalled()
  })
})

describe('GET /api/matches/:id/jogador/:steamId/detalhe', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/matches/m1/jogador/765/detalhe')).status).toBe(401)
  })

  it('partida nao encontrada no grupo: 404', async () => {
    const { app } = appWith([['from matches where id', []]])
    const res = await request(app).get('/api/matches/m1/jogador/765/detalhe').set('Cookie', cookie)
    expect(res.status).toBe(404)
  })

  it('monta o detalhe por round combinando kills, economia e compras', async () => {
    const { app } = appWith([
      ['from matches where id', [{ id: 'm1' }]],
      ['from kill_positions', [
        { round_number: 1, tick: 100, killer: '765', victim: '999', weapon: 'deagle', victim_weapon: null, headshot: true },
        { round_number: 2, tick: 200, killer: '999', victim: '765', weapon: 'ak47', victim_weapon: 'usp_silencer', headshot: false },
      ]],
      ['from match_player_round_econ', [
        { round_number: 1, equip_value: 4000, buy_type: 'eco' },
        { round_number: 2, equip_value: 200, buy_type: 'eco' },
      ]],
      ['from match_player_purchases', [
        { round_number: 1, item: 'deagle', cost: 700, tick: 50 },
      ]],
    ])
    const res = await request(app).get('/api/matches/m1/jogador/765/detalhe').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.rounds).toEqual([
      { roundNumber: 1, matou: [{ weapon: 'deagle', headshot: true, tick: 100 }], morreu: null, equipValue: 4000, buyType: 'eco', compras: [{ item: 'deagle', cost: 700 }] },
      { roundNumber: 2, matou: [], morreu: { weapon: 'ak47', victimWeapon: 'usp_silencer', headshot: false, tick: 200 }, equipValue: 200, buyType: 'eco', compras: [] },
    ])
  })
})

describe('GET /api/matches/:id/head-to-head/:steamId', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/matches/m1/head-to-head/765')).status).toBe(401)
  })

  it('jogador nao encontrado nessa partida do grupo: 404', async () => {
    const { app } = appWith([['from matches m join match_players mp', []]])
    const res = await request(app).get('/api/matches/m1/head-to-head/765').set('Cookie', cookie)
    expect(res.status).toBe(404)
  })

  it('compara o jogador contra todos os adversarios do time contrario numa chamada so', async () => {
    const { app } = appWith([
      ['from matches m join match_players mp', [{ team: 'A' }]],
      ['from match_players mp\n       left join players p', [
        { steam_id64: '999', nick: 'adversario', team: 'B', avatar_url: null },
      ]],
      ['from kill_positions', [
        { killer: '765', victim: '999', weapon: 'deagle' },
        { killer: '999', victim: '765', weapon: 'ak47' },
      ]],
      ['from match_player_damage', [
        { attacker: '765', victim: '999', damage: 100 },
        { attacker: '999', victim: '765', damage: 40 },
      ]],
      ['from match_player_flashes', [
        { attacker: '765', victim: '999', count: 1, duration_sum: '1.50' },
      ]],
    ])
    const res = await request(app).get('/api/matches/m1/head-to-head/765').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      steamId: '765',
      oponentes: [{
        steamId: '999', nick: 'adversario', avatarUrl: null, team: 'B',
        kills: 1, deaths: 1,
        killsPorCategoria: { Pistolas: 1 }, killsPorCategoriaRecebido: { Rifles: 1 },
        dano: 100, danoRecebido: 40,
        flashes: { porMim: { vezes: 1, duracao: 1.5 }, porEle: { vezes: 0, duracao: 0 } },
      }],
    })
  })

  it('sem adversario do outro time: retorna lista vazia', async () => {
    const { app } = appWith([
      ['from matches m join match_players mp', [{ team: 'A' }]],
      ['from match_players mp\n       left join players p', []],
    ])
    const res = await request(app).get('/api/matches/m1/head-to-head/765').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ steamId: '765', oponentes: [] })
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
