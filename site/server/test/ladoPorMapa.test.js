import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '76561198000000009', isSuperAdmin: false }, config.jwtSecret)}`
const GRUPO = '11111111-1111-1111-1111-111111111111'

function appWith(rows) {
  const db = { query: vi.fn().mockImplementation((sql) => {
    if (sql.includes('group_members where group_id')) return Promise.resolve({ rows: [{}] })
    return Promise.resolve({ rows })
  }) }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/lado-mapa', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/lado-mapa')).status).toBe(401)
  })

  it('devolve rounds/vitorias/winrate por mapa e lado', async () => {
    const { app } = appWith([
      { map: 'de_mirage', lado: 'CT', rounds: 10, vitorias: 7 },
      { map: 'de_mirage', lado: 'T', rounds: 12, vitorias: 3 },
    ])
    const res = await request(app).get('/api/lado-mapa').set('Cookie', cookie).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { map: 'de_mirage', lado: 'CT', rounds: 10, vitorias: 7, winrate: 70 },
      { map: 'de_mirage', lado: 'T', rounds: 12, vitorias: 3, winrate: 25 },
    ])
  })

  it('sem dado nenhum: lista vazia', async () => {
    const { app } = appWith([])
    const res = await request(app).get('/api/lado-mapa').set('Cookie', cookie).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})
