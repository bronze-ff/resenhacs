import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, faceitClientId: 'client-123' }
const cookie = `resenha_token=${signToken({ steamId: '111' }, config.jwtSecret)}`

function appWith({ rows = [] } = {}) {
  const db = { query: vi.fn().mockResolvedValue({ rows }) }
  return { app: createApp({ config, db }), db }
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
    const cookies = res.headers['set-cookie'].join(';')
    expect(cookies).toContain('resenha_faceit_state=')
    expect(cookies).toContain('resenha_faceit_verifier=')
  })

  it('sem FACEIT_CLIENT_ID configurado: 503', async () => {
    const db = { query: vi.fn() }
    const app = createApp({ config: { ...config, faceitClientId: null }, db })
    const res = await request(app).get('/api/faceit/login').set('Cookie', cookie)
    expect(res.status).toBe(503)
  })
})

describe('GET /api/faceit/callback', () => {
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
    const appComFetch = createApp({ config, db, faceitFetchImpl: fetchImpl })
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
    expect(db.query.mock.calls[0][1]).toEqual(['111', 'abc-123', 'ProPlayer'])
  })

  it('com FACEIT_CLIENT_SECRET configurado: manda Authorization Basic na troca de token', async () => {
    const configComSecret = { ...config, faceitClientSecret: 'segredo-123' }
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ guid: 'abc-123', nickname: 'ProPlayer' }) })
    const app = createApp({ config: configComSecret, db, faceitFetchImpl: fetchImpl })
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
    const app = createApp({ config, db, faceitFetchImpl: fetchImpl })
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
