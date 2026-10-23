import { describe, expect, it } from 'vitest'
import { ipKeyGenerator } from 'express-rate-limit'
import { signToken } from '../src/auth/jwt.js'
import { chaveLimite, chaveLimiteEstrito, limiteEstrito, limiteGeral } from '../src/rateLimit.js'

const secret = 'segredo-de-teste'
const steamId = '76561198012345678'

function req(extra = {}) {
  return { ip: '203.0.113.5', path: '/api/health', cookies: {}, ...extra }
}

describe('chave do rate limit', () => {
  it('sessao valida separa por steamId, independente do IP', () => {
    const token = signToken({ steamId, isSuperAdmin: false }, secret)
    const comCookie = req({ cookies: { resenha_token: token }, ip: '198.51.100.2' })
    expect(chaveLimite(comCookie, secret)).toBe(`jogador:${steamId}`)
    expect(chaveLimiteEstrito(comCookie, secret)).toBe(`jogador:${steamId}`)
    expect(chaveLimite(comCookie, secret)).not.toBe(chaveLimite(req(), secret))
  })

  it('token invalido, steamId fora do formato ou segredo ausente cai no IP', () => {
    const token = signToken({ steamId, isSuperAdmin: false }, secret)
    const falsificado = signToken({ steamId: 'nao-e-steam' }, secret)
    expect(chaveLimite(req({ cookies: { resenha_token: token } }), 'outro-segredo')).toBe(ipKeyGenerator('203.0.113.5'))
    expect(chaveLimite(req({ cookies: { resenha_token: falsificado } }), secret)).toBe(ipKeyGenerator('203.0.113.5'))
    expect(chaveLimite(req({ cookies: { resenha_token: token } }), '')).toBe(ipKeyGenerator('203.0.113.5'))
  })

  it('anonimo do limite geral ignora o path; o estrito separa webhook de upload', () => {
    const webhook = req({ path: '/api/allstar/webhook' })
    const upload = req({ path: '/api/upload/upload-url' })
    expect(chaveLimite(webhook)).toBe(chaveLimite(upload))
    expect(chaveLimite(webhook)).toBe(ipKeyGenerator('203.0.113.5'))
    expect(chaveLimiteEstrito(webhook)).toBe(`${ipKeyGenerator('203.0.113.5')}:/api/allstar/webhook`)
    expect(chaveLimiteEstrito(upload)).toBe(`${ipKeyGenerator('203.0.113.5')}:/api/upload/upload-url`)
    expect(chaveLimiteEstrito(webhook)).not.toBe(chaveLimiteEstrito(upload))
  })

  it('chamada do middleware (req, res) le o segredo do ambiente', () => {
    const anterior = process.env.JWT_SECRET
    process.env.JWT_SECRET = secret
    try {
      const token = signToken({ steamId, isSuperAdmin: false }, secret)
      const res = { setHeader() {} }
      expect(chaveLimite(req({ cookies: { resenha_token: token } }), res)).toBe(`jogador:${steamId}`)
      expect(chaveLimiteEstrito(req({ cookies: { resenha_token: token } }), res)).toBe(`jogador:${steamId}`)
    } finally {
      if (anterior === undefined) delete process.env.JWT_SECRET
      else process.env.JWT_SECRET = anterior
    }
  })

  it('IPv6 passa pelo helper e o middleware aceita a chave', async () => {
    const ipv6 = req({ ip: '2001:db8::1' })
    expect(chaveLimite(ipv6)).toBe(ipKeyGenerator('2001:db8::1'))
    const res = { setHeader() {}, getHeader() { return undefined } }
    await new Promise((resolve, reject) => {
      limiteGeral(req(), res, (err) => (err ? reject(err) : resolve()))
    })
    await new Promise((resolve, reject) => {
      limiteEstrito(req(), res, (err) => (err ? reject(err) : resolve()))
    })
  })
})
