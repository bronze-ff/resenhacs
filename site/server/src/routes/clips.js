import { Router } from 'express'

const PROVIDERS = [
  { host: 'allstar.gg', nome: 'allstar' },
  { host: 'medal.tv', nome: 'medal' },
  { host: 'youtube.com', nome: 'youtube' },
  { host: 'youtu.be', nome: 'youtube' },
]

export function detectProvider(url) {
  let host
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
  const achado = PROVIDERS.find((p) => host === p.host || host.endsWith(`.${p.host}`))
  return achado ? achado.nome : 'other'
}

export function createClipsRouter({ db, requireAuth }) {
  const router = Router()

  // Anexa um Clipe (link externo) a uma Partida e, opcionalmente, a um Highlight.
  router.post('/', requireAuth, async (req, res) => {
    const { matchId, highlightId, steamId, url, title } = req.body ?? {}
    if (!matchId) return res.status(400).json({ erro: 'matchId é obrigatório' })
    const provider = detectProvider(url ?? '')
    if (!provider) return res.status(400).json({ erro: 'URL do clipe inválida' })
    if (!/^\d{17}$/.test(String(steamId ?? ''))) {
      return res.status(400).json({ erro: 'steamId (de quem é a jogada) inválido' })
    }

    const { rows } = await db.query(
      `insert into clips (match_id, highlight_id, steam_id64, url, provider, title, added_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [matchId, highlightId ?? null, steamId, url, provider, title ?? '', req.player.steamId],
    )
    res.status(201).json({ id: rows[0].id, provider })
  })

  return router
}
