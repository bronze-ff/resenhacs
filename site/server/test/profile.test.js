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
      // Precisa vir ANTES de 'count(*)::int as partidas' — o texto dessa query também
      // contém aquele trecho, e o mock casa pelo primeiro needle que bater.
      ['group by mp.steam_id64', [
        { steam_id64: '765', partidas: 10, entry_kills: 30, entry_deaths: 5, utility_damage: 200, rounds: 200, clutch_wins: 2, clutch_attempts: 3, shots_fired: 300, shots_hit: 90 },
        { steam_id64: '999', partidas: 10, entry_kills: 2, entry_deaths: 2, utility_damage: 50, rounds: 200, clutch_wins: 0, clutch_attempts: 1, shots_fired: 300, shots_hit: 60 },
      ]],
      ['count(*)::int as partidas', [{ partidas: 10, vitorias: 6, kills: 200, deaths: 150, assists: 40, hs: 100, damage: 3300, rounds: 220, rating: '1.15' }]],
      ['group by m.map', [{ map: 'de_mirage', partidas: 5, vitorias: 3, rating: '1.2' }]],
      ['m.score_a, m.score_b', [{ id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9, kills: 20, deaths: 15, rating: '1.1', won: true }]],
      ['from synergy_pairs', [{ steam_id64: '999', nick: 'parça', avatar_url: null, partidas: 8, vitorias: 6 }]],
      ['mp.rating is not null', [{ id: 'm1', played_at: null, rating: '1.1' }, { id: 'm2', played_at: null, rating: '1.4' }]],
      ['mp.won from match_players', [{ won: true }, { won: true }, { won: false }, { won: true }]],
    ])
    const res = await request(app).get('/api/profile/765').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.jogador).toMatchObject({ nick: 'fih' })
    expect(res.body.stats).toMatchObject({ partidas: 10, vitorias: 6, winrate: 60, kills: 200 })
    expect(res.body.stats.kd).toBeCloseTo(1.33, 2)
    expect(res.body.stats.hsPct).toBe(50)
    expect(res.body.stats.adr).toBe(15) // 3300/220
    expect(res.body.sinergia[0]).toMatchObject({ nick: 'parça', partidas: 8, vitorias: 6, winrate: 75 })
    // fixture simula "order by played_at desc" (m1 é o mais recente); evolucaoRating inverte pra cronológico
    expect(res.body.evolucao).toEqual([{ matchId: 'm2', playedAt: null, rating: 1.4 }, { matchId: 'm1', playedAt: null, rating: 1.1 }])
    // classificação exata (qual dimensão vence) já é coberta em analise.test.js;
    // aqui só confere que o endpoint calcula e devolve alguma coisa.
    expect(res.body.estilo).not.toBeNull()
    // melhor sequência do fixture [true,true,false,true] = 2
    expect(res.body.badges.map((b) => b.tag)).not.toContain('sequencia_5')
  })
})

describe('GET /api/profile/compare', () => {
  it('400 quando os dois steamId não são válidos ou são iguais', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/profile/compare?a=1&b=2').set('Cookie', cookie)).status).toBe(400)
    expect((await request(app).get('/api/profile/compare?a=76561198000000001&b=76561198000000001').set('Cookie', cookie)).status).toBe(400)
  })

  it('404 quando algum dos dois não é Jogador', async () => {
    const { app } = appWith([
      ['from players where steam_id64 in', [{ steam_id64: '76561198000000001', nick: 'fih', avatar_url: null }]],
    ])
    const res = await request(app)
      .get('/api/profile/compare?a=76561198000000001&b=76561198000000002')
      .set('Cookie', cookie)
    expect(res.status).toBe(404)
  })

  it('compara stats e monta o confronto direto (mesmo time / times opostos)', async () => {
    const a = '76561198000000001'
    const b = '76561198000000002'
    const { app } = appWith([
      ['from players where steam_id64 in', [
        { steam_id64: a, nick: 'fih', avatar_url: null },
        { steam_id64: b, nick: 'bronze', avatar_url: null },
      ]],
      ['count(*)::int as partidas', [{ partidas: 10, vitorias: 6, kills: 200, deaths: 150, assists: 40, hs: 100, damage: 3300, rounds: 220, rating: '1.15' }]],
      ['mp.rating is not null', []],
      ['join match_players mp_b', [
        { team_a: 'A', team_b: 'A', a_venceu: true },  // mesmo time, vitória
        { team_a: 'A', team_b: 'B', a_venceu: true },  // times opostos, a venceu
        { team_a: 'B', team_b: 'A', a_venceu: false }, // times opostos, b venceu
      ]],
    ])
    const res = await request(app).get(`/api/profile/compare?a=${a}&b=${b}`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.a).toMatchObject({ nick: 'fih', stats: { partidas: 10 } })
    expect(res.body.b).toMatchObject({ nick: 'bronze', stats: { partidas: 10 } })
    expect(res.body.confronto).toEqual({
      partidasJuntos: 3, mesmoTime: 1, mesmoTimeVitorias: 1, timesOpostos: 2, aVenceu: 1, bVenceu: 1,
    })
  })
})
