import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const appSrc = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8')
const pagina404 = readFileSync(new URL('../404.html', import.meta.url), 'utf8')

// path-to-regexp da Vercel, só no que este vercel.json usa: literal e grupo (.*).
function compila(source) {
  const marcado = source.replace(/\(\.\*\)/g, '\u0000')
  const corpo = marcado.replace(/[.+?^${}()|[\]\\*]/g, '\\$&').replace(/\u0000/g, '(.*)')
  return new RegExp(`^${corpo}$`)
}

function destino(pathname) {
  for (const regra of vercel.rewrites) {
    if (compila(regra.source).test(pathname)) return regra.destination
  }
  return null
}

const montagens = [...appSrc.matchAll(/app\.(?:use|get)\(\s*'(\/[^']*)'/g)].map((m) => m[1])

describe('rewrite da Vercel', () => {
  it('só manda /api/* pra função', () => {
    expect(vercel.rewrites).toEqual([{ source: '/api/(.*)', destination: '/api' }])
    expect(vercel.functions['api/index.js'].maxDuration).toBe(15)
    expect(vercel.rewrites.some((r) => r.source === '/(.*)')).toBe(false)
  })

  it('cobre cada rota montada no Express', () => {
    expect(montagens.length).toBeGreaterThan(10)
    for (const caminho of montagens) {
      expect(caminho.startsWith('/api/'), caminho).toBe(true)
      expect(destino(caminho), caminho).toBe('/api')
      expect(destino(`${caminho}/filho`), caminho).toBe('/api')
    }
  })

  it('preserva callback, webhook, upload e extensão', () => {
    for (const caminho of [
      '/api/health',
      '/api/auth/steam',
      '/api/auth/steam/return',
      '/api/faceit/login',
      '/api/faceit/callback',
      '/api/allstar/webhook',
      '/api/upload/upload-url',
      '/api/extensao/token',
      '/api/extensao/renovar',
      '/api/extensao/envio',
      '/api/minha-conta/exportar',
      '/api/matches/00000000-0000-4000-8000-000000000001/replay/round/2',
      '/api/matches/00000000-0000-4000-8000-000000000001/demo',
    ]) {
      expect(destino(caminho), caminho).toBe('/api')
    }
  })

  it('não acorda a função em path de scanner', () => {
    for (const caminho of ['/', '/wp-login.php', '/.env', '/robots.txt', '/favicon.ico', '/admin', '/health', '/API/health', '/api']) {
      expect(destino(caminho), caminho).toBeNull()
    }
  })

  it('deixa 404 estático pra path sem rewrite', () => {
    expect(pagina404).toContain('404')
    expect(destino('/404.html')).toBeNull()
  })
})
