import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const EU = '76561198000000009'
const cookie = `resenha_token=${signToken({ steamId: EU, isSuperAdmin: false }, config.jwtSecret)}`

describe('GET /api/primeiros-passos', () => {
  it('sem login: 401', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    expect((await request(createApp({ config, db })).get('/api/primeiros-passos')).status).toBe(401)
  })

  it('devolve o estado do próprio viewer', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql) => Promise.resolve({
        rows: sql.includes('codigo_historico') ? [{ codigo_historico: true, faceit: false, amigos: 3, partidas: 12 }] : [],
      })),
    }
    const res = await request(createApp({ config, db })).get('/api/primeiros-passos').set('Cookie', cookie)
    expect(res.body).toEqual({ codigoHistorico: true, faceit: false, amigos: 3, partidas: 12 })
    const [, params] = db.query.mock.calls.find(([s]) => s.includes('codigo_historico'))
    expect(params).toEqual([EU])
  })
})
