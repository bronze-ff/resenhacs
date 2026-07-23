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
  faceit_nick: null,
  tour_concluido: false,
}

// Fake que roteia por SQL: players devolve `rows`; o insert de nonce devolve
// rowCount 1 (nonce novo) ou 0 (replay); a checagem de amigos Steam com conta
// devolve `amigosComConta`; qualquer outra query devolve vazio.
function fakeDb({ rows = [], nonceReplay = false, amigosComConta = [] } = {}) {
  return {
    query: vi.fn().mockImplementation((sql) => {
      if (sql.includes('used_openid_nonces')) {
        return Promise.resolve({ rows: nonceReplay ? [] : [{ nonce: 'n' }], rowCount: nonceReplay ? 0 : 1 })
      }
      if (sql.includes('conta_criada_em is not null')) return Promise.resolve({ rows: amigosComConta })
      if (sql.includes('from players')) return Promise.resolve({ rows })
      return Promise.resolve({ rows: [] })
    }),
  }
}

function appWith({
  rows = [],
  nonceReplay = false,
  amigosComConta = [],
  login = { steamId: JOGADOR.steam_id64, nonce: 'n1' },
  fetchFriendList = vi.fn().mockResolvedValue([]),
} = {}) {
  const db = fakeDb({ rows, nonceReplay, amigosComConta })
  const app = createApp({
    config,
    db,
    verifySteamLogin: vi.fn().mockResolvedValue(login),
    fetchPersona: vi.fn().mockResolvedValue({ nick: 'fih', avatarUrl: 'https://a/x.jpg' }),
    fetchFriendList,
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
    const { app } = appWith({ rows: [{ ...JOGADOR, is_super_admin: false }] })
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

  it('marca conta_criada_em no upsert de players (mantendo valor existente via coalesce)', async () => {
    const { app, db } = appWith({ rows: [JOGADOR] })
    await request(app).get('/api/auth/steam/return?openid.mode=id_res')
    const queries = db.query.mock.calls
    expect(queries.some(([sql]) => sql.includes('conta_criada_em = coalesce'))).toBe(true)
  })

  it('auto-friend: cria accepted só com amigos Steam que têm conta', async () => {
    const fetchFriendList = vi.fn().mockResolvedValue(['222', '333'])
    const { app, db } = appWith({
      rows: [JOGADOR],
      fetchFriendList,
      amigosComConta: [{ steam_id64: '222' }], // só 222 tem conta; 333 é ignorado
    })
    const res = await request(app).get('/api/auth/steam/return?openid.mode=id_res')
    expect(res.status).toBe(302)
    expect(fetchFriendList).toHaveBeenCalledWith(JOGADOR.steam_id64)
    const queries = db.query.mock.calls
    const ins = queries.find(([sql]) => sql.includes('insert into friendships'))
    expect(ins).toBeTruthy()
    // par canônico (string menor primeiro) + quem pediu = quem logou
    expect(ins[1]).toEqual(['222', JOGADOR.steam_id64, JOGADOR.steam_id64])
  })

  it('auto-friend: perfil Steam privado (fetchFriendList vazio) não cria amizade nenhuma', async () => {
    const { app, db } = appWith({ rows: [JOGADOR], fetchFriendList: vi.fn().mockResolvedValue([]) })
    await request(app).get('/api/auth/steam/return?openid.mode=id_res')
    const queries = db.query.mock.calls
    expect(queries.some(([sql]) => sql.includes('insert into friendships'))).toBe(false)
  })

  it('auto-friend: falha no fetchFriendList não quebra o login (best-effort)', async () => {
    const fetchFriendList = vi.fn().mockRejectedValue(new Error('steam fora do ar'))
    const { app } = appWith({ rows: [JOGADOR], fetchFriendList })
    const res = await request(app).get('/api/auth/steam/return?openid.mode=id_res')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(config.appUrl)
    expect(res.headers['set-cookie'][0]).toContain('resenha_token=')
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
      faceitNick: null,
      tourConcluido: false,
    })
  })
})

describe('POST /api/auth/logout', () => {
  it('limpa o cookie', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/auth/logout')
    expect(res.status).toBe(200)
    expect(res.headers['set-cookie'][0]).toContain('resenha_token=;')
  })

  it('com cookie válido: marca tokens_validos_apos no banco pro steamId do token', async () => {
    const { app, db } = appWith()
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookieFor())
    expect(res.status).toBe(200)
    const update = db.query.mock.calls.find(([sql]) => sql.includes('tokens_validos_apos = now()'))
    expect(update).toBeTruthy()
    expect(update[1]).toEqual([JOGADOR.steam_id64])
  })

  it('sem cookie (ou já inválido): não tenta gravar nada no banco', async () => {
    const { app, db } = appWith()
    await request(app).post('/api/auth/logout')
    const update = db.query.mock.calls.find(([sql]) => sql.includes('tokens_validos_apos'))
    expect(update).toBeUndefined()
  })
})

// Finding #3 da auditoria: logout só limpava o cookie no navegador, o JWT em si
// continuava válido no servidor até expirar (7 dias) — requireAuth agora reconsulta
// tokens_validos_apos e rejeita qualquer token emitido antes do último logout.
describe('requireAuth: revogação de sessão', () => {
  it('token emitido ANTES do último logout (tokens_validos_apos no futuro relativo ao iat): 401', async () => {
    const cookie = cookieFor() // iat = agora
    const tokensValidosApos = new Date(Date.now() + 60_000).toISOString()
    const { app } = appWith({ rows: [{ ...JOGADOR, tokens_validos_apos: tokensValidosApos }] })
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie)
    expect(res.status).toBe(401)
  })

  it('token emitido DEPOIS do último logout: continua válido', async () => {
    const tokensValidosApos = new Date(Date.now() - 60_000).toISOString()
    const { app } = appWith({ rows: [{ ...JOGADOR, tokens_validos_apos: tokensValidosApos }] })
    const res = await request(app).get('/api/auth/me').set('Cookie', cookieFor())
    expect(res.status).toBe(200)
  })

  it('jogador nunca deslogou (tokens_validos_apos null): token continua válido', async () => {
    const { app } = appWith({ rows: [{ ...JOGADOR, tokens_validos_apos: null }] })
    const res = await request(app).get('/api/auth/me').set('Cookie', cookieFor())
    expect(res.status).toBe(200)
  })
})
