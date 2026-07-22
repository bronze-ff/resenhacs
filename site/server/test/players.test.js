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
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('is_super_admin from players')) {
        return Promise.resolve({ rows: [{ is_super_admin: true }] })
      }
      return Promise.resolve({ rows })
    }),
  }
  return { app: createApp({ config, db }), db }
}

const adminCookie = `resenha_token=${signToken({ steamId: '76561198000000001', isSuperAdmin: true }, config.jwtSecret)}`
const memberCookie = `resenha_token=${signToken({ steamId: '76561198000000002', isSuperAdmin: false }, config.jwtSecret)}`

describe('GET /api/players', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    expect((await request(app).get('/api/players')).status).toBe(401)
  })

  it('logado: lista jogadores', async () => {
    const { app } = appWith([
      { steam_id64: '765', nick: 'fih', avatar_url: null, is_super_admin: true },
    ])
    const res = await request(app).get('/api/players').set('Cookie', memberCookie)
    expect(res.status).toBe(200)
    // is_super_admin de OUTRO jogador não pode vazar pro amigo logado (reconhecimento de
    // alvo de maior privilégio) — só sai isSuperAdmin no próprio registro do logado.
    expect(res.body).toEqual([{ steamId: '765', nick: 'fih', avatarUrl: null }])
  })

  it('logado: vê o próprio isSuperAdmin, mas não o de outro jogador da lista', async () => {
    const eu = '76561198000000002'
    const { app } = appWith([
      { steam_id64: eu, nick: 'eu-mesmo', avatar_url: null, is_super_admin: false },
      { steam_id64: '76561198000000009', nick: 'amigo', avatar_url: null, is_super_admin: true },
    ])
    const res = await request(app).get('/api/players').set('Cookie', memberCookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { steamId: eu, nick: 'eu-mesmo', avatarUrl: null, isSuperAdmin: false },
      { steamId: '76561198000000009', nick: 'amigo', avatarUrl: null },
    ])
  })

  it('escopo populacional: eu + meus amigos accepted (friendships), não group_members', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const app = createApp({ config, db })
    const res = await request(app).get('/api/players').set('Cookie', memberCookie)
    expect(res.status).toBe(200)
    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes('from friendships f'))
    expect(sql).toContain('from friendships f')
    expect(sql).toContain("f.status = 'accepted'")
    expect(sql).not.toContain('group_members')
    expect(params).toEqual(['76561198000000002'])
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

  it('escopo populacional dos bans: eu + meus amigos accepted (friendships), não group_members', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const fetchBans = vi.fn().mockResolvedValue([])
    const app = createApp({ config, db, fetchBans })
    const res = await request(app).get('/api/players/bans').set('Cookie', memberCookie)
    expect(res.status).toBe(200)
    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes('from friendships f'))
    expect(sql).toContain('from friendships f')
    expect(sql).toContain("f.status = 'accepted'")
    expect(sql).not.toContain('group_members')
    expect(params).toEqual(['76561198000000002'])
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
    const insertCall = db.query.mock.calls.find((c) => c[0].includes('insert into players'))
    expect(insertCall[1]).toEqual(['76561198000000003'])
    const trackCall = db.query.mock.calls.find((c) => c[0].includes('update match_players set is_tracked'))
    expect(trackCall[1]).toEqual(['76561198000000003'])
  })
})

describe('POST /api/players/promote', () => {
  function appWithNick(nick) {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('is_super_admin from players')) return Promise.resolve({ rows: [{ is_super_admin: true }] })
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
    const chamada = db.query.mock.calls.find(([, params]) => params?.[1] === 'ABCD-12345-EFGH')
    expect(chamada[1]).toEqual([
      '76561198000000002',
      'ABCD-12345-EFGH',
      shareCode,
    ])
  })
})

describe('PUT /api/players/me/tour-concluido', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    expect((await request(app).put('/api/players/me/tour-concluido')).status).toBe(401)
  })

  it('marca o tour como concluido pro jogador logado', async () => {
    const { app, db } = appWith()
    const res = await request(app).put('/api/players/me/tour-concluido').set('Cookie', memberCookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    const chamada = db.query.mock.calls.find(([sql]) => sql.includes('update players set tour_concluido = true'))
    expect(chamada[0]).toContain('update players set tour_concluido = true')
    expect(chamada[1]).toEqual(['76561198000000002'])
  })
})
