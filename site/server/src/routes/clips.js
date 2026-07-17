import { Router } from 'express'

const PROVIDERS = [
  { host: 'allstar.gg', nome: 'allstar' },
  { host: 'medal.tv', nome: 'medal' },
  { host: 'youtube.com', nome: 'youtube' },
  { host: 'youtu.be', nome: 'youtube' },
]

export function detectProvider(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // Só http(s): uma URL javascript:/data: parseia sem erro e cairia no 'other' — o
  // client renderiza href direto, então isso seria XSS armazenado clicável.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  const host = parsed.hostname.replace(/^www\./, '')
  const achado = PROVIDERS.find((p) => host === p.host || host.endsWith(`.${p.host}`))
  return achado ? achado.nome : 'other'
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createClipsRouter({ db, requireAuth, requireGroupMember }) {
  const router = Router()

  // Anexa um Clipe (link externo) a uma Partida e, opcionalmente, a um Highlight.
  router.post('/', requireAuth, requireGroupMember, async (req, res) => {
    const { matchId, highlightId, steamId, url, title } = req.body ?? {}
    if (!matchId) return res.status(400).json({ erro: 'matchId é obrigatório' })
    if (!UUID_RE.test(String(matchId))) return res.status(400).json({ erro: 'matchId inválido' })
    const provider = detectProvider(url ?? '')
    if (!provider) return res.status(400).json({ erro: 'URL do clipe inválida' })
    if (!/^\d{17}$/.test(String(steamId ?? ''))) {
      return res.status(400).json({ erro: 'steamId (de quem é a jogada) inválido' })
    }

    // A Partida precisa existir E pertencer ao grupo ativo — sem isso, qualquer conta
    // logada anexava clipe a partida de outro grupo (broken access control / OWASP A01).
    const dono = await db.query('select 1 from matches where id = $1 and group_id = $2', [matchId, req.groupId])
    if (dono.rows.length === 0) return res.status(404).json({ erro: 'Partida não encontrada' })

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
