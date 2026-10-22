import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { partidaVisivelExpr } from '../src/friendships.js'

const config = { jwtSecret: 'teste', appUrl: 'http://localhost:5173', isProduction: false }
const viewer = '76561198000000001'
const steamId = '76561198000000002'
const colega = '76561198000000003'
const inimigo = '76561198000000004'
const id = '11111111-2222-4333-8444-555555555555'
const cookie = `resenha_token=${signToken({ steamId: viewer }, config.jwtSecret)}`
const url = `/api/matches/${id}/licoes/${steamId}`
const jogadores = [
  { steam_id64: steamId, team: 'A' }, { steam_id64: colega, team: 'A' }, { steam_id64: inimigo, team: 'B' },
]

function preparar({ visivel = true, players = jogadores, kills = [], flashes = [] } = {}) {
  const db = { query: vi.fn(async (sql) => {
    if (sql.includes('tokens_validos_apos')) return { rows: [] }
    if (sql.includes('from matches m')) return { rows: visivel ? [{ id }] : [] }
    if (sql.includes('from match_players')) return { rows: players }
    if (sql.includes('from kill_positions')) return { rows: kills }
    if (sql.includes('from match_player_flashes')) return { rows: flashes }
    throw new Error('Consulta inesperada no teste')
  }) }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/matches/:id/licoes/:steamId', () => {
  it('exige autenticação antes de consultar a Partida', async () => {
    const { app, db } = preparar()
    const res = await request(app).get(url)
    expect(res.status).toBe(401)
    expect(db.query).not.toHaveBeenCalled()
  })

  it.each(['abc', '123', '765611980000000000', "1' OR 1=1--"])('recusa Jogador inválido: %s', async (valor) => {
    const { app, db } = preparar()
    const res = await request(app).get(`/api/matches/${id}/licoes/${encodeURIComponent(valor)}`).set('Cookie', cookie)
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ erro: 'Jogador inválido' })
    expect(db.query.mock.calls.every(([sql]) => sql.includes('tokens_validos_apos'))).toBe(true)
  })

  it('Partida fora da visibilidade dá 404 sem consultar dados das Lições', async () => {
    const { app, db } = preparar({ visivel: false })
    const res = await request(app).get(url).set('Cookie', cookie)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ erro: 'Partida não encontrada' })
    const consultas = db.query.mock.calls.filter(([sql]) => !sql.includes('tokens_validos_apos'))
    expect(consultas).toHaveLength(1)
    expect(consultas[0][0]).toContain(partidaVisivelExpr('m', '$2'))
    expect(consultas[0][1]).toEqual([id, viewer])
  })

  it('participante ausente dá o outro 404 e não consulta kills nem flashes', async () => {
    const { app, db } = preparar({ players: [{ steam_id64: colega, team: 'A' }] })
    const res = await request(app).get(url).set('Cookie', cookie)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ erro: 'Partida ou jogador não encontrado' })
    expect(db.query.mock.calls.some(([sql]) => sql.includes('from kill_positions') || sql.includes('from match_player_flashes'))).toBe(false)
  })

  it('um participante diferente do viewer recebe as Lições calculadas, com SQL parametrizado', async () => {
    const { app, db } = preparar({
      kills: [
        { round_number: 3, tick: 200, killer: inimigo, victim: steamId, is_team_kill: false },
        { round_number: 1, tick: 10, killer: inimigo, victim: steamId, is_team_kill: false },
        { round_number: 1, tick: 330, killer: colega, victim: inimigo, is_team_kill: false },
        { round_number: 2, tick: 5, killer: colega, victim: steamId, is_team_kill: true },
        { round_number: 4, tick: 5, killer: null, victim: steamId, is_team_kill: false },
      ],
      flashes: [
        { attacker: steamId, victim: colega, count: 2, duration_sum: '1.26' },
        { attacker: steamId, victim: inimigo, count: 7, duration_sum: '6' },
      ],
    })
    const res = await request(app).get(url).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      mortesSemTrade: { quantidade: 1, rounds: [{ round: 3, tick: 200 }] },
      primeirasMortes: { quantidade: 2, rounds: [{ round: 1, tick: 10 }, { round: 3, tick: 200 }] },
      flashAliado: { vezes: 2, segundos: 1.3 },
    })
    for (const [sql, params] of db.query.mock.calls) {
      expect(sql).not.toContain(id)
      expect(sql).not.toContain(steamId)
      expect(sql).not.toContain(viewer)
      const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))
      expect([...new Set(placeholders)].sort()).toEqual(params.map((_, i) => i + 1))
    }
    const visibilidade = db.query.mock.calls.find(([sql]) => sql.includes('from matches m'))
    expect(visibilidade[0]).toContain(partidaVisivelExpr('m', '$2'))
    expect(visibilidade[1]).toEqual([id, viewer])
    expect(db.query.mock.calls.find(([sql]) => sql.includes('from kill_positions'))[1]).toEqual([id])
    expect(db.query.mock.calls.find(([sql]) => sql.includes('from match_player_flashes'))[1]).toEqual([id, steamId])
  })

  it('tudo zero é uma resposta 200 válida', async () => {
    const { app } = preparar()
    const res = await request(app).get(url).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      mortesSemTrade: { quantidade: 0, rounds: [] },
      primeirasMortes: { quantidade: 0, rounds: [] },
      flashAliado: { vezes: 0, segundos: 0 },
    })
  })
})
