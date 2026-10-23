import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MENSAGEM_API_INDISPONIVEL,
  PRODUCTION_API_URL,
  buildClientConfig,
  config,
  origemPreview,
  resolveApiOrigin,
} from './vercel.mjs'

const CSP = "default-src 'self'"

function destinoApi(cfg) {
  return cfg.rewrites.filter((r) => r.source.startsWith('/api')).map((r) => r.destination)
}

describe('resolveApiOrigin', () => {
  it('producao usa a URL fixa da API, mesmo com PREVIEW_API_URL', () => {
    expect(resolveApiOrigin({
      VERCEL_ENV: 'production',
      PREVIEW_API_URL: 'https://staging.exemplo.com',
    })).toBe(PRODUCTION_API_URL)
  })

  it('preview e development sem URL valida nao caem na producao', () => {
    expect(resolveApiOrigin({ VERCEL_ENV: 'preview' })).toBeNull()
    expect(resolveApiOrigin({ VERCEL_ENV: 'development' })).toBeNull()
    expect(resolveApiOrigin({})).toBeNull()
    expect(resolveApiOrigin({ VERCEL_ENV: 'preview', PREVIEW_API_URL: 'http://staging.exemplo.com' })).toBeNull()
    expect(resolveApiOrigin({ VERCEL_ENV: 'preview', PREVIEW_API_URL: 'https://user:senha@staging.exemplo.com' })).toBeNull()
    expect(resolveApiOrigin({ VERCEL_ENV: 'preview', PREVIEW_API_URL: 'nao-e-url' })).toBeNull()
  })

  it('preview com origem https usa so o origin, sem caminho', () => {
    expect(origemPreview('  https://staging.exemplo.com/prefixo?x=1  ')).toBe('https://staging.exemplo.com')
    expect(resolveApiOrigin({
      VERCEL_ENV: 'preview',
      PREVIEW_API_URL: 'https://staging.exemplo.com/api/',
    })).toBe('https://staging.exemplo.com')
  })
})

describe('buildClientConfig', () => {
  it('producao reescreve /api para a API e deixa o fallback da SPA por ultimo', () => {
    const cfg = buildClientConfig({ VERCEL_ENV: 'production', PREVIEW_API_URL: 'https://evil.exemplo' })
    expect(cfg.routes).toBeUndefined()
    expect(destinoApi(cfg)).toEqual([
      'https://resenhacs.vercel.app/api',
      'https://resenhacs.vercel.app/api/$1',
    ])
    expect(cfg.rewrites.at(-1)).toEqual({ source: '/(.*)', destination: '/index.html' })
    const seguranca = cfg.headers.find((h) => h.source === '/(.*)')
    expect(seguranca.headers.map((h) => h.key)).toEqual([
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Strict-Transport-Security',
      'Content-Security-Policy-Report-Only',
      'Permissions-Policy',
    ])
    expect(seguranca.headers.find((h) => h.key === 'Content-Security-Policy-Report-Only').value).toContain(CSP)
    expect(seguranca.headers.find((h) => h.key === 'Content-Security-Policy-Report-Only').value).toContain("connect-src 'self'")
    for (const regra of cfg.headers.filter((h) => h.source.startsWith('/api'))) {
      const valores = Object.fromEntries(regra.headers.map((h) => [h.key, h.value]))
      expect(valores['Cache-Control']).toBe('private, no-store')
      expect(valores['CDN-Cache-Control']).toBe('no-store')
      expect(valores['Vercel-CDN-Cache-Control']).toBe('no-store')
    }
  })

  it('preview com staging aponta so para essa origem', () => {
    const cfg = buildClientConfig({
      VERCEL_ENV: 'preview',
      PREVIEW_API_URL: 'https://staging.exemplo.com/ignorado',
    })
    expect(destinoApi(cfg)).toEqual([
      'https://staging.exemplo.com/api',
      'https://staging.exemplo.com/api/$1',
    ])
    expect(JSON.stringify(cfg)).not.toContain('resenhacs.vercel.app')
  })

  it('preview sem staging responde 503 e nao menciona a API de producao', () => {
    const cfg = buildClientConfig({ VERCEL_ENV: 'preview' })
    expect(cfg.rewrites).toBeUndefined()
    expect(JSON.stringify(cfg)).not.toContain('resenhacs.vercel.app')
    const bloqueio = cfg.routes.find((r) => r.status === 503)
    expect(bloqueio).toMatchObject({
      src: '^/api(?:/.*)?$',
      dest: '/api-indisponivel.txt',
      status: 503,
    })
    expect(bloqueio.headers['Cache-Control']).toBe('private, no-store')
    expect(cfg.routes.some((r) => r.handle === 'filesystem')).toBe(true)
    expect(cfg.routes.some((r) => r.continue === true && r.headers['X-Frame-Options'] === 'DENY')).toBe(true)
    expect(cfg.routes.at(-1).dest).toBe('/index.html')
  })

  it('o arquivo do 503 repete a mensagem e o export config segue o env atual', () => {
    const texto = readFileSync(path.join(process.cwd(), 'public/api-indisponivel.txt'), 'utf8').trim()
    expect(texto).toBe(MENSAGEM_API_INDISPONIVEL)
    expect(config).toEqual(buildClientConfig(process.env))
  })
})
