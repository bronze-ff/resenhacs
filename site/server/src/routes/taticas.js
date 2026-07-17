import { Router } from 'express'
import { requireSuperAdmin } from '../auth/middleware.js'

export function createTaticasRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, requireSuperAdmin, async (req, res) => {
    const cond = ["status = 'aprovada'"]
    const params = []
    const { map, status } = req.query
    if (map && /^[a-z0-9_]+$/.test(map)) {
      params.push(map)
      cond.push(`map = $${params.length}`)
    }
    if (status === 'sugerida' || status === 'aprovada' || status === 'rejeitada') {
      cond[0] = `status = $${params.length + 1}`
      params.push(status)
    }
    const { rows } = await db.query(
      `select t.id, t.nome, t.descricao, t.map, t.match_id, t.round_number, t.status,
              t.criado_por, t.criado_em, p.nick as criado_por_nick
       from taticas t
       left join players p on p.steam_id64 = t.criado_por
       where ${cond.join(' and ')}
       order by t.criado_em desc limit 200`,
      params,
    )
    res.json(
      rows.map((t) => ({
        id: t.id, nome: t.nome, descricao: t.descricao, map: t.map,
        matchId: t.match_id, roundNumber: t.round_number, status: t.status,
        criadoPor: t.criado_por, criadoPorNick: t.criado_por_nick, criadoEm: t.criado_em,
      })),
    )
  })

  router.post('/', requireAuth, async (req, res) => {
    const nome = String(req.body?.nome ?? '').trim()
    const map = String(req.body?.map ?? '').trim()
    const matchId = String(req.body?.matchId ?? '').trim()
    const roundNumber = Number(req.body?.roundNumber)
    if (!nome || !map || !matchId || !Number.isInteger(roundNumber)) {
      return res.status(400).json({ erro: 'nome, map, matchId e roundNumber são obrigatórios' })
    }
    // Caixa de sugestões global (só super-admin lê): valida formato e limita tamanho pra não
    // virar canal de spam/poluição na fila de revisão do admin.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(matchId)) {
      return res.status(400).json({ erro: 'matchId inválido' })
    }
    if (nome.length > 120) return res.status(400).json({ erro: 'nome muito longo' })
    const descricao = String(req.body?.descricao ?? '').trim().slice(0, 2000)
    const { rows } = await db.query(
      `insert into taticas (nome, descricao, map, match_id, round_number, status, criado_por)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [nome, descricao, map, matchId, roundNumber, 'sugerida', req.player.steamId],
    )
    res.status(201).json({ id: rows[0].id, status: 'sugerida' })
  })

  router.patch('/:id', requireAuth, requireSuperAdmin, async (req, res) => {
    const status = req.body?.status
    if (status !== 'aprovada' && status !== 'rejeitada') {
      return res.status(400).json({ erro: 'status deve ser aprovada ou rejeitada' })
    }
    await db.query('update taticas set status = $1 where id = $2', [status, req.params.id])
    res.json({ ok: true, status })
  })

  return router
}
