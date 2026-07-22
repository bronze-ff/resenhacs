import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '76561198000000009', isSuperAdmin: false }, config.jwtSecret)}`

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

describe('GET /api/recordes', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/recordes')).status).toBe(401)
  })

  it('acha mais kills, melhor ADR, maior sequência e mais clutches numa noite', async () => {
    const { app, db } = appWith([
      ['select id, map, played_at', [
        { id: 'm1', map: 'de_mirage', played_at: '2026-07-10T21:00:00Z' },
        { id: 'm2', map: 'de_dust2', played_at: '2026-07-10T22:00:00Z' },
        // gap de mais de 3h -> nova sessão, e derrota quebra a sequência de vitórias
        { id: 'm3', map: 'de_inferno', played_at: '2026-07-11T08:00:00Z' },
        { id: 'm4', map: 'de_nuke', played_at: '2026-07-11T09:00:00Z' },
      ]],
      ['join players p on p.steam_id64 = mp.steam_id64', [
        { match_id: 'm1', steam_id64: 's1', nick: 'fih', kills: 20, damage: 2000, rounds_played: 20, won: true, clutch_wins: 1, avatar_url: null },
        { match_id: 'm1', steam_id64: 's2', nick: 'bronze', kills: 30, damage: 1800, rounds_played: 20, won: true, clutch_wins: 0, avatar_url: null },
        { match_id: 'm2', steam_id64: 's1', nick: 'fih', kills: 15, damage: 1500, rounds_played: 24, won: true, clutch_wins: 2, avatar_url: null },
        { match_id: 'm3', steam_id64: 's1', nick: 'fih', kills: 5, damage: 500, rounds_played: 22, won: false, clutch_wins: 0, avatar_url: null },
        { match_id: 'm4', steam_id64: 's1', nick: 'fih', kills: 12, damage: 1200, rounds_played: 20, won: true, clutch_wins: 0, avatar_url: null },
      ]],
    ])
    const res = await request(app).get('/api/recordes').set('Cookie', cookie)
    expect(res.status).toBe(200)

    expect(res.body.maisKills).toMatchObject({ steamId: 's2', nick: 'bronze', kills: 30, matchId: 'm1' })
    expect(res.body.melhorAdr).toMatchObject({ steamId: 's1', nick: 'fih', adr: 100, matchId: 'm1' }) // 2000/20 > bronze's 1800/20=90

    // m1+m2 vitórias seguidas (sessão 1) = sequência de 2; m3 derrota zera; m4 vitória sozinha = 1.
    expect(res.body.maiorSequencia).toMatchObject({ vitorias: 2 })

    // Sessão 1 (m1+m2): fih tem 1+2=3 clutches, bronze tem 0. Sessão 2 (m3+m4): 0.
    expect(res.body.maisClutchesNaNoite).toMatchObject({ steamId: 's1', nick: 'fih', clutches: 3 })

    // Visibilidade por amizade (friendships.js), não mais group_id: as duas queries
    // (matches e o subselect de match_players) escopam pelo viewer via partidaVisivelExpr.
    const [matchesSql, matchesParams] = db.query.mock.calls.find(([s]) => s.includes('select id, map, played_at'))
    expect(matchesSql).toContain('from friendships f')
    expect(matchesSql).not.toContain('group_id')
    expect(matchesParams).toEqual(['76561198000000009'])
    const [playersSql, playersParams] = db.query.mock.calls.find(([s]) => s.includes('join players p on p.steam_id64 = mp.steam_id64'))
    expect(playersSql).toContain('from friendships f')
    expect(playersSql).not.toContain('group_id')
    expect(playersParams).toEqual(['76561198000000009'])

    // Finding S6: sem LIMIT essas duas queries varriam TODO o histórico de partidas
    // visíveis a cada request (DoS barato). As duas precisam do MESMO recorte de
    // partidas (senão jogador de uma partida "sobra" sem a partida correspondente).
    for (const sql of [matchesSql, playersSql]) {
      expect(sql).toContain('limit 750')
      expect(sql).toContain('order by played_at desc nulls last, id desc')
    }
  })

  it('grupo sem partidas: tudo null, sem quebrar', async () => {
    const { app } = appWith([
      ['select id, map, played_at', []],
    ])
    const res = await request(app).get('/api/recordes').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ maisKills: null, melhorAdr: null, maiorSequencia: null, maisClutchesNaNoite: null })
  })
})
