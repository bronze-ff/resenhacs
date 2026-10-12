import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chaveSensivel, minimizarEvento, REDACTED, redigirString } from '../src/observabilidade/scrub.js'

const casos = JSON.parse(readFileSync(join(process.cwd(), '../../shared/observabilidade/casos-palavras.json'), 'utf8'))

describe('scrub da API', () => {
  it('não manda header, cookie, body nem query', () => {
    const evento = minimizarEvento({
      request: {
        method: 'POST',
        url: 'https://resenhacs.vercel.app/api/auth/steam?token=abc',
        headers: { cookie: 'resenha_token=1' },
        data: { senha: 'x' },
        query_string: 'token=abc',
      },
    })
    expect(evento.request).toEqual({
      method: 'POST',
      url: 'https://resenhacs.vercel.app/api/auth/steam',
    })
  })

  it('redige telefone fixo e celular', () => {
    const amostras = [
      '(11) 3456-7890',
      '+55 (11) 3333-4444',
      '1134567890',
      '(21) 98888-7777',
      '+55 11 91234-5678',
      '3333-4444',
      '3333 4444',
      '91234-5678',
      '912345678',
    ]
    for (const amostra of amostras) {
      expect(minimizarEvento({ message: `contato ${amostra}` }).message).toBe(REDACTED)
    }
    const intactos = ['76561198000000000', '2026-10-12', '12/10/2026', 'placar 13-9', 'placar 16-14', 'empate 12:12']
    for (const amostra of intactos) {
      expect(minimizarEvento({ message: amostra }).message).toBe(amostra)
    }
  })

  it('allowlist do topo descarta logger e percorre o sdk', () => {
    const sdk = { name: '@sentry/node', packages: [{ name: 'token-interno' }] }
    const evento = minimizarEvento({
      sdk,
      event_id: 'authorization-field',
      message: 'cookie de sessão inválido',
      logger: 'api',
      profile: { frames: [] },
      debug_meta: { images: [] },
      extra: { nota: 'email a@b.com no texto' },
      contexts: { trace: { trace_id: 'abc' }, os: { name: 'Linux' } },
    })
    expect(evento.sdk).toEqual({ name: '@sentry/node', packages: [{ name: REDACTED }] })
    expect(evento.sdk).not.toBe(sdk)
    expect(evento.event_id).toBe(REDACTED)
    expect(evento.message).toBe(REDACTED)
    expect(evento.logger).toBeUndefined()
    expect(evento.profile).toBeUndefined()
    expect(evento.debug_meta).toBeUndefined()
    expect(evento.extra).toBeUndefined()
    expect(evento.contexts).toEqual({ trace: { trace_id: 'abc' } })
  })

  it('aplica os casos compartilhados de palavra sensível', () => {
    for (const amostra of casos.redige) {
      expect(redigirString(amostra)).toBe(REDACTED)
    }
    for (const amostra of casos.intactos) {
      expect(redigirString(amostra)).toBe(amostra)
    }
    for (const chave of casos.chavesSensiveis) {
      expect(chaveSensivel(chave)).toBe(true)
      expect(minimizarEvento({ tags: { [chave]: 'valor-limpo' } }).tags[chave] ?? REDACTED).toBe(REDACTED)
    }
    for (const chave of casos.chavesLivres) {
      expect(chaveSensivel(chave)).toBe(false)
    }
    const fonte = readFileSync(join(process.cwd(), 'src/observabilidade/scrub.js'), 'utf8')
    const palavras = readFileSync(join(process.cwd(), 'src/observabilidade/palavras.js'), 'utf8')
    expect(fonte).toMatch(/from '\.\/palavras\.js'/)
    expect(fonte).toBe(readFileSync(join(process.cwd(), '../client/src/observabilidade/scrub.js'), 'utf8'))
    expect(palavras).toBe(readFileSync(join(process.cwd(), '../client/src/observabilidade/palavras.js'), 'utf8'))
  })

  it('DSN é lido por acesso estático e o módulo não importa o SDK sem ele', () => {
    const fonte = readFileSync(join(process.cwd(), 'src/observabilidade/sentry.js'), 'utf8')
    expect(fonte).toMatch(/process\.env\.SENTRY_DSN/)
    expect(fonte).not.toMatch(/process\.env\[/)
    expect(fonte).toMatch(/if \(dsn\)/)
  })
})
