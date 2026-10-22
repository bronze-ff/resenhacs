import { FACEIT_DEMO_HOSTS, FACEIT_MATCH_ID, FACEIT_ROOM_PATH, SITE_ORIGIN } from './config.js'

function urlHttps(valor) {
  if (typeof valor !== 'string' || valor.length > 2048) return null
  try {
    const url = new URL(valor)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null
  } catch { return null }
}

export function filtrarDownload(item, hosts = FACEIT_DEMO_HOSTS) {
  const downloadUrl = item?.finalUrl || item?.url
  const url = urlHttps(downloadUrl)
  if (!url || !hosts.includes(url.hostname)) return null
  const demo = /\.dem(?:\.gz)?$/i
  if (!demo.test(url.pathname) && !(typeof item.filename === 'string' && demo.test(item.filename))) return null
  const referrer = urlHttps(item.referrer)
  const id = referrer?.hostname === 'www.faceit.com' ? referrer.pathname.match(FACEIT_ROOM_PATH)?.[1] : null
  return { faceitMatchId: id && FACEIT_MATCH_ID.test(id) ? id.toLowerCase() : null, downloadUrl }
}

export function linkDaPartida(matchId) {
  return typeof matchId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(matchId)
    ? `${SITE_ORIGIN}/partida/${matchId}` : null
}
