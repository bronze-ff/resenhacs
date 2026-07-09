const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login'
const NONCE_MAX_AGE_MS = 5 * 60 * 1000

export function buildSteamRedirectUrl(appUrl) {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${appUrl}/api/auth/steam/return`,
    'openid.realm': appUrl,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  })
  return `${STEAM_OPENID_URL}?${params}`
}

export function extractSteamId(claimedId) {
  const match = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(claimedId ?? '')
  return match ? match[1] : null
}

// O response_nonce da Steam começa com um timestamp ISO 8601 (ex.: 2024-01-02T03:04:05Zxyz).
function nonceEstaFresco(nonce, now) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/.exec(nonce ?? '')
  if (!match) return false
  const emitido = Date.parse(match[1])
  if (Number.isNaN(emitido)) return false
  const idade = now - emitido
  return idade >= -NONCE_MAX_AGE_MS && idade <= NONCE_MAX_AGE_MS
}

export async function verifySteamAssertion(query, appUrl, fetchImpl = fetch, now = Date.now()) {
  // Verificações da spec OpenID 2.0 exigidas do Relying Party (antes de falar com a Steam).
  if (query?.['openid.mode'] !== 'id_res') return null
  const returnTo = query['openid.return_to'] ?? ''
  if (!returnTo.startsWith(`${appUrl}/api/auth/steam/return`)) return null
  const nonce = query['openid.response_nonce']
  if (!nonceEstaFresco(nonce, now)) return null

  const params = new URLSearchParams({ ...query, 'openid.mode': 'check_authentication' })
  const res = await fetchImpl(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const text = await res.text()
  if (!/is_valid\s*:\s*true/.test(text)) return null

  const steamId = extractSteamId(query['openid.claimed_id'])
  if (!steamId) return null
  return { steamId, nonce }
}
