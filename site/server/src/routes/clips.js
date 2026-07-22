import { Router } from 'express'
import { partidaVisivelExpr } from '../friendships.js'
import { parseHttpUrl, hostMatchesDomain } from './urlValidation.js'

const PROVIDERS = [
  { host: 'allstar.gg', nome: 'allstar' },
  { host: 'medal.tv', nome: 'medal' },
  { host: 'youtube.com', nome: 'youtube' },
  { host: 'youtu.be', nome: 'youtube' },
]

export function detectProvider(url) {
  const parsed = parseHttpUrl(url)
  if (!parsed) return null
  const achado = PROVIDERS.find((p) => hostMatchesDomain(parsed.hostname, p.host))
  return achado ? achado.nome : 'other'
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createClipsRouter({ db, requireAuth }) {
  const router = Router()

  // Anexa um Clipe (link externo) a uma Partida e, opcionalmente, a um Highlight.
  router.post('/', requireAuth, async (req, res) => {
    const { matchId, highlightId, steamId, url, title } = req.body ?? {}
    if (!matchId) return res.status(400).json({ erro: 'matchId é obrigatório' })
    if (!UUID_RE.test(String(matchId))) return res.status(400).json({ erro: 'matchId inválido' })
    const provider = detectProvider(url ?? '')
    if (!provider) return res.status(400).json({ erro: 'URL do clipe inválida' })
    if (!/^\d{17}$/.test(String(steamId ?? ''))) {
      return res.status(400).json({ erro: 'steamId (de quem é a jogada) inválido' })
    }

    // A Partida precisa existir E ser visível ao viewer (jogou ou é amigo accepted de quem
    // jogou) — sem isso, qualquer conta logada anexava clipe a partida de outro grupo/pessoa
    // (broken access control / OWASP A01).
    const dono = await db.query(
      `select 1 from matches m where m.id = $1 and ${partidaVisivelExpr('m', '$2')}`,
      [matchId, req.player.steamId],
    )
    if (dono.rows.length === 0) return res.status(404).json({ erro: 'Partida não encontrada' })

    // steamId (de quem é a jogada) precisa ter participado dessa Partida — sem isso, dava
    // pra anexar um clipe atribuído a qualquer jogador (mesmo alguém que nunca jogou essa
    // partida) só porque ela é visível ao viewer.
    const participou = await db.query(
      'select 1 from match_players where match_id = $1 and steam_id64 = $2',
      [matchId, steamId],
    )
    if (participou.rows.length === 0) {
      return res.status(400).json({ erro: 'steamId não participou dessa partida' })
    }

    // highlightId, se informado, precisa pertencer à mesma Partida — senão dava pra
    // anexar um clipe referenciando o highlight de uma partida diferente (inclusive uma
    // que o viewer não teria acesso).
    if (highlightId != null) {
      if (!UUID_RE.test(String(highlightId))) {
        return res.status(400).json({ erro: 'highlightId inválido' })
      }
      const highlight = await db.query(
        'select 1 from highlights where id = $1 and match_id = $2',
        [highlightId, matchId],
      )
      if (highlight.rows.length === 0) {
        return res.status(400).json({ erro: 'highlightId não pertence a essa partida' })
      }
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
