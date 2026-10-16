import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const VIEWER = '76561198000000009'
const ALVO = '76561198000000001'
const INIMIGO = '76561198000000002'
const MATCH = '11111111-1111-1111-1111-111111111111'
const cookie = `resenha_token=${signToken({ steamId: VIEWER, isSuperAdmin: false }, config.jwtSecret)}`

// db mockado roteando por trecho de SQL.
function appCom(respostas) {
  const db = {
    query: vi.fn(async (sql) => {
      for (const [trecho, rows] of respostas) if (sql.includes(trecho)) return { rows }
      return { rows: [] }
    }),
  }
  return { app: createApp({ config, db }), db }
}

const players = [
  { match_id: MATCH, steam_id64: ALVO, nick: 'alvo', team: 'A' },
  { match_id: MATCH, steam_id64: INIMIGO, nick: 'inimigo', team: 'B' },
]
const rounds = [{ match_id: MATCH, round_number: 1, side_a: 'CT' }]
const kills = [{ match_id: MATCH, round_number: 1, tick: 100, killer: ALVO, victim: INIMIGO }]

describe('GET /api/profile/:steamId/duelos', () => {
  it('sem login: 401', async () => {
    const { app } = appCom([])
    expect((await request(app).get(`/api/profile/${ALVO}/duelos`)).status).toBe(401)
  })

  it('steamId inválido: 400', async () => {
    const { app } = appCom([])
    expect((await request(app).get('/api/profile/abc/duelos').set('Cookie', cookie)).status).toBe(400)
  })

  it('agrega as últimas partidas visíveis e filtra team-kill no SQL', async () => {
    const { app, db } = appCom([
      ['order by m.played_at desc', [{ id: MATCH }]],
      ['from match_players where match_id', players],
      ['from rounds where', rounds],
      ['from kill_positions', kills],
    ])
    const res = await request(app).get(`/api/profile/${ALVO}/duelos`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.partidas).toBe(1)
    expect(res.body.aberturas).toBe(1)
    expect(res.body.aberturasPct).toBe(100)
    expect(res.body.porLado.CT.pct).toBe(100)
    const [sqlLista, paramsLista] = db.query.mock.calls.find(([s]) => s.includes('order by m.played_at desc'))
    expect(sqlLista).toContain('from friendships f')
    expect(sqlLista).toContain('limit 30')
    expect(paramsLista).toEqual([ALVO, VIEWER])
    const [sqlKills] = db.query.mock.calls.find(([s]) => s.includes('from kill_positions'))
    expect(sqlKills).toContain('coalesce(is_team_kill, false) = false')
  })

  it('sem partidas: zeros e porcentagens nulas', async () => {
    const { app } = appCom([])
    const res = await request(app).get(`/api/profile/${ALVO}/duelos`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ partidas: 0, aberturas: 0, aberturasPct: null, mortesTrocadasPct: null })
  })
})

describe('GET /api/matches/:id/duelos', () => {
  it('sem login: 401', async () => {
    const { app } = appCom([])
    expect((await request(app).get(`/api/matches/${MATCH}/duelos`)).status).toBe(401)
  })

  it('partida não visível: 404', async () => {
    const { app } = appCom([])
    expect((await request(app).get(`/api/matches/${MATCH}/duelos`).set('Cookie', cookie)).status).toBe(404)
  })

  it('id inválido: 404 sem consultar', async () => {
    const { app, db } = appCom([])
    expect((await request(app).get('/api/matches/abc/duelos').set('Cookie', cookie)).status).toBe(404)
    expect(db.query.mock.calls.some(([s]) => s.includes('duelos'))).toBe(false)
  })

  it('devolve duelos por Jogador', async () => {
    const { app, db } = appCom([
      ['select m.id from matches m', [{ id: MATCH }]],
      ['from match_players where match_id', players],
      ['from rounds where', rounds],
      ['from kill_positions', kills],
    ])
    const res = await request(app).get(`/api/matches/${MATCH}/duelos`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    const alvo = res.body.jogadores.find((j) => j.steamId === ALVO)
    const inimigo = res.body.jogadores.find((j) => j.steamId === INIMIGO)
    expect(alvo).toMatchObject({ nick: 'alvo', team: 'A', aberturasGanhas: 1, aberturasPct: 100 })
    expect(inimigo).toMatchObject({ mortes: 1, mortesSemTroca: 1, mortesTrocadasPct: 0 })
    const [, params] = db.query.mock.calls.find(([s]) => s.includes('select m.id from matches m'))
    expect(params).toEqual([MATCH, VIEWER])
  })
})
