import { Router } from 'express'
import crypto from 'node:crypto'
import { presignUpload } from '../r2.js'
import { limiteEstrito } from '../rateLimit.js'

const SHARE_CODE_RE = /^CSGO(-\S{5}){5}$/
// aceita datetime-local do browser ("2026-07-09T20:15") ou ISO completo com timezone
const PLAYED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/
// Sem integração oficial com essas plataformas (diferente de valve_mm/faceit, que a
// gente puxa automático) — é só um rótulo informativo que o próprio jogador escolhe.
const PLATAFORMAS_MANUAIS = new Set(['faceit', 'gamers_club', 'xplay_gg'])

// Auditoria finding #2: nenhuma camada media o tamanho do .dem antes do upload. O PUT
// presignado atual (PutObjectCommand simples) não dá pra travar com uma condição real de
// Content-Length na assinatura — isso exigiria trocar pra createPresignedPost (upload via
// multipart/form-data), uma mudança de estratégia bem maior no cliente, que hoje faz um
// PUT binário direto do arquivo. `tamanho` aqui é só defesa em profundidade (feedback
// rápido pro usuário, fácil de burlar por quem edita o body manualmente); a barreira REAL
// fica no Coletor, que faz um head_object no R2 e recusa baixar acima do teto ANTES de
// carregar o arquivo inteiro pra memória (ver coletor/src/coletor/storage_r2.download_bytes
// e cmd_processar_uploads_pendentes em main.py).
const MAX_UPLOAD_BYTES = 400 * 1024 * 1024

// Upload manual de demo: o arquivo (100-300MB) sobe DIRETO pro R2 via URL
// pré-assinada — nunca passa pelo corpo da request na função serverless
// (limite de payload da Vercel, poucos MB, não aguentaria). Uma linha fica
// pendente em uploads_pendentes; o Coletor (GitHub Actions, a cada 30 min)
// baixa do R2 e processa. Mesmo padrão já usado pela fila de Partidas Pro
// (site/server/src/routes/partidasPro.js), mas aberto a qualquer jogador logado,
// não só super admin.
export function createUploadRouter({ db, requireAuth, r2Client, r2Bucket }) {
  const router = Router()

  router.post('/upload-url', limiteEstrito, requireAuth, async (req, res) => {
    if (!r2Client) return res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })

    const filename = String(req.body?.filename ?? '').trim()
    if (!filename.toLowerCase().endsWith('.dem')) {
      return res.status(400).json({ erro: 'Só arquivos .dem são aceitos (demos comprimidos .bz2/.gz ainda não)' })
    }
    // `tamanho` é opcional (compat com clientes antigos que não mandam) — quando vier,
    // barra cedo o caso óbvio; ver comentário de MAX_UPLOAD_BYTES acima sobre por que
    // isso não é a barreira de segurança de verdade.
    if (req.body?.tamanho !== undefined) {
      const tamanho = Number(req.body.tamanho)
      if (!Number.isFinite(tamanho) || tamanho <= 0) {
        return res.status(400).json({ erro: 'Tamanho de arquivo inválido' })
      }
      if (tamanho > MAX_UPLOAD_BYTES) {
        return res.status(400).json({ erro: `Arquivo excede o limite de ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB` })
      }
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
