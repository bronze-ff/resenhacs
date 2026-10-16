import { Router } from 'express'
import { validarQuadro, LIMITES } from '../quadroValidacao.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Quadro visível ao viewer ($1): é dele, OU é público no grupo e o dono é amigo accepted.
// `q` é o alias de quadros_taticos na query.
const VISIVEL = `(q.criado_por = $1 or (q.publico_no_grupo and exists (
  select 1 from friendships f
  where f.status = 'accepted'
    and ((f.player_a = $1 and f.player_b = q.criado_por)
      or (f.player_b = $1 and f.player_a = q.criado_por)))))`

function resumo(r, eu) {
  return {
    id: r.id,
    nome: r.nome,
    map: r.map,
    lado: r.lado,
    publicoNoGrupo: r.publico_no_grupo,
    criadoPor: r.criado_por,
    criadoPorNick: r.criado_por_nick ?? null,
    meu: r.criado_por === eu,
    qtdPassos: Number(r.qtd_passos ?? (Array.isArray(r.passos) ? r.passos.length : 0)),
    updatedAt: r.updated_at,
  }
}

// Quadro tático (Biblioteca). Dono cria/edita/exclui; amigos accepted só leem os
// marcados como públicos no grupo.
export function createQuadrosRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const eu = req.player.steamId
    const params = [eu]
    let filtroMapa = ''
    const map = typeof req.query.map === 'string' ? req.query.map : ''
    if (/^de_[a-z0-9_]{1,30}$/.test(map)) {
      params.push(map)
      filtroMapa = ` and q.map = $${params.length}`
    }
    const { rows } = await db.query(
      `select q.id, q.nome, q.map, q.lado, q.publico_no_grupo, q.criado_por, q.updated_at,
              jsonb_array_length(q.passos) as qtd_passos, p.nick as criado_por_nick
       from quadros_taticos q
       left join players p on p.steam_id64 = q.criado_por
       where ${VISIVEL}${filtroMapa}
       order by q.updated_at desc
       limit 200`,
      params,
    )
    res.json(rows.map((r) => resumo(r, eu)))
  })

  router.get('/:id', requireAuth, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'Quadro não encontrado' })
    const eu = req.player.steamId
    const { rows } = await db.query(
      `select q.id, q.nome, q.map, q.lado, q.descricao, q.passos, q.publico_no_grupo,
              q.criado_por, q.created_at, q.updated_at, p.nick as criado_por_nick
       from quadros_taticos q
       left join players p on p.steam_id64 = q.criado_por
       where q.id = $2 and ${VISIVEL}`,
      [eu, req.params.id],
    )
    const r = rows[0]
    if (!r) return res.status(404).json({ erro: 'Quadro não encontrado' })
    res.json({ ...resumo(r, eu), descricao: r.descricao ?? '', passos: r.passos, createdAt: r.created_at })
  })

  router.post('/', requireAuth, async (req, res) => {
    const v = validarQuadro(req.body)
    if (v.erro) return res.status(400).json({ erro: v.erro })
    const eu = req.player.steamId
    const conta = await db.query('select count(*)::int as n from quadros_taticos where criado_por = $1', [eu])
    if ((conta.rows[0]?.n ?? 0) >= LIMITES.quadrosPorJogador) {
      return res.status(400).json({ erro: `Limite de ${LIMITES.quadrosPorJogador} quadros por jogador` })
    }
    const q = v.quadro
    const { rows } = await db.query(
      `insert into quadros_taticos (criado_por, map, lado, nome, descricao, passos, publico_no_grupo)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7)
       returning id`,
      [eu, q.map, q.lado, q.nome, q.descricao, JSON.stringify(q.passos), q.publicoNoGrupo],
    )
    res.status(201).json({ id: rows[0].id })
  })

  router.put('/:id', requireAuth, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'Quadro não encontrado' })
    const v = validarQuadro(req.body)
    if (v.erro) return res.status(400).json({ erro: v.erro })
    const q = v.quadro
    // Só o dono: o `criado_por = $2` no where faz um quadro alheio cair no 404.
    const { rows } = await db.query(
      `update quadros_taticos
       set map = $3, lado = $4, nome = $5, descricao = $6, passos = $7::jsonb,
           publico_no_grupo = $8, updated_at = now()
       where id = $1 and criado_por = $2
       returning id`,
      [req.params.id, req.player.steamId, q.map, q.lado, q.nome, q.descricao, JSON.stringify(q.passos), q.publicoNoGrupo],
    )
    if (rows.length === 0) return res.status(404).json({ erro: 'Quadro não encontrado' })
    res.json({ id: rows[0].id })
  })

  router.delete('/:id', requireAuth, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'Quadro não encontrado' })
    const { rows } = await db.query(
      'delete from quadros_taticos where id = $1 and criado_por = $2 returning id',
      [req.params.id, req.player.steamId],
    )
    if (rows.length === 0) return res.status(404).json({ erro: 'Quadro não encontrado' })
    res.status(204).end()
  })

  return router
}
