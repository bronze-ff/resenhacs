import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = {
  jwtSecret: 'segredo-de-teste',
  appUrl: 'http://localhost:5173',
  isProduction: false,
}

function appWith(rows = []) {
  const db = { query: vi.fn().mockResolvedValue({ rows }) }
  return { app: createApp({ config, db }), db }
}

const adminCookie = `resenha_token=${signToken({ steamId: '76561198000000001', isAdmin: true }, config.jwtSecret)}`
const memberCookie = `resenha_token=${signToken({ steamId: '76561198000000002', isAdmin: false }, config.jwtSecret)}`

describe('GET /api/players', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    expect((await request(app).get('/api/players')).status).toBe(401)
  })

  it('logado: lista jogadores', async () => {
    const { app } = appWith([
      { steam_id64: '765', nick: 'fih', avatar_url: null, is_admin: true },
    ])
    const res = await request(app).get('/api/players').set('Cookie', memberCookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ steamId: '765', nick: 'fih', avatarUrl: null, isAdmin: true }])
  })
})

describe('POST /api/players', () => {
  it('membro comum: 403', async () => {
    const { app } = appWith()
    const res = await request(app)
      .post('/api/players')
      .set('Cookie', memberCookie)
      .send({ steamId: '76561198000000003' })
    expect(res.status).toBe(403)
  })

  it('admin com steamId inválido: 400', async () => {
    const { app } = appWith()
    const res = await request(app)
      .post('/api/players')
      .set('Cookie', adminCookie)
      .send({ steamId: 'abc' })
    expect(res.status).toBe(400)
  })

  it('admin: adiciona à whitelist', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/players')
      .set('Cookie', adminCookie)
      .send({ steamId: '76561198000000003' })
    expect(res.status).toBe(201)
    expect(db.query.mock.calls[0][1]).toEqual(['76561198000000003'])
  })
})

describe('PUT /api/players/me (onboarding)', () => {
  const shareCode = 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee'

  it('sem login: 401', async () => {
    const { app } = appWith()
    const res = await request(app)
      .put('/api/players/me')
      .send({ matchAuthCode: 'ABCD-12345-EFGH', lastShareCode: shareCode })
    expect(res.status).toBe(401)
  })

  it('share code em formato inválido: 400', async () => {
    const { app } = appWith()
    const res = await request(app)
      .put('/api/players/me')
      .set('Cookie', memberCookie)
      .send({ matchAuthCode: 'ABCD-12345-EFGH', lastShareCode: 'não-é-share-code' })
    expect(res.status).toBe(400)
  })

  it('grava os próprios códigos do jogador logado', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .put('/api/players/me')
      .set('Cookie', memberCookie)
      .send({ matchAuthCode: 'ABCD-12345-EFGH', lastShareCode: shareCode })
    expect(res.status).toBe(200)
    expect(db.query.mock.calls[0][1]).toEqual([
      '76561198000000002',
      'ABCD-12345-EFGH',
      shareCode,
    ])
  })
})
