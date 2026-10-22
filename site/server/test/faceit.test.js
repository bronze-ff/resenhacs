import { afterEach, describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { bancoTransacional } from './bancoTransacional.js'

afterEach(() => vi.restoreAllMocks())

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, faceitClientId: 'client-123' }
const cookie = `resenha_token=${signToken({ steamId: '111' }, config.jwtSecret)}`

function appWith({ rows = [] } = {}) {
  const db = { query: vi.fn().mockResolvedValue({ rows }) }
  return { app: createApp({ config, db: bancoTransacional(db.query).db }), db }
}

describe('GET /api/faceit/login', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    expect((await request(app).get('/api/faceit/login')).status).toBe(401)
  })

  it('redireciona pra accounts.faceit.com com PKCE e seta cookies', async () => {
    const { app } = appWith()
    const res = await request(app).get('/api/faceit/login').set('Cookie', cookie)
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('https://accounts.faceit.com')
    expect(res.headers.location).toContain('code_challenge_method=S256')
    // Sem redirect_popup=true a FACEIT autentica mas fica parada na tela "Sucesso,
    // feche essa janela" (ela assume fluxo de popup por padrão) — confirmado ao vivo.
    expect(res.headers.location).toContain('redirect_popup=true')
    const cookies = res.headers['set-cookie'].join(';')
    expect(cookies).toContain('resenha_faceit_state=')
    expect(cookies).toContain('resenha_faceit_verifier=')
  })

  it('sem FACEIT_CLIENT_ID configurado: 503', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const app = createApp({ config: { ...config, faceitClientId: null }, db })
    const res = await request(app).get('/api/faceit/login').set('Cookie', cookie)
    expect(res.status).toBe(503)
  })
})

describe('GET /api/faceit/callback', () => {
  it('não registra o corpo bruto da falha de autenticação FACEIT', async () => {
    const valor = 'DADO-DA-REQUISICAO'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { db } = appWith()
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => `falha: ${valor}` })
    const app = createApp({ config, db, faceitFetchImpl: fetchImpl })
    const login = await request(app).get('/api/faceit/login').set('Cookie', cookie)
    const cookies = login.headers['set-cookie'].map((c) => c.split(';')[0])
    const state = cookies.find((c) => c.startsWith('resenha_faceit_state=')).split('=')[1]
    const res = await request(app).get(`/api/faceit/callback?code=abc&state=${state}`)
      .set('Cookie', [cookie, ...cookies].join('; '))
    expect(res.headers.location).toBe(`${config.appUrl}/conta?erro=faceit-invalido`)
    expect(JSON.stringify(log.mock.calls)).not.toContain(valor)
    expect(log).toHaveBeenCalledWith('faceit: falha na autenticação', { status: 400 })
  })
  it('dois callbacks não vinculam o mesmo FACEIT a dois Jogadores', async () => {
    const donos = new Set()
    const query = vi.fn(async (sql, params) => {
      if (sql.includes('where faceit_id = $1')) {
        const rows = [...donos].filter((id) => id !== params[1]).map((steam_id64) => ({ steam_id64 }))
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { rows }
      }
      if (sql.includes('update players set faceit_id')) donos.add(params[0])
      return { rows: [] }
    })
    const { db, clientes } = bancoTransacional(query)
    const fetchImpl = vi.fn(async (url) => ({
      ok: true, json: async () => url.includes('/token') ? { access_token: 'tok' } : { guid: 'faceit-unico' },
    }))
    const app = createApp({ config, db, faceitFetchImpl: fetchImpl })
    const pedidos = await Promise.all(['111', '222'].map(async (steamId) => {
      const sessao = `resenha_token=${signToken({ steamId }, config.jwtSecret)}`
      const login = await request(app).get('/api/faceit/login').set('Cookie', sessao)
      const cookies = login.headers['set-cookie'].map((c) => c.split(';')[0])
      const state = cookies.find((c) => c.startsWith('resenha_faceit_state=')).split('=')[1]
      return { sessao, cookies, state }
    }))
    const respostas = await Promise.all(pedidos.map(({ sessao, cookies, state }) => request(app)
      .get(`/api/faceit/callback?code=abc&state=${state}`).set('Cookie', [sessao, ...cookies].join('; '))))
    expect(respostas.map((r) => r.headers.location).sort()).toEqual([
      `${config.appUrl}/conta?erro=faceit-em-uso`, `${config.appUrl}/conta?faceit=vinculado`,
    ])
    expect(donos.size).toBe(1)
    expect(clientes.every((c) => c.release.mock.calls.length === 1)).toBe(true)
  })
  it('não vincula uma conta FACEIT que já pertence a outro Jogador', async () => {
    const db = { query: vi.fn(async (sql, params) => {
      if (sql.includes('where faceit_id = $1')) {
        expect(params).toEqual(['abc-123', '111'])
        return { rows: [{ steam_id64: '222' }] }
      }
      return { rows: [] }
    }) }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ guid: 'abc-123' }) })
    const app = createApp({ config, db: bancoTransacional(db.query).db, faceitFetchImpl: fetchImpl })
    const login = await request(app).get('/api/faceit/login').set('Cookie', cookie)
    const cookies = login.headers['set-cookie'].map((c) => c.split(';')[0])
    const state = cookies.find((c) => c.startsWith('resenha_faceit_state=')).split('=')[1]
    const res = await request(app).get(`/api/faceit/callback?code=abc&state=${state}`)
      .set('Cookie', [cookie, ...cookies].join('; '))
    expect(res.headers.location).toBe(`${config.appUrl}/conta?erro=faceit-em-uso`)
    expect(db.query.mock.calls.some(([sql]) => sql.includes('update players set faceit_id'))).toBe(false)
  })
  it('state ausente ou divergente: redireciona com erro', async () => {
    const { app } = appWith()
    const res = await request(app).get('/api/faceit/callback?code=x&state=y').set('Cookie', cookie)
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('erro=faceit-invalido')
  })

  it('troca code por token, busca userinfo e grava faceit_id', async () => {
    const { app, db } = appWith()
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ guid: 'abc-123', nickname: 'ProPlayer' }) })
    const appComFetch = createApp({ config, db: bancoTransacional(db.query).db, faceitFetchImpl: fetchImpl })
    const loginRes = await request(appComFetch).get('/api/faceit/login').set('Cookie', cookie)
    const setCookies = loginRes.headers['set-cookie']
    const stateCookie = setCookies.find((c) => c.startsWith('resenha_faceit_state=')).split(';')[0]
    const verifierCookie = setCookies.find((c) => c.startsWith('resenha_faceit_verifier=')).split(';')[0]
    const stateValue = stateCookie.split('=')[1]
    const res = await request(appComFetch)
      .get(`/api/faceit/callback?code=abc&state=${stateValue}`)
      .set('Cookie', [cookie, stateCookie, verifierCookie].join('; '))
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('faceit=vinculado')
    const gravaFaceitId = db.query.mock.calls.find(([, params]) => params?.[0] === '111' && params?.[1] === 'abc-123')
    expect(gravaFaceitId[1]).toEqual(['111', 'abc-123', 'ProPlayer'])
  })

  it('com FACEIT_CLIENT_SECRET configurado: manda Authorization Basic na troca de token', async () => {
    const configComSecret = { ...config, faceitClientSecret: 'segredo-123' }
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ guid: 'abc-123', nickname: 'ProPlayer' }) })
    const app = createApp({ config: configComSecret, db: bancoTransacional(db.query).db, faceitFetchImpl: fetchImpl })
    const loginRes = await request(app).get('/api/faceit/login').set('Cookie', cookie)
    const setCookies = loginRes.headers['set-cookie']
    const stateCookie = setCookies.find((c) => c.startsWith('resenha_faceit_state=')).split(';')[0]
    const verifierCookie = setCookies.find((c) => c.startsWith('resenha_faceit_verifier=')).split(';')[0]
    const stateValue = stateCookie.split('=')[1]
    await request(app)
      .get(`/api/faceit/callback?code=abc&state=${stateValue}`)
      .set('Cookie', [cookie, stateCookie, verifierCookie].join('; '))
    const tokenCall = fetchImpl.mock.calls.find(([url]) => url === 'https://api.faceit.com/auth/v1/oauth/token')
    const esperado = `Basic ${Buffer.from('client-123:segredo-123').toString('base64')}`
    expect(tokenCall[1].headers.Authorization).toBe(esperado)
  })

  it('sem FACEIT_CLIENT_SECRET: nao manda header Authorization na troca de token', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ guid: 'abc-123', nickname: 'ProPlayer' }) })
    const app = createApp({ config, db: bancoTransacional(db.query).db, faceitFetchImpl: fetchImpl })
    const loginRes = await request(app).get('/api/faceit/login').set('Cookie', cookie)
    const setCookies = loginRes.headers['set-cookie']
    const stateCookie = setCookies.find((c) => c.startsWith('resenha_faceit_state=')).split(';')[0]
    const verifierCookie = setCookies.find((c) => c.startsWith('resenha_faceit_verifier=')).split(';')[0]
    const stateValue = stateCookie.split('=')[1]
    await request(app)
      .get(`/api/faceit/callback?code=abc&state=${stateValue}`)
      .set('Cookie', [cookie, stateCookie, verifierCookie].join('; '))
    const tokenCall = fetchImpl.mock.calls.find(([url]) => url === 'https://api.faceit.com/auth/v1/oauth/token')
    expect(tokenCall[1].headers.Authorization).toBeUndefined()
  })
})
