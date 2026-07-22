// site/server/src/routes/competicoes.js
// Aba Competições: o dono cria uma competição com prazo/prêmio/limites, jogadores
// enviam clipes já gerados (Allstar, status='Processed') pra competir. Leaderboard
// isolado por competição vem em task futura (não existe agregado nem na aba Clipes).
// Ver docs/superpowers/specs/2026-07-22-competicoes-clipes-design.md.
import { Router } from 'express'
import { createRequireSuperAdmin } from '../auth/middleware.js'
import { limiteEstrito } from '../rateLimit.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// limiteDiario/limiteTotal/minimoParaRankear precisam ser inteiro positivo (ou omitido,
// pra manter o default/valor atual) — sem isso um admin (mal-intencionado ou por engano)
// grava negativo/fracionário e quebra silenciosamente a regra de negócio de elegibilidade
// de submissão em Task 8. `undefined` passa (campo não enviado); qualquer outra coisa que
// não seja inteiro >= 1 é rejeitada.
function inteiroPositivoOuIndefinido(v) {
  return v === undefined || (Number.isInteger(v) && v > 0)
}

function mapCompeticao(c) {
  return {
    id: c.id, nome: c.nome, descricao: c.descricao, premioDescricao: c.premio_descricao,
    dataInicio: c.data_inicio, dataFim: c.data_fim,
    limiteDiario: c.limite_diario, limiteTotal: c.limite_total, minimoParaRankear: c.minimo_para_rankear,
    vencedorSteamId: c.vencedor_steam_id64,
  }
}

// Leaderboard isolado por competição (Global Constraint do plano: nunca agregado entre
// competições nem na aba Clipes) — soma pontuacao_total das submissões só daquela
// competicao_id. `allstar_clips` não guarda match_id/steam_id64 direto (só
// highlight_id), então o join com match_players precisa passar por `highlights`
// primeiro, mesmo padrão já usado em routes/clipes.js e routes/allstar.js.
async function buscarLeaderboard(db, competicaoId, minimoParaRankear) {
  const { rows } = await db.query(
    `select cs.steam_id64, coalesce(p.nick, mp.nick) as nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url,
            sum(ac.pontuacao_total) as total, count(*) as qtd
     from competicao_submissoes cs join allstar_clips ac on ac.id = cs.allstar_clip_id
     join highlights h on h.id = ac.highlight_id
     left join players p on p.steam_id64 = cs.steam_id64
     left join match_players mp on mp.match_id = h.match_id and mp.steam_id64 = cs.steam_id64
     left join steam_avatares sa on sa.steam_id64 = cs.steam_id64
     where cs.competicao_id = $1
     group by cs.steam_id64, p.nick, mp.nick, p.avatar_url, sa.avatar_url`,
    [competicaoId],
  )
  const leaderboard = rows.map((r) => ({
    steamId: r.steam_id64, nick: r.nick, avatarUrl: r.avatar_url,
    total: Number(r.total), qualificado: Number(r.qtd) >= minimoParaRankear,
  }))
  leaderboard.sort((a, b) => b.total - a.total)
  return leaderboard
}

// Vencedor só é decidido depois que a competição encerra (data_fim já passou) — antes
// disso devolve null, mesmo que já exista alguém na frente (pode mudar até o fim). Uma
// vez calculado, grava em competicoes.vencedor_steam_id64 (só se ainda não tiver um,
// pra não sobrescrever um valor já fixado por reprocessamento futuro).
async function calcularOuLerVencedor(db, comp) {
  if (comp.vencedor_steam_id64 || new Date() <= new Date(comp.data_fim)) return comp.vencedor_steam_id64
  const leaderboard = await buscarLeaderboard(db, comp.id, comp.minimo_para_rankear)
  const qualificados = leaderboard.filter((l) => l.qualificado)
  if (!qualificados.length) return null
  const vencedor = qualificados[0].steamId
  await db.query('update competicoes set vencedor_steam_id64 = $1 where id = $2 and vencedor_steam_id64 is null', [vencedor, comp.id])
  return vencedor
}

// Clipes enviados recentemente pra competição (Task 12) — separado do leaderboard
// porque mostra a atividade recente independente de qualificação, sem agregar nada
// entre competições (mesma regra global: leaderboard/atividade sempre por competicao_id).
// `allstar_clips` não guarda match_id direto (só highlight_id) — junta com `highlights`,
// mesmo padrão já usado em buscarLeaderboard acima e em routes/clipes.js.
async function buscarClipesRecentes(db, competicaoId) {
  const { rows } = await db.query(
    `select ac.id, ac.clip_url, ac.clip_snapshot_url, ac.pontuacao_total, ac.pontuacao_detalhe,
            cs.steam_id64, coalesce(p.nick, mp.nick) as nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url,
            cs.enviado_em
     from competicao_submissoes cs
     join allstar_clips ac on ac.id = cs.allstar_clip_id
     join highlights h on h.id = ac.highlight_id
     left join players p on p.steam_id64 = cs.steam_id64
     left join match_players mp on mp.match_id = h.match_id and mp.steam_id64 = cs.steam_id64
     left join steam_avatares sa on sa.steam_id64 = cs.steam_id64
     where cs.competicao_id = $1
     order by cs.enviado_em desc
     limit 20`,
    [competicaoId],
  )
  return rows.map((r) => ({
    id: r.id, clipUrl: r.clip_url, clipSnapshotUrl: r.clip_snapshot_url,
    steamId: r.steam_id64, nick: r.nick, avatarUrl: r.avatar_url,
    pontuacao: r.pontuacao_detalhe ?? { total: r.pontuacao_total ?? 0 },
  }))
}

export function createCompeticoesRouter({ db, requireAuth }) {
  const router = Router()
  const requireSuperAdmin = createRequireSuperAdmin(db)

  router.get('/', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      `select id, nome, descricao, premio_descricao, data_inicio, data_fim,
              limite_diario, limite_total, minimo_para_rankear, vencedor_steam_id64, tradelink_vencedor
       from competicoes
       order by data_inicio desc`,
    )
    const agora = new Date()
    async function montar(c) {
      const vencedorSteamId = await calcularOuLerVencedor(db, c)
      const leaderboard = await buscarLeaderboard(db, c.id, c.minimo_para_rankear)
      const clipesRecentes = await buscarClipesRecentes(db, c.id)
      const ehVencedorOuAdmin = req.player.steamId === vencedorSteamId || req.player.isSuperAdmin
      return {
        ...mapCompeticao({ ...c, vencedor_steam_id64: vencedorSteamId }),
        leaderboard,
        clipesRecentes,
        // #6/#12 da auditoria: tradelink só aparece pro próprio vencedor ou admin —
        // omitido da resposta (não só escondido no client) pra qualquer outro jogador.
        ...(ehVencedorOuAdmin ? { tradelinkVencedor: c.tradelink_vencedor } : {}),
      }
    }
    const ativa = rows.find((c) => new Date(c.data_inicio) <= agora && agora <= new Date(c.data_fim))
    // Achado do review final: uma competicao com data_inicio no futuro nao caia em
    // `ativa` nem em `encerradas` - sem este terceiro balde ela simplesmente sumia da
    // resposta, inclusive pro admin que acabou de cria-la (Admin.jsx so mostra
    // [ativa, ...encerradas]). "Agendada" resolve isso.
    const agendadas = rows.filter((c) => new Date(c.data_inicio) > agora)
    const encerradas = rows.filter((c) => new Date(c.data_fim) < agora)
    res.json({
      ativa: ativa ? await montar(ativa) : null,
      agendadas: await Promise.all(agendadas.map(montar)),
      encerradas: await Promise.all(encerradas.map(montar)),
    })
  })

  // #9 da auditoria (rate limiting como defesa em profundidade, além da regra de
  // negócio de limite diário/total) e #11 da spec (submissões também precisam do
  // limite estrito, não só as rotas de admin) - site/server/src/rateLimit.js.
  router.post('/admin', limiteEstrito, requireAuth, requireSuperAdmin, async (req, res) => {
    const { nome, descricao, premioDescricao, dataInicio, dataFim, limiteDiario, limiteTotal, minimoParaRankear } = req.body ?? {}
    if (!nome || !dataInicio || !dataFim) return res.status(400).json({ erro: 'nome, dataInicio e dataFim são obrigatórios' })
    if (new Date(dataFim) <= new Date(dataInicio)) return res.status(400).json({ erro: 'dataFim precisa ser depois de dataInicio' })
    if (!inteiroPositivoOuIndefinido(limiteDiario) || !inteiroPositivoOuIndefinido(limiteTotal) || !inteiroPositivoOuIndefinido(minimoParaRankear)) {
      return res.status(400).json({ erro: 'limiteDiario, limiteTotal e minimoParaRankear precisam ser inteiros positivos' })
    }
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

  router.put('/admin/:id', limiteEstrito, requireAuth, requireSuperAdmin, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'competição não encontrada' })
    const { nome, descricao, premioDescricao, dataInicio, dataFim, limiteDiario, limiteTotal, minimoParaRankear } = req.body ?? {}
    if (!inteiroPositivoOuIndefinido(limiteDiario) || !inteiroPositivoOuIndefinido(limiteTotal) || !inteiroPositivoOuIndefinido(minimoParaRankear)) {
      return res.status(400).json({ erro: 'limiteDiario, limiteTotal e minimoParaRankear precisam ser inteiros positivos' })
    }
    // Update parcial: quando só dataInicio OU só dataFim vem no body, precisa validar
    // contra a data já gravada. Sem isso, um PUT que move só dataFim pra antes do
    // data_inicio existente pulava a checagem de app inteira e só era barrado pelo CHECK
    // `periodo_valido` da migration 0047 lá no banco — 500 cru em vez de 400 limpo.
    if (dataInicio || dataFim) {
      let inicioEfetivo = dataInicio
      let fimEfetivo = dataFim
      if (!dataInicio || !dataFim) {
        const { rows: atuais } = await db.query(
          `select data_inicio, data_fim from competicoes where id = $1`,
          [req.params.id],
        )
        if (!atuais.length) return res.status(404).json({ erro: 'competição não encontrada' })
        inicioEfetivo = dataInicio ?? atuais[0].data_inicio
        fimEfetivo = dataFim ?? atuais[0].data_fim
      }
      if (new Date(fimEfetivo) <= new Date(inicioEfetivo)) {
        return res.status(400).json({ erro: 'dataFim precisa ser depois de dataInicio' })
      }
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

  router.get('/:id/elegiveis', requireAuth, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'competição não encontrada' })
    const { rows: compRows } = await db.query(
      'select id, data_inicio, data_fim from competicoes where id = $1',
      [req.params.id],
    )
    if (!compRows.length) return res.status(404).json({ erro: 'competição não encontrada' })
    const comp = compRows[0]
    // allstar_clips não guarda match_id/steam_id64/round_number direto (só
    // highlight_id) — junta com highlights e matches, mesmo padrão já usado em
    // routes/allstar.js, routes/clipes.js e backfillPontuacao.js.
    const { rows } = await db.query(
      `select ac.id, h.match_id, h.round_number, ac.pontuacao_total, ac.pontuacao_detalhe,
              m.map,
              exists (select 1 from competicao_submissoes cs where cs.competicao_id = $1 and cs.allstar_clip_id = ac.id) as ja_enviado
       from allstar_clips ac
       join highlights h on h.id = ac.highlight_id
       join matches m on m.id = h.match_id
       where h.steam_id64 = $2 and ac.status = 'Processed'
         and m.played_at >= $3 and m.played_at <= $4
       order by m.played_at desc`,
      [comp.id, req.player.steamId, comp.data_inicio, comp.data_fim],
    )
    res.json(rows.map((r) => ({
      allstarClipId: r.id, matchId: r.match_id, roundNumber: r.round_number,
      map: r.map, pontuacao: r.pontuacao_detalhe ?? { total: r.pontuacao_total ?? 0 },
      jaEnviado: r.ja_enviado,
    })))
  })

  router.post('/:id/submissoes', limiteEstrito, requireAuth, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'competição não encontrada' })
    const allstarClipId = String(req.body?.allstarClipId ?? '')
    if (!UUID_RE.test(allstarClipId)) return res.status(400).json({ erro: 'allstarClipId inválido' })

    const { rows: compRows } = await db.query(
      'select id, data_inicio, data_fim, limite_diario, limite_total from competicoes where id = $1',
      [req.params.id],
    )
    if (!compRows.length) return res.status(404).json({ erro: 'competição não encontrada' })
    const comp = compRows[0]
    if (new Date() > new Date(comp.data_fim)) return res.status(400).json({ erro: 'essa competição já encerrou' })

    // #5 da auditoria (IDOR): só aceita clipe cujo steam_id64 (via highlights —
    // allstar_clips não guarda direto) é o do próprio req.player — nunca confia num
    // allstarClipId de outro jogador só porque o body mandou o id.
    const { rows: clipRows } = await db.query(
      `select ac.id, h.steam_id64, ac.status, m.played_at
       from allstar_clips ac
       join highlights h on h.id = ac.highlight_id
       join matches m on m.id = h.match_id
       where ac.id = $1 and h.steam_id64 = $2 and ac.status = 'Processed'`,
      [allstarClipId, req.player.steamId],
    )
    if (!clipRows.length) return res.status(404).json({ erro: 'clipe não encontrado' })
    const clip = clipRows[0]
    if (new Date(clip.played_at) < new Date(comp.data_inicio) || new Date(clip.played_at) > new Date(comp.data_fim)) {
      return res.status(400).json({ erro: 'a partida desse clipe está fora do período da competição' })
    }

    const { rows: contagemRows } = await db.query(
      `select
         count(*) filter (where enviado_em::date = now()::date) as hoje,
         count(*) as total
       from competicao_submissoes
       where competicao_id = $1 and steam_id64 = $2`,
      [comp.id, req.player.steamId],
    )
    const { hoje, total } = contagemRows[0]
    if (Number(hoje) >= comp.limite_diario) return res.status(400).json({ erro: `limite diário de ${comp.limite_diario} clipes atingido` })
    if (Number(total) >= comp.limite_total) return res.status(400).json({ erro: `limite total de ${comp.limite_total} clipes atingido` })

    await db.query(
      'insert into competicao_submissoes (competicao_id, allstar_clip_id, steam_id64) values ($1, $2, $3) on conflict do nothing',
      [comp.id, allstarClipId, req.player.steamId],
    )
    res.json({ ok: true })
  })

  router.put('/:id/tradelink', requireAuth, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'competição não encontrada' })
    const { rows } = await db.query('select id, data_fim, vencedor_steam_id64 from competicoes where id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ erro: 'competição não encontrada' })
    const comp = rows[0]
    if (new Date() <= new Date(comp.data_fim)) return res.status(400).json({ erro: 'a competição ainda não encerrou' })
    if (req.player.steamId !== comp.vencedor_steam_id64) return res.status(403).json({ erro: 'só o vencedor pode informar o tradelink' })
    const tradelink = String(req.body?.tradelink ?? '').trim()
    if (!tradelink) return res.status(400).json({ erro: 'tradelink obrigatório' })
    await db.query('update competicoes set tradelink_vencedor = $1 where id = $2', [tradelink, req.params.id])
    res.json({ ok: true })
  })

  return router
}
