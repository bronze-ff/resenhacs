import { afterEach, describe, expect, it } from 'vitest'
import middleware, { resolveApiOrigin } from './middleware.js'

describe('resolveApiOrigin', () => {
  it('producao sempre usa a URL fixa da API, mesmo com PREVIEW_API_URL setada', () => {
    expect(
      resolveApiOrigin({ VERCEL_ENV: 'production', PREVIEW_API_URL: 'https://staging.exemplo.com' }),
    ).toBe('https://resenhacs.vercel.app')
  })

  it('preview sem PREVIEW_API_URL configurada nao cai pra producao (retorna null)', () => {
    expect(resolveApiOrigin({ VERCEL_ENV: 'preview' })).toBeNull()
  })

  it('development sem PREVIEW_API_URL configurada tambem nao cai pra producao', () => {
    expect(resolveApiOrigin({ VERCEL_ENV: 'development' })).toBeNull()
  })

  it('preview com PREVIEW_API_URL configurada usa o staging informado', () => {
    expect(
      resolveApiOrigin({ VERCEL_ENV: 'preview', PREVIEW_API_URL: 'https://staging.exemplo.com' }),
    ).toBe('https://staging.exemplo.com')
  })

  it('sem VERCEL_ENV (ex.: rodando fora da Vercel) trata como nao-producao', () => {
    expect(resolveApiOrigin({})).toBeNull()
  })
})

describe('middleware (handler completo)', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('bloqueia /api/* com 503 quando e preview sem PREVIEW_API_URL', async () => {
    process.env.VERCEL_ENV = 'preview'
    delete process.env.PREVIEW_API_URL
    const response = middleware(new Request('https://preview-abc.vercel.app/api/amigos'))
    expect(response.status).toBe(503)
  })

  it('reescreve pro destino de producao quando VERCEL_ENV=production', async () => {
    process.env.VERCEL_ENV = 'production'
    const response = middleware(new Request('https://resenha.exemplo.com/api/amigos?x=1'))
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://resenhacs.vercel.app/api/amigos?x=1',
    )
  })

  it('reescreve pro staging quando PREVIEW_API_URL esta configurada', async () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.PREVIEW_API_URL = 'https://staging-api.exemplo.com'
    const response = middleware(new Request('https://preview-abc.vercel.app/api/amigos'))
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://staging-api.exemplo.com/api/amigos',
    )
  })
})
