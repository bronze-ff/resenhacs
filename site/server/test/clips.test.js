import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '76561198000000009', isSuperAdmin: false }, config.jwtSecret)}`

function appWith() {
  const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'c1' }] }) }
  return { app: createApp({ config, db }), db }
}

describe('POST /api/clips', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/clips').send({ matchId: 'm1', url: 'https://allstar.gg/x', steamId: '76561198000000009' })
    expect(res.status).toBe(401)
  })

  it('URL inválida: 400', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/clips').set('Cookie', cookie).send({ matchId: 'm1', url: 'nada', steamId: '76561198000000009' })
    expect(res.status).toBe(400)
  })

  it('steamId inválido: 400', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/clips').set('Cookie', cookie).send({ matchId: 'm1', url: 'https://allstar.gg/x', steamId: 'abc' })
    expect(res.status).toBe(400)
  })

  it('anexa clipe e detecta o provider', async () => {
    const { app, db } = appWith()
    const res = await request(app).post('/api/clips').set('Cookie', cookie).send({
      matchId: 'm1', url: 'https://allstar.gg/clip/1', steamId: '76561198000000009', title: 'ace',
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: 'c1', provider: 'allstar' })
    // added_by = jogador logado
    expect(db.query.mock.calls[0][1][6]).toBe('76561198000000009')
  })
})
