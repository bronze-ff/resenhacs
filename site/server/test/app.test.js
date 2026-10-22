import { afterEach, describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { signToken } from '../src/auth/jwt.js'

afterEach(() => vi.restoreAllMocks())

export const testConfig = {
  jwtSecret: 'segredo-de-teste',
  appUrl: 'http://localhost:5173',
  isProduction: false,
}

describe('loadConfig', () => {
  it('lança erro listando variáveis faltando', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/)
  })

  it('monta config a partir do env', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://x',
      JWT_SECRET: 's',
      STEAM_API_KEY: 'k',
    })
    expect(config.port).toBe(3001)
    expect(config.appUrl).toBe('http://localhost:5173')
    expect(config.isProduction).toBe(false)
  })

  it('JWT_SECRET curto fora de produção: não barra (não pode quebrar dev/teste)', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://x',
        JWT_SECRET: 's',
        STEAM_API_KEY: 'k',
      }),
    ).not.toThrow()
  })

  it('JWT_SECRET curto em produção: lança erro', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://x',
        JWT_SECRET: 's',
        STEAM_API_KEY: 'k',
        NODE_ENV: 'production',
      }),
    ).toThrow(/JWT_SECRET fraco/)
  })

  it('JWT_SECRET com 32+ caracteres em produção: passa', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://x',
      JWT_SECRET: 'a'.repeat(32),
      STEAM_API_KEY: 'k',
      NODE_ENV: 'production',
    })
    expect(config.isProduction).toBe(true)
  })
})

describe('GET /api/health', () => {
  it('responde ok', async () => {
    const app = createApp({ config: testConfig })
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})

describe('log do handler global', () => {
  it.each([[TypeError, 'TypeError'], [SyntaxError, 'SyntaxError']])('registra somente o tipo nativo de %s', async (Classe, tipo) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = { query: vi.fn(async (sql) => {
      if (sql.includes('tokens_validos_apos')) return { rows: [] }
      throw new Classe('DADO-DA-REQUISICAO')
    }) }
    const app = createApp({ config: testConfig, db })
    const cookie = `resenha_token=${signToken({ steamId: '765' }, testConfig.jwtSecret)}`
    expect((await request(app).get('/api/matches/invalido').set('Cookie', cookie)).status).toBe(500)
    expect(log.mock.calls[0]).toEqual(['api: erro não tratado', { tipo, sqlstate: null }])
    expect(JSON.stringify(log.mock.calls)).not.toContain('DADO-DA-REQUISICAO')
  })
  it.each(['22P02', 'DADO-DA-REQUISICAO'])('omite caminho e erro bruto (código: %s)', async (code) => {
    const valor = 'DADO-DA-REQUISICAO'
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const erro = Object.assign(new Error(`invalid input syntax for uuid: ${valor}`), { name: valor, code })
    const db = { query: vi.fn(async (sql) => {
      if (sql.includes('tokens_validos_apos')) return { rows: [] }
      throw erro
    }) }
    const app = createApp({ config: testConfig, db })
    const cookie = `resenha_token=${signToken({ steamId: '765' }, testConfig.jwtSecret)}`
    const res = await request(app).get(`/api/matches/${valor}`).set('Cookie', cookie)
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ erro: 'Erro interno' })
    expect(log).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(log.mock.calls)).not.toContain(valor)
    expect(log.mock.calls[0]).toEqual(['api: erro não tratado', { tipo: 'Error', sqlstate: code === '22P02' ? '22P02' : null }])
  })
})

describe('produção: static + fallback SPA', () => {
  it('serve index.html para rotas que não são /api', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'resenha-dist-'))
    writeFileSync(path.join(dir, 'index.html'), '<html>resenha</html>')
    const app = createApp({ config: testConfig, staticDir: dir })
    const res = await request(app).get('/jogadores')
    expect(res.status).toBe(200)
    expect(res.text).toContain('resenha')
  })

  it('não engole rotas /api desconhecidas', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'resenha-dist-'))
    writeFileSync(path.join(dir, 'index.html'), '<html>resenha</html>')
    const app = createApp({ config: testConfig, staticDir: dir })
    const res = await request(app).get('/api/inexistente')
    expect(res.status).toBe(404)
  })
})
