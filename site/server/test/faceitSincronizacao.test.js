import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const EU = '76561198000000009'
const cookie = `resenha_token=${signToken({ steamId: EU, isSuperAdmin: false }, config.jwtSecret)}`

function appWith(rows) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      if (sql.includes('tokens_validos_apos')) return Promise.resolve({ rows: [{ tokens_validos_apos: null }] })
      return Promise.resolve({ rows })
    }),
  }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/faceit-sincronizacao', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/faceit-sincronizacao')).status).toBe(401)
  })

  it('devolve só o status do próprio Jogador, sem o id FACEIT', async () => {
    const { app, db } = appWith([{
      vinculada: true, faceit_sincronizado_em: new Date('2026-10-16T12:00:00Z'), importadas: 42, sem_demo: 40,
    }])
    const res = await request(app).get('/api/faceit-sincronizacao').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      vinculada: true,
      ultimaSincronizacao: '2026-10-16T12:00:00.000Z',
      partidasImportadas: 42,
      partidasSemDemo: 40,
    })
    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes('faceit_sincronizado_em'))
    expect(params).toEqual([EU])
    expect(sql).toContain('p.steam_id64 = $1')
    expect(sql).toContain('m.faceit_match_id is not null')
    expect(JSON.stringify(res.body)).not.toContain('faceit_id')
  })

  it('nunca sincronizado: ultimaSincronizacao null', async () => {
    const { app } = appWith([{ vinculada: false, faceit_sincronizado_em: null, importadas: 0, sem_demo: 0 }])
    const res = await request(app).get('/api/faceit-sincronizacao').set('Cookie', cookie)
    expect(res.body.ultimaSincronizacao).toBeNull()
    expect(res.body.partidasImportadas).toBe(0)
  })

  it('jogador inexistente: 404', async () => {
    const { app } = appWith([])
    const res = await request(app).get('/api/faceit-sincronizacao').set('Cookie', cookie)
    expect(res.status).toBe(404)
  })
})
