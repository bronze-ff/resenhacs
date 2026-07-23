import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos' }
const cookie = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`

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

describe('GET /api/lineups', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/lineups')).status).toBe(401)
  })

  it('lista filtrada por mapa e tipo', async () => {
    const { app, db } = appWith([
      ['from lineups', [{
        id: 'l1', map: 'de_mirage', tipo: 'smoke',
        thrower_steam_id: '765', thrower_nick: 'bronze',
        thrower_x: 1, thrower_y: 2, thrower_yaw: 3, thrower_pitch: 4,
        target_x: 5, target_y: 6, origem: 'grupo',
      }]],
    ])
    const res = await request(app).get('/api/lineups?map=de_mirage&tipo=smoke').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ map: 'de_mirage', tipo: 'smoke', throwerNick: 'bronze', origem: 'grupo' })
    const chamada = db.query.mock.calls.find((c) => c[0].includes('from lineups'))
    const [sql, params] = chamada
    expect(sql).toContain('map = $')
    expect(sql).toContain('tipo = $')
    expect(sql).toContain('from friendships f') // escopado por visibilidade de amizade
    expect(params[0]).toBe('765') // viewer do cookie
  })

  it('mapa/tipo invalido: ignora o filtro em vez de quebrar', async () => {
    const { app } = appWith([['from lineups', []]])
    const res = await request(app).get('/api/lineups?tipo=algo-invalido').set('Cookie', cookie)
    expect(res.status).toBe(200)
  })
})
