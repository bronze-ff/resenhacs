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
