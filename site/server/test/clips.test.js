import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '76561198000000009', isSuperAdmin: false }, config.jwtSecret)}`
const GRUPO = '11111111-1111-1111-1111-111111111111'
// matchId agora é validado como UUID e checado contra o grupo antes do insert.
const MATCH = '22222222-2222-2222-2222-222222222222'

function appWith() {
  // Toda query devolve uma linha: cobre a checagem de participação no grupo
  // (requireGroupMember), a checagem de posse da partida e o próprio insert.
  const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'c1' }] }) }
  return { app: createApp({ config, db }), db }
}

describe('POST /api/clips', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/clips').send({ matchId: MATCH, url: 'https://allstar.gg/x', steamId: '76561198000000009' })
    expect(res.status).toBe(401)
  })

  it('matchId não-UUID: 400', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/clips').set('Cookie', cookie).set('X-Group-Id', GRUPO)
      .send({ matchId: 'm1', url: 'https://allstar.gg/x', steamId: '76561198000000009' })
    expect(res.status).toBe(400)
  })

  it('URL inválida: 400', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/clips').set('Cookie', cookie).set('X-Group-Id', GRUPO)
      .send({ matchId: MATCH, url: 'nada', steamId: '76561198000000009' })
    expect(res.status).toBe(400)
  })

  it('steamId inválido: 400', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/clips').set('Cookie', cookie).set('X-Group-Id', GRUPO)
      .send({ matchId: MATCH, url: 'https://allstar.gg/x', steamId: 'abc' })
    expect(res.status).toBe(400)
  })

  it('partida de outro grupo (posse não confere): 404', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('group_members where group_id')) return Promise.resolve({ rows: [{}] })
        if (sql.includes('from matches where id')) return Promise.resolve({ rows: [] }) // não pertence ao grupo
        return Promise.resolve({ rows: [{ id: 'c1' }] })
      }),
    }
    const app = createApp({ config, db })
    const res = await request(app).post('/api/clips').set('Cookie', cookie).set('X-Group-Id', GRUPO)
      .send({ matchId: MATCH, url: 'https://allstar.gg/x', steamId: '76561198000000009' })
    expect(res.status).toBe(404)
  })

  it('anexa clipe e detecta o provider', async () => {
    const { app, db } = appWith()
    const res = await request(app).post('/api/clips').set('Cookie', cookie).set('X-Group-Id', GRUPO).send({
      matchId: MATCH, url: 'https://allstar.gg/clip/1', steamId: '76561198000000009', title: 'ace',
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: 'c1', provider: 'allstar' })
    // added_by = jogador logado (7º param do insert)
    const insert = db.query.mock.calls.find((c) => c[0].includes('insert into clips'))
    expect(insert[1][6]).toBe('76561198000000009')
  })
})
