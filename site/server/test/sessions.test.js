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

describe('GET /api/sessions', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/sessions')).status).toBe(401)
  })

  it('agrupa partidas em sessões pelo gap de 3h e acha o destaque (maior rating médio)', async () => {
    const { app, db } = appWith([
      // needle precisa ser específico: a query de jogadores tem um subselect que
      // também contém "from matches where status" (mesmo texto), então esse needle
      // mais genérico casaria errado se viesse antes — ver aviso em profile.test.js.
      ['select id, map, played_at', [
        { id: 'm1', map: 'de_mirage', played_at: '2026-07-10T21:00:00Z', score_a: 13, score_b: 9 },
        { id: 'm2', map: 'de_dust2', played_at: '2026-07-10T22:00:00Z', score_a: 13, score_b: 11 },
        // gap de mais de 3h -> sessão nova
        { id: 'm3', map: 'de_inferno', played_at: '2026-07-11T08:00:00Z', score_a: 6, score_b: 13 },
      ]],
      ['join players p on p.steam_id64 = mp.steam_id64', [
        { match_id: 'm1', steam_id64: 's1', nick: 'fih', kills: 20, deaths: 10, assists: 3, rating: '1.50', won: true, clutch_wins: 1, entry_kills: 4 },
        { match_id: 'm1', steam_id64: 's2', nick: 'bronze', kills: 10, deaths: 15, assists: 2, rating: '0.80', won: true, clutch_wins: 0, entry_kills: 1 },
        { match_id: 'm2', steam_id64: 's1', nick: 'fih', kills: 15, deaths: 12, assists: 4, rating: '1.10', won: true, clutch_wins: 0, entry_kills: 2 },
        { match_id: 'm3', steam_id64: 's1', nick: 'fih', kills: 5, deaths: 18, assists: 1, rating: '0.40', won: false, clutch_wins: 0, entry_kills: 0 },
      ]],
      ['h.kind = \'ace\'', [{ match_id: 'm1', steam_id64: 's1', aces: 1 }]],
    ])
    const res = await request(app).get('/api/sessions').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    // mais recente primeiro
    expect(res.body[0].matchIds).toEqual(['m3'])
    expect(res.body[0].vitorias).toBe(0)
    expect(res.body[0].derrotas).toBe(1)

    const primeiraSessao = res.body[1]
    expect(primeiraSessao.matchIds).toEqual(['m1', 'm2'])
    expect(primeiraSessao.vitorias).toBe(2)
    expect(primeiraSessao.destaque.nick).toBe('fih')
    expect(primeiraSessao.destaque.ratingMedio).toBeCloseTo(1.3, 2) // média de 1.50 e 1.10
    expect(primeiraSessao.destaque.aces).toBe(1)

    // Visibilidade por amizade (friendships.js), não mais group_id: as três queries
    // (matches, match_players e highlights/aces) escopam pelo viewer via partidaVisivelExpr.
    const [matchesSql, matchesParams] = db.query.mock.calls.find(([s]) => s.includes('select id, map, played_at'))
    expect(matchesSql).toContain('from friendships f')
    expect(matchesSql).not.toContain('group_id')
    expect(matchesParams).toEqual(['76561198000000009'])
    const [playersSql, playersParams] = db.query.mock.calls.find(([s]) => s.includes('join players p on p.steam_id64 = mp.steam_id64'))
    expect(playersSql).toContain('from friendships f')
    expect(playersSql).not.toContain('group_id')
    expect(playersParams).toEqual(['76561198000000009'])
    const [acesSql, acesParams] = db.query.mock.calls.find(([s]) => s.includes("h.kind = 'ace'"))
    expect(acesSql).toContain('from friendships f')
    expect(acesSql).not.toContain('group_id')
    expect(acesParams).toEqual(['76561198000000009'])

    // Finding S6: sem LIMIT essas três queries varriam TODO o histórico de partidas
    // visíveis a cada request (DoS barato). As três precisam do MESMO recorte de
    // partidas (senão jogador/ace de uma partida "sobra" sem a partida correspondente).
    for (const sql of [matchesSql, playersSql, acesSql]) {
      expect(sql).toContain('limit 750')
      expect(sql).toContain('order by played_at desc nulls last, id desc')
    }
  })
})
