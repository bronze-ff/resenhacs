import { Router } from 'express'
import { createRequireSuperAdmin } from '../auth/middleware.js'
import {
  presignDownload, iniciarMultipart, presignUploadPart, concluirMultipart,
  abortarMultipart, objetoExiste,
} from '../r2.js'

// Catálogo fixo do Curso de Mira — só existe este curso, então não há tabela de catálogo,
// só esta lista no código (ver Global Constraints do plano).
const CATALOGO = [
  { slug: 'introducao', titulo: 'Introdução' },
  { slug: 'modulo-1-aimbotz', titulo: 'Módulo 1 — AimBotz' },
  { slug: 'modulo-2-dm', titulo: 'Módulo 2 — Deathmatch' },
  { slug: 'modulo-3-mecanicas', titulo: 'Módulo 3 — Mecânicas' },
  { slug: 'consideracoes-finais', titulo: 'Considerações finais' },
]

function encontrarVideo(slug) {
  return CATALOGO.find((v) => v.slug === slug) ?? null
}

// ListParts pagina em 1000 por página; limitar aqui mantém concluirMultipart lendo uma página
// só — sem isso, partes além da primeira sumiriam silenciosamente do complete e o vídeo sairia
// truncado. 1000 partes × 100 MiB = 97 GiB de teto por arquivo, muito além de qualquer aula.
const MAX_PARTES = 1000

function chaveDo(slug) {
  return `curso-mira/${slug}.mp4`
}

// Toda rota de upload valida a mesma tripla: slug do catálogo, R2 configurado, uploadId
// presente. Recebe r2Client por parâmetro (ele vive no closure de createCursoRouter, não no
// request), e devolve null depois de já ter respondido o erro — quem chama só faz `if (!ok) return`.
function validarUpload(req, res, r2Client, { exigirUploadId = false } = {}) {
  const video = encontrarVideo(String(req.body?.slug ?? ''))
  if (!video) {
    res.status(404).json({ erro: 'Vídeo não encontrado' })
    return null
  }
  if (!r2Client) {
    res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })
    return null
  }
  const uploadId = String(req.body?.uploadId ?? '')
  if (exigirUploadId && !uploadId) {
    res.status(400).json({ erro: 'uploadId obrigatório' })
    return null
  }
  return { video, uploadId }
}

export function createCursoRouter({ db, requireAuth, r2Client, r2Bucket }) {
  const router = Router()
  const requireSuperAdmin = createRequireSuperAdmin(db)

  router.get('/', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      'select video_slug, concluido, posicao_segundos from curso_progresso where steam_id64 = $1',
      [req.player.steamId],
    )
    const progressoPorSlug = new Map(rows.map((r) => [r.video_slug, r]))
    const existencias = await Promise.all(
      CATALOGO.map((v) => (r2Client ? objetoExiste(r2Client, r2Bucket, chaveDo(v.slug)) : false)),
    )
    res.json(
      CATALOGO.map((v, i) => {
        const p = progressoPorSlug.get(v.slug)
        return {
          slug: v.slug,
          titulo: v.titulo,
          concluido: p?.concluido ?? false,
          posicaoSegundos: p?.posicao_segundos ?? 0,
          disponivel: existencias[i],
        }
      }),
    )
  })

  router.get('/:slug/url', requireAuth, async (req, res) => {
    const video = encontrarVideo(req.params.slug)
    if (!video) return res.status(404).json({ erro: 'Vídeo não encontrado' })
    if (!r2Client) return res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })
    const url = await presignDownload(r2Client, r2Bucket, chaveDo(video.slug), 7200)
    res.json({ url })
  })

  router.put('/:slug/progresso', requireAuth, async (req, res) => {
    const video = encontrarVideo(req.params.slug)
    if (!video) return res.status(404).json({ erro: 'Vídeo não encontrado' })
    const posicaoSegundos = Number(req.body?.posicaoSegundos ?? 0)
    const concluido = Boolean(req.body?.concluido)
    await db.query(
      `insert into curso_progresso (steam_id64, video_slug, posicao_segundos, concluido, atualizado_em)
       values ($1, $2, $3, $4, now())
       on conflict (steam_id64, video_slug)
       do update set posicao_segundos = $3, concluido = $4, atualizado_em = now()`,
      [req.player.steamId, video.slug, posicaoSegundos, concluido],
    )
    res.status(204).end()
  })

  router.post('/upload/iniciar', requireAuth, requireSuperAdmin, async (req, res) => {
    const ok = validarUpload(req, res, r2Client)
    if (!ok) return
    const partes = Number(req.body?.partes)
    if (!Number.isInteger(partes) || partes < 1 || partes > MAX_PARTES) {
      return res.status(400).json({ erro: 'Número de partes inválido' })
    }
    const key = chaveDo(ok.video.slug)
    const uploadId = await iniciarMultipart(r2Client, r2Bucket, key, 'video/mp4')
    const urls = await Promise.all(
      Array.from({ length: partes }, (_, i) =>
        presignUploadPart(r2Client, r2Bucket, key, uploadId, i + 1)),
    )
    res.json({ uploadId, urls })
  })

  router.post('/upload/concluir', requireAuth, requireSuperAdmin, async (req, res) => {
    const ok = validarUpload(req, res, r2Client, { exigirUploadId: true })
    if (!ok) return
    await concluirMultipart(r2Client, r2Bucket, chaveDo(ok.video.slug), ok.uploadId)
    res.status(204).end()
  })

  router.post('/upload/abortar', requireAuth, requireSuperAdmin, async (req, res) => {
    const ok = validarUpload(req, res, r2Client, { exigirUploadId: true })
    if (!ok) return
    await abortarMultipart(r2Client, r2Bucket, chaveDo(ok.video.slug), ok.uploadId)
    res.status(204).end()
  })

  return router
}
