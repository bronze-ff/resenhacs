import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chaveSensivel, minimizarBreadcrumb, minimizarEvento, minimizarSpan, REDACTED, redigirString } from '../observabilidade/scrub.js'

const casos = JSON.parse(readFileSync(join(process.cwd(), '../../shared/observabilidade/casos-palavras.json'), 'utf8'))

const STEAM = '76561198000000000'

describe('scrub de observabilidade', () => {
  it.each([
    'http://[foo',
    'http%3A%2F%2F%5Bfoo',
    'http%253A%252F%252F%255Bfoo',
    'http%25253A%25252F%25252F%25255Bfoo',
  ])('redige o valor inteiro se a URL for inválida em qualquer camada: %s', (url) => {
    const message = `falha em ${url}, tente de novo`
    expect(redigirString(message)).toBe(REDACTED)
    expect(minimizarEvento({ message, request: { url } })).toEqual({
      message: REDACTED,
      request: { url: REDACTED },
    })
  })

  it.each(casos.sanitiza)('sanitiza apenas a camada original: $entrada', ({ entrada, saida }) => {
    expect(redigirString(entrada)).toBe(saida)
    expect(minimizarEvento({ message: entrada }).message).toBe(saida)
  })

  it.each(casos.redige)('redige o caso compartilhado: %s', (valor) => {
    expect(redigirString(valor)).toBe(REDACTED)
    expect(minimizarEvento({ message: valor }).message).toBe(REDACTED)
  })

  it.each(['/partida/abc%20def', '/partida/%ZZ', '/partida/%E0%A4%A', '/p/abc%20def/%E0%A4'])('preserva o original sem dado sensível: %s', (valor) => {
    expect(redigirString(valor)).toBe(valor)
  })
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

  it('redige telefone fixo e celular, com ou sem +55 e separadores', () => {
    const amostras = [
      '(11) 3456-7890',
      '11 3456-7890',
      '11 3456 7890',
      '+55 11 3456-7890',
      '+55 (11) 3456-7890',
      '+55-11-3456-7890',
      '(11)3456-7890',
      '1134567890',
      '11.3456.7890',
      '(11) 91234-5678',
      '11 91234-5678',
      '+55 11 91234-5678',
      '+55 (11) 9 1234-5678',
      '+5511912345678',
      '11912345678',
      '11.91234.5678',
      '3333-4444',
      '3333 4444',
      '33334444',
      '91234-5678',
      '91234 5678',
      '912345678',
    ]
    for (const amostra of amostras) {
      expect(minimizarEvento({ message: `liga ${amostra} agora` }).message).toBe(REDACTED)
    }
    const intactos = [
      STEAM,
      'resenha do grupo',
      '2026-10-12',
      '12/10/2026',
      '2026-10-12T21:00:00Z',
      'placar 13-9',
      'placar 16-14',
      'placar 13:9',
      'empate 12:12',
    ]
    for (const amostra of intactos) {
      expect(minimizarEvento({ message: amostra }).message).toBe(amostra)
    }
  })

  it('redige a string inteira quando sobra palavra sensível ou PII', () => {
    const evento = minimizarEvento({
      message: 'falha ao ler senha do jogador',
      tags: { nota: 'cpf 529.982.247-25 no formulario' },
      extra: { nota: 'cpf 529.982.247-25 no formulario' },
    })
    expect(evento.message).toBe(REDACTED)
    expect(evento.tags.nota).toBe(REDACTED)
    expect(evento.extra).toBeUndefined()
  })

  it('só conserva a allowlist do topo e percorre cada valor', () => {
    const sdk = { name: '@sentry/react', packages: [{ name: 'token-interno' }] }
    const evento = minimizarEvento({
      event_id: 'abc123',
      sdk,
      span_id: 'cookie-span',
      logger: 'auth',
      profile: { token: 'x' },
      debug_meta: { images: [{ code_file: 'segredo' }] },
      message: 'ok',
      contexts: {
        trace: { trace_id: 'abc', span_id: 'def' },
        os: { name: 'Linux' },
        device: { name: 'secret-phone' },
      },
      breadcrumbs: {
        values: [
          { category: 'console', message: 'senha' },
          { category: 'ui', message: 'resenha', data: { token: 'x' }, logger: 'x' },
        ],
      },
    })
    expect(evento.event_id).toBe('abc123')
    expect(evento.sdk).toEqual({ name: '@sentry/react', packages: [{ name: REDACTED }] })
    expect(evento.sdk).not.toBe(sdk)
    expect(evento.span_id).toBeUndefined()
    expect(evento.logger).toBeUndefined()
    expect(evento.profile).toBeUndefined()
    expect(evento.debug_meta).toBeUndefined()
    expect(evento.message).toBe('ok')
    expect(evento.contexts).toEqual({ trace: { trace_id: 'abc', span_id: 'def' } })
    expect(evento.breadcrumbs).toEqual({
      values: [{ category: 'ui', message: 'resenha', data: { token: REDACTED }, logger: 'x' }],
    })
    expect(minimizarEvento({ event_id: 'token-nao-mexer' }).event_id).toBe(REDACTED)
  })

  it('aplica os casos compartilhados de palavra sensível', () => {
    for (const amostra of casos.intactos) {
      expect(redigirString(amostra)).toBe(amostra)
      expect(minimizarEvento({ message: amostra }).message).toBe(amostra)
    }
    for (const chave of casos.chavesSensiveis) {
      expect(chaveSensivel(chave)).toBe(true)
      const evento = minimizarEvento({ tags: { [chave]: 'valor-limpo' } })
      expect(evento.tags[chave] ?? REDACTED).toBe(REDACTED)
    }
    for (const chave of casos.chavesLivres) {
      expect(chaveSensivel(chave)).toBe(false)
      expect(minimizarEvento({ tags: { [chave]: 'valor-limpo' } }).tags[chave]).toBe('valor-limpo')
    }
    for (const amostra of casos.telefones) {
      expect(minimizarEvento({ message: `liga ${amostra} agora` }).message).toBe(REDACTED)
    }
    for (const amostra of casos.naoTelefone) {
      expect(minimizarEvento({ message: amostra }).message).toBe(amostra)
    }
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
    expect(minimizarSpan({ span_id: 'cookie-span' }).span_id).toBe(REDACTED)
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
    const scrub = readFileSync(join(process.cwd(), 'src/observabilidade/scrub.js'), 'utf8')
    const palavras = readFileSync(join(process.cwd(), 'src/observabilidade/palavras.js'), 'utf8')
    expect(scrub).toBe(readFileSync(join(process.cwd(), '../server/src/observabilidade/scrub.js'), 'utf8'))
    expect(palavras).toBe(readFileSync(join(process.cwd(), '../server/src/observabilidade/palavras.js'), 'utf8'))
    expect(palavras).toMatch(/export const PALAVRA/)
  })
})
