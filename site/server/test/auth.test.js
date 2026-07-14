import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken, verifyToken } from '../src/auth/jwt.js'

const config = {
  jwtSecret: 'segredo-de-teste',
  appUrl: 'http://localhost:5173',
  isProduction: false,
}

const JOGADOR = {
  steam_id64: '76561198012345678',
  nick: 'fih',
  avatar_url: 'https://avatars.steamstatic.com/x.jpg',
  is_super_admin: true,
  grupo_ativo_id: 'g1',
  ranking_publico: false,
}

// Fake que roteia por SQL: players devolve `rows`; o insert de nonce devolve
// rowCount 1 (nonce novo) ou 0 (replay); a checagem de papel no grupo ativo devolve
// `role`; qualquer outra query devolve vazio.
function fakeDb({ rows = [], nonceReplay = false, role = 'admin' } = {}) {
  return {
    query: vi.fn().mockImplementation((sql) => {
      if (sql.includes('used_openid_nonces')) {
        return Promise.resolve({ rows: nonceReplay ? [] : [{ nonce: 'n' }], rowCount: nonceReplay ? 0 : 1 })
      }
      if (sql.includes('role from group_members')) return Promise.resolve({ rows: [{ role }] })
      if (sql.includes('from players')) return Promise.resolve({ rows })
      return Promise.resolve({ rows: [] })
    }),
  }
}

function appWith({ rows = [], nonceReplay = false, role = 'admin', login = { steamId: JOGADOR.steam_id64, nonce: 'n1' } } = {}) {
  const db = fakeDb({ rows, nonceReplay, role })
  const app = createApp({
    config,
    db,
    verifySteamLogin: vi.fn().mockResolvedValue(login),
    fetchPersona: vi.fn().mockResolvedValue({ nick: 'fih', avatarUrl: 'https://a/x.jpg' }),
  })
  return { app, db }
}

function cookieFor(payload = { steamId: JOGADOR.steam_id64, isSuperAdmin: true }) {
  return `resenha_token=${signToken(payload, config.jwtSecret)}`
}

describe('jwt', () => {
  it('assina e verifica payload', () => {
    const token = signToken({ steamId: '765', isSuperAdmin: false }, 's')
    expect(verifyToken(token, 's')).toMatchObject({ steamId: '765', isSuperAdmin: false })
  })

  it('retorna null para token inválido ou segredo errado', () => {
    expect(verifyToken('lixo', 's')).toBeNull()
    expect(verifyToken(signToken({ steamId: '765', isSuperAdmin: false }, 'a'), 'b')).toBeNull()
  })
})

describe('GET /api/auth/steam', () => {
  it('redireciona para a Steam', async () => {
    const { app } = appWith()
    const res = await request(app).get('/api/auth/steam')
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('https://steamcommunity.com/openid/login')
  })
})

describe('GET /api/auth/steam/return', () => {
  it('whitelistado: seta cookie e redireciona para o app', async () => {
    const { app } = appWith({ rows: [JOGADOR] })
    const res = await request(app).get('/api/auth/steam/return?openid.mode=id_res')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(config.appUrl)
    const cookie = res.headers['set-cookie'][0]
    expect(cookie).toContain('resenha_token=')
    expect(cookie).toContain('HttpOnly')
  })

  it('primeiro login (fora da whitelist antiga): cria o jogador e loga mesmo assim', async () => {
    const { app } = appWith({ rows: [{ ...JOGADOR, is_super_admin: false, grupo_ativo_id: null }] })
    const res = await request(app).get('/api/auth/steam/return?openid.mode=id_res')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(config.appUrl)
    expect(res.headers['set-cookie'][0]).toContain('resenha_token=')
  })

  it('com returnTo salvo em cookie: redireciona pro destino pós-login', async () => {
    const { app } = appWith({ rows: [JOGADOR] })
    const agent = request.agent(app)
    await agent.get('/api/auth/steam?returnTo=/convite/tok1')
    const res = await agent.get('/api/auth/steam/return?openid.mode=id_res')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(`${config.appUrl}/convite/tok1`)
  })

  it('assinatura inválida: redireciona com erro', async () => {
    const { app } = appWith({ login: null })
    const res = await request(app).get('/api/auth/steam/return?openid.mode=id_res')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(`${config.appUrl}/?erro=login-invalido`)
  })

  it('nonce reutilizado (replay): redireciona com erro sem cookie', async () => {
    const { app } = appWith({ rows: [JOGADOR], nonceReplay: true })
    const res = await request(app).get('/api/auth/steam/return?openid.mode=id_res')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(`${config.appUrl}/?erro=login-invalido`)
    expect(res.headers['set-cookie']).toBeUndefined()
  })
})

describe('GET /api/auth/me', () => {
  it('sem cookie: 401', async () => {
    const { app } = appWith()
    expect((await request(app).get('/api/auth/me')).status).toBe(401)
  })

  it('com cookie válido: retorna o jogador', async () => {
    const { app } = appWith({ rows: [JOGADOR] })
    const res = await request(app).get('/api/auth/me').set('Cookie', cookieFor())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      steamId: JOGADOR.steam_id64,
      nick: 'fih',
      avatarUrl: JOGADOR.avatar_url,
      isSuperAdmin: true,
      grupoAtivoId: 'g1',
      rankingPublico: false,
      souAdminDoGrupo: true,
    })
  })

  it('membro comum do grupo ativo: souAdminDoGrupo false', async () => {
    const { app } = appWith({ rows: [JOGADOR], role: 'membro' })
    const res = await request(app).get('/api/auth/me').set('Cookie', cookieFor())
    expect(res.body.souAdminDoGrupo).toBe(false)
  })

  it('sem grupo ativo: souAdminDoGrupo nao aparece', async () => {
    const { app } = appWith({ rows: [{ ...JOGADOR, grupo_ativo_id: null }] })
    const res = await request(app).get('/api/auth/me').set('Cookie', cookieFor())
    expect(res.body.grupoAtivoId).toBeNull()
    expect(res.body.souAdminDoGrupo).toBeUndefined()
  })
})

describe('POST /api/auth/logout', () => {
  it('limpa o cookie', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/auth/logout')
    expect(res.status).toBe(200)
    expect(res.headers['set-cookie'][0]).toContain('resenha_token=;')
  })
})
