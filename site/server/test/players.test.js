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

const adminCookie = `resenha_token=${signToken({ steamId: '76561198000000001', isSuperAdmin: true }, config.jwtSecret)}`
const memberCookie = `resenha_token=${signToken({ steamId: '76561198000000002', isSuperAdmin: false }, config.jwtSecret)}`
const GRUPO = '11111111-1111-1111-1111-111111111111'

describe('GET /api/players', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    expect((await request(app).get('/api/players')).status).toBe(401)
  })

  it('logado: lista jogadores', async () => {
    const { app } = appWith([
      { steam_id64: '765', nick: 'fih', avatar_url: null, is_super_admin: true },
    ])
    const res = await request(app).get('/api/players').set('Cookie', memberCookie).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ steamId: '765', nick: 'fih', avatarUrl: null, isSuperAdmin: true }])
  })
})

describe('GET /api/players/bans', () => {
  it('sem fetchBans configurado (falta STEAM_API_KEY): 503', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const app = createApp({ config, db })
    const res = await request(app).get('/api/players/bans').set('Cookie', memberCookie)
    expect(res.status).toBe(503)
  })

  it('cruza os Jogadores com o resultado de fetchBans', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [{ steam_id64: '765', nick: 'fih' }, { steam_id64: '999', nick: 'limpo' }],
      }),
    }
    const fetchBans = vi.fn().mockResolvedValue([
      { steamId: '765', vacBanned: true, numVacBans: 1, daysSinceLastBan: 10, gameBanned: false, numGameBans: 0, communityBanned: false },
    ])
    const app = createApp({ config, db, fetchBans })
    const res = await request(app).get('/api/players/bans').set('Cookie', memberCookie)
    expect(res.status).toBe(200)
    expect(fetchBans).toHaveBeenCalledWith(['765', '999'])
    expect(res.body).toEqual([
      { steamId: '765', nick: 'fih', ban: { steamId: '765', vacBanned: true, numVacBans: 1, daysSinceLastBan: 10, gameBanned: false, numGameBans: 0, communityBanned: false } },
      { steamId: '999', nick: 'limpo', ban: null },
    ])
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

  it('admin: adiciona à whitelist e retroage is_tracked nas partidas antigas', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/players')
      .set('Cookie', adminCookie)
      .send({ steamId: '76561198000000003' })
    expect(res.status).toBe(201)
    expect(db.query.mock.calls[0][1]).toEqual(['76561198000000003'])
    expect(db.query.mock.calls[1][0]).toContain('update match_players set is_tracked')
    expect(db.query.mock.calls[1][1]).toEqual(['76561198000000003'])
  })
})

describe('POST /api/players/promote', () => {
  function appWithNick(nick) {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('from match_players mp')) return Promise.resolve({ rows: nick ? [{ nick }] : [] })
        return Promise.resolve({ rows: [] })
      }),
    }
    return { app: createApp({ config, db }), db }
  }

  it('sem login: 401', async () => {
    const { app } = appWithNick('gabis')
    const res = await request(app).post('/api/players/promote').send({ steamId: '76561198000000003' })
    expect(res.status).toBe(401)
  })

  it('membro comum: 403', async () => {
    const { app } = appWithNick('gabis')
    const res = await request(app)
      .post('/api/players/promote')
      .set('Cookie', memberCookie)
      .send({ steamId: '76561198000000003' })
    expect(res.status).toBe(403)
  })

  it('admin com steamId inválido: 400', async () => {
    const { app } = appWithNick('gabis')
    const res = await request(app)
      .post('/api/players/promote')
      .set('Cookie', adminCookie)
      .send({ steamId: 'abc' })
    expect(res.status).toBe(400)
  })

  it('promove com o nick puxado do histórico e retroage is_tracked', async () => {
    const { app, db } = appWithNick('gabis')
    const res = await request(app)
      .post('/api/players/promote')
      .set('Cookie', adminCookie)
      .send({ steamId: '76561198000000003' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ok: true, nick: 'gabis' })
    const insertCall = db.query.mock.calls.find((c) => c[0].startsWith('insert into players'))
    expect(insertCall[1]).toEqual(['76561198000000003', 'gabis'])
    const trackCall = db.query.mock.calls.find((c) => c[0].includes('update match_players set is_tracked'))
    expect(trackCall[1]).toEqual(['76561198000000003'])
  })

  it('participante sem histórico: promove com nick vazio', async () => {
    const { app } = appWithNick(null)
    const res = await request(app)
      .post('/api/players/promote')
      .set('Cookie', adminCookie)
      .send({ steamId: '76561198000000003' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ok: true, nick: '' })
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

describe('PUT /api/players/me/ranking-publico', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    expect((await request(app).put('/api/players/me/ranking-publico').send({ publico: true })).status).toBe(401)
  })

  it('grava o proprio opt-in', async () => {
    const { app, db } = appWith()
    const res = await request(app).put('/api/players/me/ranking-publico').set('Cookie', memberCookie).send({ publico: true })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, publico: true })
    expect(db.query.mock.calls[0][1]).toEqual(['76561198000000002', true])
  })
})
