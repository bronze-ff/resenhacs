import { Router } from 'express'
import { requireAdmin } from '../auth/middleware.js'

export function createPartidasProRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, requireAdmin, async (req, res) => {
    const { rows } = await db.query(
      'select id, hltv_url, status, match_id, match_ids, erro, adicionado_por, adicionado_em from partidas_pro_fila order by adicionado_em desc',
    )
    res.json(
      rows.map((f) => ({
        id: f.id, hltvUrl: f.hltv_url, status: f.status,
        matchId: f.match_id, matchIds: f.match_ids ?? [],
        erro: f.erro,
        adicionadoPor: f.adicionado_por, adicionadoEm: f.adicionado_em,
      })),
    )
  })

  router.post('/', requireAuth, requireAdmin, async (req, res) => {
    const hltvUrl = String(req.body?.hltvUrl ?? '').trim()
    if (!/^https:\/\/.+/.test(hltvUrl)) {
      return res.status(400).json({ erro: 'hltvUrl deve ser um link válido' })
    }
    const { rows } = await db.query(
      'insert into partidas_pro_fila (hltv_url, adicionado_por) values ($1, $2) returning id',
      [hltvUrl, req.player.steamId],
    )
    res.status(201).json({ id: rows[0].id, status: 'pendente' })
  })

  return router
}
