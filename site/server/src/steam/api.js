export function createFetchPersona(apiKey, fetchImpl = fetch) {
  return async function fetchPersona(steamId) {
    try {
      const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`
      const res = await fetchImpl(url)
      if (!res.ok) return null
      const data = await res.json()
      const p = data?.response?.players?.[0]
      if (!p) return null
      return { nick: p.personaname ?? '', avatarUrl: p.avatarfull ?? null }
    } catch {
      return null
    }
  }
}

// GetPlayerBans: até 100 steamids por chamada — o grupo cabe numa chamada só. Cacheado
// em memória (TTL curto) porque isso é chamado toda vez que alguém abre a tela; o status
// de ban não muda de minuto a minuto, não vale gastar cota da API a cada request.
const CACHE_TTL_MS = 15 * 60 * 1000
export function createFetchBans(apiKey, fetchImpl = fetch) {
  let cache = { at: 0, steamIds: '', data: null }
  return async function fetchBans(steamIds) {
    if (steamIds.length === 0) return []
    const chave = [...steamIds].sort().join(',')
    if (cache.data && cache.steamIds === chave && Date.now() - cache.at < CACHE_TTL_MS) {
      return cache.data
    }
    try {
      const url = `https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${apiKey}&steamids=${steamIds.join(',')}`
      const res = await fetchImpl(url)
      if (!res.ok) return cache.data ?? []
      const data = await res.json()
      const resultado = (data?.players ?? []).map((p) => ({
        steamId: p.SteamId,
        vacBanned: !!p.VACBanned,
        numVacBans: p.NumberOfVACBans ?? 0,
        daysSinceLastBan: p.DaysSinceLastBan ?? 0,
        gameBanned: (p.NumberOfGameBans ?? 0) > 0,
        numGameBans: p.NumberOfGameBans ?? 0,
        communityBanned: !!p.CommunityBanned,
      }))
      cache = { at: Date.now(), steamIds: chave, data: resultado }
      return resultado
    } catch {
      return cache.data ?? []
    }
  }
}
