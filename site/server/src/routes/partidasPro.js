import crypto from 'node:crypto'
import { Router } from 'express'
import { createRequireSuperAdmin } from '../auth/middleware.js'
import { presignUpload } from '../r2.js'

const EXTENSOES_ACEITAS = ['.rar', '.dem']

export function createPartidasProRouter({ db, requireAuth, r2Client, r2Bucket }) {
  const router = Router()
  const requireSuperAdmin = createRequireSuperAdmin(db)

  router.get('/', requireAuth, requireSuperAdmin, async (req, res) => {
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

  router.post('/', requireAuth, requireSuperAdmin, async (req, res) => {
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

  router.post('/upload-url', requireAuth, requireSuperAdmin, async (req, res) => {
    const filename = String(req.body?.filename ?? '').trim()
    const extensao = filename.slice(filename.lastIndexOf('.')).toLowerCase()
    if (!filename || !EXTENSOES_ACEITAS.includes(extensao)) {
      return res.status(400).json({ erro: 'arquivo deve ser .rar ou .dem' })
    }

    const key = `partidas-pro-pendentes/${crypto.randomUUID()}${extensao}`
    const { rows } = await db.query(
      'insert into partidas_pro_fila (arquivo_r2_key, adicionado_por) values ($1, $2) returning id',
      [key, req.player.steamId],
    )
    const uploadUrl = await presignUpload(r2Client, r2Bucket, key, 'application/octet-stream')
    res.json({ id: rows[0].id, uploadUrl, key })
  })

  router.patch('/:id/retry', requireAuth, requireSuperAdmin, async (req, res) => {
    const { rows } = await db.query(
      "update partidas_pro_fila set status = 'pendente', erro = null where id = $1 and status = 'falhou' returning id",
      [req.params.id],
    )
    if (rows.length === 0) {
      return res.status(404).json({ erro: 'item não encontrado ou não está com status falhou' })
    }
    res.json({ ok: true, status: 'pendente' })
  })

  return router
}
