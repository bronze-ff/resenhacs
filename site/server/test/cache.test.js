import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = {
  jwtSecret: 'segredo-de-teste',
  appUrl: 'http://localhost:5173',
  isProduction: false,
}
const CACHE_PRIVADO = 'private, no-store'
const CACHE_HEALTH = 'public, s-maxage=60, stale-while-revalidate=300'

function appCom(db) {
  return createApp({
    config,
    db,
    verifySteamLogin: vi.fn(),
    fetchPersona: vi.fn(),
  })
}

describe('Cache-Control', () => {
  it('GET /api/health é o único GET público cacheável na CDN', async () => {
    const res = await request(appCom()).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe(CACHE_HEALTH)
    expect(res.headers['set-cookie']).toBeUndefined()
    expect(Object.keys(res.headers).some((nome) => nome.toLowerCase().startsWith('ratelimit'))).toBe(false)
  })

  it('GET autenticado não vai pra CDN, com ou sem sessão', async () => {
    const anon = await request(appCom()).get('/api/auth/me')
    expect(anon.status).toBe(401)
    expect(anon.headers['cache-control']).toBe(CACHE_PRIVADO)
    expect(anon.headers['cache-control']).not.toContain('s-maxage')

    const db = {
      query: vi.fn(async (sql) => {
        if (sql.includes('tokens_validos_apos')) return { rows: [{ tokens_validos_apos: null }] }
        if (sql.includes('from players')) {
          return {
            rows: [{
              steam_id64: '765',
              nick: 'fih',
              avatar_url: null,
              is_super_admin: false,
              premium: false,
              faceit_nick: null,
              tour_concluido: true,
            }],
          }
        }
        return { rows: [] }
      }),
    }
    const cookie = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`
    const logado = await request(appCom(db)).get('/api/auth/me').set('Cookie', cookie)
    expect(logado.status).toBe(200)
    expect(logado.headers['cache-control']).toBe(CACHE_PRIVADO)
    expect(logado.headers['set-cookie']).toBeUndefined()
  })

  it('login Steam grava cookie e não é cache compartilhado', async () => {
    const res = await request(appCom()).get('/api/auth/steam')
    expect(res.status).toBe(302)
    expect(res.headers['set-cookie']?.some((c) => c.startsWith('resenha_openid_state='))).toBe(true)
    expect(res.headers['cache-control']).toBe(CACHE_PRIVADO)
    expect(res.headers['cache-control']).not.toContain('s-maxage')
  })

  it('webhook público não é cacheado', async () => {
    const res = await request(appCom()).post('/api/allstar/webhook').send({ requestId: 'r1' })
    expect(res.status).toBe(401)
    expect(res.headers['cache-control']).toBe(CACHE_PRIVADO)
  })

  it('path fora de /api não é página quando a função roda sem staticDir', async () => {
    const res = await request(appCom()).get('/wp-login.php')
    expect(res.status).toBe(404)
    expect(res.headers['cache-control']).toBe(CACHE_PRIVADO)
  })
})
