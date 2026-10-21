import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '76561198000000009', isSuperAdmin: false }, config.jwtSecret)}`

function appWith(rows) {
  const db = { query: vi.fn().mockResolvedValue({ rows }) }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/lado-mapa', () => {
  it('considera só o círculo do viewer ao escolher o time, mesmo com adversário cadastrado', async () => {
    const { app, db } = appWith([{ map: 'de_mirage', lado: 'CT', rounds: 2, vitorias: 2 }])
    const res = await request(app).get('/api/lado-mapa').set('Cookie', cookie)
    expect(res.body[0]?.rounds).toBe(2)
    const [sql, params] = db.query.mock.calls.find(([q]) => q.includes('time_do_grupo'))
    expect(sql).not.toContain('is_tracked')
    expect(sql).toContain('fc.status = \'accepted\'')
    expect(sql).toContain('mp.steam_id64 = $1')
    expect(params).toEqual(['76561198000000009'])
  })
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/lado-mapa')).status).toBe(401)
  })

  it('devolve rounds/vitorias/winrate por mapa e lado', async () => {
    const { app, db } = appWith([
      { map: 'de_mirage', lado: 'CT', rounds: 10, vitorias: 7 },
      { map: 'de_mirage', lado: 'T', rounds: 12, vitorias: 3 },
    ])
    const res = await request(app).get('/api/lado-mapa').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { map: 'de_mirage', lado: 'CT', rounds: 10, vitorias: 7, winrate: 70 },
      { map: 'de_mirage', lado: 'T', rounds: 12, vitorias: 3, winrate: 25 },
    ])
    // Visibilidade por amizade (friendships.js), não mais group_id.
    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes('from friendships f'))
    expect(sql).toContain('from friendships f')
    expect(sql).not.toContain('group_id')
    expect(params).toEqual(['76561198000000009'])
  })

  it('sem dado nenhum: lista vazia', async () => {
    const { app } = appWith([])
    const res = await request(app).get('/api/lado-mapa').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})
