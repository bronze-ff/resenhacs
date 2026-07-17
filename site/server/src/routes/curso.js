import { Router } from 'express'
import { requireSuperAdmin } from '../auth/middleware.js'
import { presignDownload, presignUpload } from '../r2.js'

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

export function createCursoRouter({ db, requireAuth, requireGroupMember, r2Client, r2Bucket }) {
  const router = Router()

  router.get('/', requireAuth, requireGroupMember, async (req, res) => {
    const { rows } = await db.query(
      'select video_slug, concluido, posicao_segundos from curso_progresso where steam_id64 = $1',
      [req.player.steamId],
    )
    const progressoPorSlug = new Map(rows.map((r) => [r.video_slug, r]))
    res.json(
      CATALOGO.map((v) => {
        const p = progressoPorSlug.get(v.slug)
        return {
          slug: v.slug,
          titulo: v.titulo,
          concluido: p?.concluido ?? false,
          posicaoSegundos: p?.posicao_segundos ?? 0,
        }
      }),
    )
  })

  router.get('/:slug/url', requireAuth, requireGroupMember, async (req, res) => {
    const video = encontrarVideo(req.params.slug)
    if (!video) return res.status(404).json({ erro: 'Vídeo não encontrado' })
    if (!r2Client) return res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })
    const url = await presignDownload(r2Client, r2Bucket, `curso-mira/${video.slug}.mp4`, 7200)
    res.json({ url })
  })

  router.put('/:slug/progresso', requireAuth, requireGroupMember, async (req, res) => {
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

  router.post('/upload-url', requireAuth, requireSuperAdmin, async (req, res) => {
    const video = encontrarVideo(String(req.body?.slug ?? ''))
    if (!video) return res.status(404).json({ erro: 'Vídeo não encontrado' })
    if (!r2Client) return res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })
    const uploadUrl = await presignUpload(r2Client, r2Bucket, `curso-mira/${video.slug}.mp4`, 'video/mp4')
    res.json({ uploadUrl })
  })

  return router
}
