// site/server/src/routes/competicoes.js
// Aba Competições: o dono cria uma competição com prazo/prêmio/limites, jogadores
// enviam clipes já gerados (Allstar, status='Processed') pra competir. Leaderboard
// isolado por competição vem em task futura (não existe agregado nem na aba Clipes).
// Ver docs/superpowers/specs/2026-07-22-competicoes-clipes-design.md.
import { Router } from 'express'
import { createRequireSuperAdmin } from '../auth/middleware.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function mapCompeticao(c) {
  return {
    id: c.id, nome: c.nome, descricao: c.descricao, premioDescricao: c.premio_descricao,
    dataInicio: c.data_inicio, dataFim: c.data_fim,
    limiteDiario: c.limite_diario, limiteTotal: c.limite_total, minimoParaRankear: c.minimo_para_rankear,
    vencedorSteamId: c.vencedor_steam_id64,
  }
}

export function createCompeticoesRouter({ db, requireAuth }) {
  const router = Router()
  const requireSuperAdmin = createRequireSuperAdmin(db)

  router.get('/', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      `select id, nome, descricao, premio_descricao, data_inicio, data_fim,
              limite_diario, limite_total, minimo_para_rankear, vencedor_steam_id64
       from competicoes
       order by data_inicio desc`,
    )
    const agora = new Date()
    const ativa = rows.find((c) => new Date(c.data_inicio) <= agora && agora <= new Date(c.data_fim))
    const encerradas = rows.filter((c) => new Date(c.data_fim) < agora)
    res.json({
      ativa: ativa ? mapCompeticao(ativa) : null,
      encerradas: encerradas.map(mapCompeticao),
    })
  })

  // NOTA (Task 7): a spec e o plano pedem `limiteEstrito` (rate limiter dedicado) aqui
  // como defesa em profundidade — mas `site/server/src/rateLimit.js` só existe em
  // `main` (commit 510ff47, correção da auditoria de segurança), branch que este
  // worktree nunca recebeu, e `express-rate-limit` nem está nas dependências daqui.
  // Fora do escopo de arquivos desta task (routes/competicoes.js, test, app.js) portar
  // esse middleware. requireAuth + requireSuperAdmin (reconsulta is_super_admin no
  // banco a cada request) seguem aplicados, mesmo padrão de granadas.js/taticasCuradas.js.
  router.post('/admin', requireAuth, requireSuperAdmin, async (req, res) => {
    const { nome, descricao, premioDescricao, dataInicio, dataFim, limiteDiario, limiteTotal, minimoParaRankear } = req.body ?? {}
    if (!nome || !dataInicio || !dataFim) return res.status(400).json({ erro: 'nome, dataInicio e dataFim são obrigatórios' })
    if (new Date(dataFim) <= new Date(dataInicio)) return res.status(400).json({ erro: 'dataFim precisa ser depois de dataInicio' })
    const { rows } = await db.query(
      `insert into competicoes
         (nome, descricao, premio_descricao, data_inicio, data_fim, limite_diario, limite_total, minimo_para_rankear, criado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [nome, descricao ?? '', premioDescricao ?? '', dataInicio, dataFim,
        limiteDiario ?? 2, limiteTotal ?? 10, minimoParaRankear ?? 3, req.player.steamId],
    )
    res.status(201).json({ id: rows[0].id })
  })

  router.put('/admin/:id', requireAuth, requireSuperAdmin, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'competição não encontrada' })
    const { nome, descricao, premioDescricao, dataInicio, dataFim, limiteDiario, limiteTotal, minimoParaRankear } = req.body ?? {}
    if (dataInicio && dataFim && new Date(dataFim) <= new Date(dataInicio)) {
      return res.status(400).json({ erro: 'dataFim precisa ser depois de dataInicio' })
    }
    const { rows } = await db.query(
      `update competicoes set
         nome = coalesce($1, nome), descricao = coalesce($2, descricao),
         premio_descricao = coalesce($3, premio_descricao),
         data_inicio = coalesce($4, data_inicio), data_fim = coalesce($5, data_fim),
         limite_diario = coalesce($6, limite_diario), limite_total = coalesce($7, limite_total),
         minimo_para_rankear = coalesce($8, minimo_para_rankear)
       where id = $9
       returning id`,
      [nome, descricao, premioDescricao, dataInicio, dataFim, limiteDiario, limiteTotal, minimoParaRankear, req.params.id],
    )
    if (!rows.length) return res.status(404).json({ erro: 'competição não encontrada' })
    res.json({ ok: true })
  })

  return router
}
