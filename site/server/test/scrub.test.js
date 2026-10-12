import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { minimizarEvento, REDACTED } from '../src/observabilidade/scrub.js'

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
    const amostras = ['(11) 3456-7890', '+55 (11) 3333-4444', '1134567890', '(21) 98888-7777', '+55 11 91234-5678']
    for (const amostra of amostras) {
      expect(minimizarEvento({ message: `contato ${amostra}` }).message).toBe(REDACTED)
    }
    expect(minimizarEvento({ message: '76561198000000000' }).message).toBe('76561198000000000')
  })

  it('palavra sensível redige a string inteira e não mexe no sdk', () => {
    const sdk = { name: '@sentry/node' }
    const evento = minimizarEvento({
      sdk,
      event_id: 'authorization-field',
      message: 'cookie de sessão inválido',
    })
    expect(evento.sdk).toBe(sdk)
    expect(evento.event_id).toBe('authorization-field')
    expect(evento.message).toBe(REDACTED)
  })

  it('DSN é lido por acesso estático e o módulo não importa o SDK sem ele', () => {
    const fonte = readFileSync(join(process.cwd(), 'src/observabilidade/sentry.js'), 'utf8')
    expect(fonte).toMatch(/process\.env\.SENTRY_DSN/)
    expect(fonte).not.toMatch(/process\.env\[/)
    expect(fonte).toMatch(/if \(dsn\)/)
  })
})
