import { Router } from 'express'
import { requireAdmin } from '../auth/middleware.js'

const LADOS = new Set(['T', 'CT'])
const TIPOS = new Set(['smoke', 'flash', 'he', 'molotov'])
const TECNICAS = new Set(['normal', 'jumpthrow', 'walkthrow', 'runthrow', 'run_jumpthrow'])
const BOTOES = new Set(['esquerdo', 'direito', 'esquerdo_direito'])
const MAP_RE = /^[a-z0-9_]+$/
const YOUTUBE_RE = /^https:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[A-Za-z0-9_-]{11}([&?#].*)?$/

function paraCamel(l) {
  return {
    id: l.id, map: l.map, lado: l.lado, tipo: l.tipo, titulo: l.titulo,
    descricao: l.descricao, videoUrl: l.video_url, tecnica: l.tecnica, botao: l.botao,
    passos: l.passos ?? [],
    arremessoX: Number(l.arremesso_x), arremessoY: Number(l.arremesso_y),
    alvoX: Number(l.alvo_x), alvoY: Number(l.alvo_y),
    criadoPor: l.criado_por, criadoEm: l.criado_em,
  }
}

function pos01(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null
}

// Valida o corpo de POST/PATCH; devolve {erro} ou {valores} prontos pra query.
function validarCorpo(body) {
  const map = String(body?.map ?? '')
  const lado = String(body?.lado ?? '')
  const tipo = String(body?.tipo ?? '')
  const titulo = String(body?.titulo ?? '').trim()
  const descricao = String(body?.descricao ?? '').trim() || null
  const videoUrl = String(body?.videoUrl ?? '').trim() || null
  const tecnica = String(body?.tecnica ?? 'normal')
  const botao = String(body?.botao ?? 'esquerdo')
  const passos = Array.isArray(body?.passos) ? body.passos.map(String).filter((p) => p.trim()) : null

  if (!MAP_RE.test(map)) return { erro: 'mapa inválido' }
  if (!LADOS.has(lado)) return { erro: 'lado deve ser T ou CT' }
  if (!TIPOS.has(tipo)) return { erro: 'tipo inválido' }
  if (!titulo) return { erro: 'título é obrigatório' }
  if (videoUrl && !YOUTUBE_RE.test(videoUrl)) return { erro: 'vídeo precisa ser um link do YouTube' }
  if (!TECNICAS.has(tecnica)) return { erro: 'técnica inválida' }
  if (!BOTOES.has(botao)) return { erro: 'botão inválido' }
  if (passos === null) return { erro: 'passos deve ser uma lista' }
  const arremessoX = pos01(body?.arremessoX)
  const arremessoY = pos01(body?.arremessoY)
  const alvoX = pos01(body?.alvoX)
  const alvoY = pos01(body?.alvoY)
  if ([arremessoX, arremessoY, alvoX, alvoY].some((v) => v === null)) {
    return { erro: 'posições precisam estar entre 0 e 1' }
  }
  return {
    valores: { map, lado, tipo, titulo, descricao, videoUrl, tecnica, botao, passos,
      arremessoX, arremessoY, alvoX, alvoY },
  }
}

export function createGranadasRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const cond = []
    const params = []
    const { map, lado, tipo } = req.query
    if (map && MAP_RE.test(map)) {
      params.push(map)
      cond.push(`map = $${params.length}`)
    }
    if (lado && LADOS.has(lado)) {
      params.push(lado)
      cond.push(`lado = $${params.length}`)
    }
    if (tipo && TIPOS.has(tipo)) {
      params.push(tipo)
      cond.push(`tipo = $${params.length}`)
    }
    const where = cond.length ? `where ${cond.join(' and ')}` : ''
    const { rows } = await db.query(
      `select id, map, lado, tipo, titulo, descricao, video_url, tecnica, botao, passos,
              arremesso_x, arremesso_y, alvo_x, alvo_y, criado_por, criado_em
       from lineups_curados ${where} order by criado_em desc limit 500`,
      params,
    )
    res.json(rows.map(paraCamel))
  })

  router.get('/contagem', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      'select map, tipo, count(*) as total from lineups_curados group by map, tipo',
    )
    res.json(rows.map((r) => ({ map: r.map, tipo: r.tipo, total: Number(r.total) })))
  })

  // Agrega a tabela auto-extraída (lineups) por célula de queda (grade de 1/40) pra
  // mostrar ao admin as granadas mais usadas de verdade nas demos (grupo e pro).
  router.get('/sugestoes', requireAuth, requireAdmin, async (req, res) => {
    const map = String(req.query?.map ?? '')
    if (!MAP_RE.test(map)) return res.status(400).json({ erro: 'map é obrigatório' })
    const { rows } = await db.query(
      `select tipo, origem, lado, count(*) as total,
              round(avg(target_x)::numeric, 3) as alvo_x,
              round(avg(target_y)::numeric, 3) as alvo_y,
              round(avg(thrower_x)::numeric, 3) as arremesso_x,
              round(avg(thrower_y)::numeric, 3) as arremesso_y
       from lineups
       where map = $1
       group by tipo, origem, lado, round(target_x::numeric * 40), round(target_y::numeric * 40)
       order by total desc
       limit 50`,
      [map],
    )
    res.json(rows.map((r) => ({
      tipo: r.tipo, origem: r.origem, lado: r.lado, total: Number(r.total),
      alvoX: Number(r.alvo_x), alvoY: Number(r.alvo_y),
      arremessoX: Number(r.arremesso_x), arremessoY: Number(r.arremesso_y),
    })))
  })

  router.post('/', requireAuth, requireAdmin, async (req, res) => {
    const { erro, valores } = validarCorpo(req.body)
    if (erro) return res.status(400).json({ erro })
    const v = valores
    const { rows } = await db.query(
      `insert into lineups_curados
         (map, lado, tipo, titulo, descricao, video_url, tecnica, botao, passos,
          arremesso_x, arremesso_y, alvo_x, alvo_y, criado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14)
       returning id`,
      [v.map, v.lado, v.tipo, v.titulo, v.descricao, v.videoUrl, v.tecnica, v.botao,
        JSON.stringify(v.passos), v.arremessoX, v.arremessoY, v.alvoX, v.alvoY,
        req.player.steamId],
    )
    res.status(201).json({ id: rows[0].id })
  })

  router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
    const { erro, valores } = validarCorpo(req.body)
    if (erro) return res.status(400).json({ erro })
    const v = valores
    const { rows } = await db.query(
      `update lineups_curados
       set map = $1, lado = $2, tipo = $3, titulo = $4, descricao = $5, video_url = $6,
           tecnica = $7, botao = $8, passos = $9::jsonb,
           arremesso_x = $10, arremesso_y = $11, alvo_x = $12, alvo_y = $13,
           atualizado_em = now()
       where id = $14
       returning id`,
      [v.map, v.lado, v.tipo, v.titulo, v.descricao, v.videoUrl, v.tecnica, v.botao,
        JSON.stringify(v.passos), v.arremessoX, v.arremessoY, v.alvoX, v.alvoY,
        req.params.id],
    )
    if (!rows.length) return res.status(404).json({ erro: 'granada não encontrada' })
    res.json({ ok: true })
  })

  router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
    const { rows } = await db.query(
      'delete from lineups_curados where id = $1 returning id',
      [req.params.id],
    )
    if (!rows.length) return res.status(404).json({ erro: 'granada não encontrada' })
    res.json({ ok: true })
  })

  return router
}
