import { describe, it, expect, vi } from 'vitest'
import {
  buildSteamRedirectUrl,
  extractSteamId,
  verifySteamAssertion,
} from '../src/steam/openid.js'

describe('buildSteamRedirectUrl', () => {
  it('aponta para o login da Steam com return_to e realm corretos', () => {
    const url = new URL(buildSteamRedirectUrl('http://localhost:5173'))
    expect(url.origin + url.pathname).toBe('https://steamcommunity.com/openid/login')
    expect(url.searchParams.get('openid.mode')).toBe('checkid_setup')
    expect(url.searchParams.get('openid.return_to')).toBe(
      'http://localhost:5173/api/auth/steam/return',
    )
    expect(url.searchParams.get('openid.realm')).toBe('http://localhost:5173')
    expect(url.searchParams.get('openid.claimed_id')).toBe(
      'http://specs.openid.net/auth/2.0/identifier_select',
    )
  })
})

describe('extractSteamId', () => {
  it('extrai o steam_id64 do claimed_id', () => {
    expect(extractSteamId('https://steamcommunity.com/openid/id/76561198012345678')).toBe(
      '76561198012345678',
    )
  })

  it('rejeita formatos inesperados', () => {
    expect(extractSteamId('https://malicioso.com/openid/id/76561198012345678')).toBeNull()
    expect(extractSteamId('https://steamcommunity.com/openid/id/abc')).toBeNull()
    expect(extractSteamId(undefined)).toBeNull()
  })
})

describe('verifySteamAssertion', () => {
  const appUrl = 'http://localhost:5173'
  const now = Date.parse('2024-01-02T03:04:05Z')
  const query = {
    'openid.mode': 'id_res',
    'openid.return_to': `${appUrl}/api/auth/steam/return`,
    'openid.response_nonce': '2024-01-02T03:04:05Zabc123',
    'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198012345678',
    'openid.sig': 'assinatura',
  }

  function fetchValido() {
    return vi.fn().mockResolvedValue({
      text: async () => 'ns:http://specs.openid.net/auth/2.0\nis_valid:true\n',
    })
  }

  it('retorna steamId e nonce quando tudo confere', async () => {
    const fakeFetch = fetchValido()
    const res = await verifySteamAssertion(query, appUrl, fakeFetch, now)
    expect(res).toEqual({ steamId: '76561198012345678', nonce: '2024-01-02T03:04:05Zabc123' })
    const [url, opts] = fakeFetch.mock.calls[0]
    expect(url).toBe('https://steamcommunity.com/openid/login')
    expect(opts.body).toContain('openid.mode=check_authentication')
  })

  it('rejeita mode diferente de id_res sem nem chamar a Steam', async () => {
    const fakeFetch = fetchValido()
    const res = await verifySteamAssertion(
      { ...query, 'openid.mode': 'cancel' },
      appUrl,
      fakeFetch,
      now,
    )
    expect(res).toBeNull()
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it('rejeita return_to de outra origem (forjamento)', async () => {
    const fakeFetch = fetchValido()
    const res = await verifySteamAssertion(
      { ...query, 'openid.return_to': 'https://malicioso.com/api/auth/steam/return' },
      appUrl,
      fakeFetch,
      now,
    )
    expect(res).toBeNull()
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it('rejeita nonce fora da janela de 5 minutos (replay antigo)', async () => {
    const fakeFetch = fetchValido()
    const quinzeMinDepois = Date.parse('2024-01-02T03:20:00Z')
    expect(await verifySteamAssertion(query, appUrl, fakeFetch, quinzeMinDepois)).toBeNull()
  })

  it('retorna null quando a Steam responde is_valid:false', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ text: async () => 'is_valid:false\n' })
    expect(await verifySteamAssertion(query, appUrl, fakeFetch, now)).toBeNull()
  })
})
