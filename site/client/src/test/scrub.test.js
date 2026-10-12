import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { minimizarBreadcrumb, minimizarEvento, minimizarSpan, REDACTED } from '../observabilidade/scrub.js'

const STEAM = '76561198000000000'

describe('scrub de observabilidade', () => {
  it('allowlist do request: sem header, cookie, body ou query', () => {
    const evento = minimizarEvento({
      request: {
        method: 'GET',
        url: 'https://resenha-phi.vercel.app/api/matches/abc?token=segredo&x=1#frag',
        headers: { Authorization: 'Bearer abc', cookie: 'resenha_token=1' },
        cookies: { resenha_token: '1' },
        data: { senha: 'x' },
        query_string: 'token=segredo',
      },
    })
    expect(evento.request).toEqual({
      method: 'GET',
      url: 'https://resenha-phi.vercel.app/api/matches/abc',
    })
  })

  it('redige a string inteira quando sobra palavra sensível ou PII', () => {
    const evento = minimizarEvento({
      message: 'falha ao ler senha do jogador',
      extra: { nota: 'cpf 529.982.247-25 no formulario' },
    })
    expect(evento.message).toBe(REDACTED)
    expect(evento.extra.nota).toBe(REDACTED)
  })

  it('não percorre campo de transporte do SDK', () => {
    const sdk = { name: '@sentry/react', packages: [{ name: 'token-interno' }] }
    const evento = minimizarEvento({
      event_id: 'token-nao-mexer',
      sdk,
      span_id: 'cookie-span',
      message: 'ok',
    })
    expect(evento.event_id).toBe('token-nao-mexer')
    expect(evento.sdk).toBe(sdk)
    expect(evento.span_id).toBe('cookie-span')
    expect(evento.message).toBe('ok')
  })

  it('user fica só com o id, e steam id de 17 dígitos passa', () => {
    const evento = minimizarEvento({
      user: { id: STEAM, email: 'a@b.com', username: 'nick', ip_address: '1.2.3.4' },
    })
    expect(evento.user).toEqual({ id: STEAM })
  })

  it('breadcrumb de console sai; span perde query', () => {
    expect(minimizarBreadcrumb({ category: 'console', message: 'oi' })).toBeNull()
    const span = minimizarSpan({
      span_id: 'abc',
      trace_id: 'def',
      op: 'http.client',
      description: 'GET https://api.exemplo.com/v1/jogadores?codigo=1',
      data: { 'http.query': 'codigo=1', 'http.url': 'https://api.exemplo.com/v1/jogadores?codigo=1' },
    })
    expect(span.span_id).toBe('abc')
    expect(span.trace_id).toBe('def')
    expect(span.description).toBe('GET https://api.exemplo.com/v1/jogadores')
    expect(span.data['http.query']).toBeUndefined()
    expect(span.data['http.url']).toBe('https://api.exemplo.com/v1/jogadores')
  })

  it('caminho relativo perde query', () => {
    const evento = minimizarEvento({ request: { url: '/api/auth/me?code=1' } })
    expect(evento.request.url).toBe('/api/auth/me')
  })

  it('variáveis públicas são lidas de forma estática', () => {
    const sentry = readFileSync(join(process.cwd(), 'src/observabilidade/sentry.js'), 'utf8')
    const posthog = readFileSync(join(process.cwd(), 'src/observabilidade/posthog.js'), 'utf8')
    expect(sentry).not.toMatch(/import\.meta\.env\[/)
    expect(posthog).not.toMatch(/import\.meta\.env\[/)
    expect(sentry).toMatch(/import\.meta\.env\.VITE_SENTRY_DSN/)
    expect(posthog).toMatch(/import\.meta\.env\.VITE_POSTHOG_KEY/)
    expect(posthog).toMatch(/import\.meta\.env\.VITE_POSTHOG_HOST/)
  })
})
