import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { recordesPessoais } from '../src/recordesPessoais.js'

function partida(i, campos = {}) {
  return {
    match_id: `m${i}`, map: 'de_mirage', played_at: `2026-10-${String(i).padStart(2, '0')}T21:00:00Z`,
    kills: 15, damage: 1600, rounds_played: 20, rating: '1.00', utility_damage: 100, ...campos,
  }
}

describe('recordesPessoais', () => {
  it('acha o recorde que superou todas as partidas anteriores', () => {
    const linhas = [...Array.from({ length: 10 }, (_, i) => partida(i + 1)), partida(11, { kills: 30 })]
    const r = recordesPessoais(linhas, { desde: '2026-10-11T00:00:00Z' })
    expect(r).toEqual([
      expect.objectContaining({ metrica: 'kills', valor: 30, anterior: 15, matchId: 'm11', map: 'de_mirage' }),
    ])
  })

  it('não conta recorde antes do mínimo de partidas anteriores', () => {
    const linhas = [partida(1), partida(2, { kills: 40 })]
    expect(recordesPessoais(linhas, { desde: '2026-01-01T00:00:00Z' })).toEqual([])
  })

  it('ignora recorde antigo (antes de `desde`) e empate com a melhor marca', () => {
    const linhas = [...Array.from({ length: 10 }, (_, i) => partida(i + 1)), partida(11, { kills: 30 }), partida(12, { kills: 30 })]
    expect(recordesPessoais(linhas, { desde: '2026-10-12T00:00:00Z' })).toEqual([])
  })

  it('ADR e rating viram número; partida sem round não conta pra ADR', () => {
    const linhas = [...Array.from({ length: 10 }, (_, i) => partida(i + 1)), partida(11, { damage: 2400, rating: '1.55', rounds_played: 20 }), partida(12, { rounds_played: 0, damage: 9999 })]
    const r = recordesPessoais(linhas, { desde: '2026-10-01T00:00:00Z' })
    expect(r.find((x) => x.metrica === 'adr')).toMatchObject({ valor: 120, anterior: 80 })
    expect(r.find((x) => x.metrica === 'rating')).toMatchObject({ valor: 1.55, anterior: 1 })
  })
})

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '76561198000000009', isSuperAdmin: false }, config.jwtSecret)}`

describe('GET /api/recordes/pessoais', () => {
  it('sem login: 401', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const res = await request(createApp({ config, db })).get('/api/recordes/pessoais')
    expect(res.status).toBe(401)
  })

  it('consulta só as partidas do próprio viewer', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const res = await request(createApp({ config, db })).get('/api/recordes/pessoais').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes('mp.utility_damage'))
    expect(sql).toContain('mp.steam_id64 = $1')
    expect(params).toEqual(['76561198000000009'])
  })
})
