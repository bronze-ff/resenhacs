import { Router } from 'express'
import crypto from 'node:crypto'
import { presignUpload } from '../r2.js'

const SHARE_CODE_RE = /^CSGO(-\S{5}){5}$/
// aceita datetime-local do browser ("2026-07-09T20:15") ou ISO completo com timezone
const PLAYED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/
// Sem integração oficial com essas plataformas (diferente de valve_mm/faceit, que a
// gente puxa automático) — é só um rótulo informativo que o próprio jogador escolhe.
const PLATAFORMAS_MANUAIS = new Set(['faceit', 'gamers_club', 'xplay_gg'])

// Upload manual de demo: o arquivo (100-300MB) sobe DIRETO pro R2 via URL
// pré-assinada — nunca passa pelo corpo da request na função serverless
// (limite de payload da Vercel, poucos MB, não aguentaria). Uma linha fica
// pendente em uploads_pendentes; o Coletor (GitHub Actions, a cada 30 min)
// baixa do R2 e processa. Mesmo padrão já usado pela fila de Partidas Pro
// (site/server/src/routes/partidasPro.js), mas aberto a qualquer jogador logado,
// não só super admin.
export function createUploadRouter({ db, requireAuth, r2Client, r2Bucket }) {
  const router = Router()

  router.post('/upload-url', requireAuth, async (req, res) => {
    if (!r2Client) return res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })

    const filename = String(req.body?.filename ?? '').trim()
    if (!filename.toLowerCase().endsWith('.dem')) {
      return res.status(400).json({ erro: 'Só arquivos .dem são aceitos (demos comprimidos .bz2/.gz ainda não)' })
    }
    const shareCode = String(req.body?.shareCode ?? '').trim()
    if (shareCode && !SHARE_CODE_RE.test(shareCode)) {
      return res.status(400).json({ erro: 'Share code inválido (formato CSGO-…-…-…-…-…)' })
    }
    const playedAt = String(req.body?.playedAt ?? '').trim()
    if (playedAt && !PLAYED_AT_RE.test(playedAt)) {
      return res.status(400).json({ erro: 'Data/hora inválida' })
    }
    const plataformaManual = String(req.body?.plataformaManual ?? '').trim()
    if (plataformaManual && !PLATAFORMAS_MANUAIS.has(plataformaManual)) {
      return res.status(400).json({ erro: 'Plataforma inválida' })
    }

    const key = `uploads-pendentes/${crypto.randomUUID()}.dem`
    const { rows } = await db.query(
      `insert into uploads_pendentes (adicionado_por, arquivo_r2_key, share_code, played_at, plataforma_manual)
       values ($1, $2, $3, $4, $5) returning id`,
      [req.player.steamId, key, shareCode || null, playedAt || null, plataformaManual || null],
    )
    const uploadUrl = await presignUpload(r2Client, r2Bucket, key, 'application/octet-stream')
    res.json({ id: rows[0].id, uploadUrl, key })
  })

  return router
}
