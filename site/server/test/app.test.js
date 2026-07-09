import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

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
})

describe('GET /api/health', () => {
  it('responde ok', async () => {
    const app = createApp({ config: testConfig })
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
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
