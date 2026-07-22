import { Router } from 'express'
import { calcularPontuacao } from '../clipesScore.js'

// Webhook do Allstar (ADR-0004, docs/allstar/) — recebe o retorno assíncrono de um
// pedido de clipe (feito pelo Coletor em _gerar_clipes_allstar). Rota PÚBLICA (o
// Allstar não tem como autenticar como um Jogador nosso) — a segurança é o header
// Authorization batendo com o valor configurado no dashboard deles ("Webhook Auth"),
// sem isso qualquer um poderia forjar "clipe pronto" com uma URL maliciosa.
//
// Idempotente por design: eles reenviam o mesmo evento até receberem 2xx (até 8x,
// 15min entre tentativas) — um UPDATE por request_id não duplica nada em reenvio.
export function createAllstarRouter({ db, config }) {
  const router = Router()

  router.post('/webhook', async (req, res) => {
    if (!config.allstarWebhookAuth || req.get('Authorization') !== config.allstarWebhookAuth) {
      return res.status(401).json({ erro: 'Não autorizado' })
    }
    const { requestId, status, clipUrl, clipTitle, clipSnapshotURL, message, roundNumber } = req.body || {}
    if (!requestId) return res.status(400).json({ erro: 'requestId ausente' })

    // Pontuação nova (docs/superpowers/specs/2026-07-22-competicoes-clipes-design.md)
    // calculada UMA VEZ aqui, quando o clipe vira Processed, e gravada em
    // allstar_clips — nem `clipes.js` nem `competicoes.js` recalculam depois.
    // `allstar_clips` não guarda match_id/steam_id64/round_number direto (só
    // highlight_id) — busca via highlights, mesmo join já usado em matches.js.
    let pontuacaoTotal = null
    let pontuacaoDetalhe = null
    if (status === 'Processed') {
      const { rows: clipRows } = await db.query(
        `select h.match_id, h.steam_id64, h.round_number
         from allstar_clips ac
         join highlights h on h.id = ac.highlight_id
         where ac.request_id = $1`,
        [requestId],
      )
      const clip = clipRows[0]
      // roundNumber do próprio payload do webhook serve de fallback/override — se o
      // clipe não for encontrado (corrida rara entre insert e webhook), ainda dá pra
      // pontuar usando só o que veio no evento.
      const roundParaPontuar = roundNumber ?? clip?.round_number
      if (roundParaPontuar != null) {
        const { rows: kills } = await db.query(
          `select weapon, headshot from kill_positions
           where match_id = $1 and round_number = $2 and killer = $3`,
          [clip?.match_id ?? null, roundParaPontuar, clip?.steam_id64 ?? null],
        )
        const { rows: highlightRows } = await db.query(
          `select kind from highlights
           where match_id = $1 and steam_id64 = $2 and round_number = $3 and kind like 'clutch_%'
           limit 1`,
          [clip?.match_id ?? null, clip?.steam_id64 ?? null, roundParaPontuar],
        )
        const clutchKind = highlightRows[0]?.kind ? highlightRows[0].kind.replace('clutch_', '') : null
        const armasDistintas = new Set(kills.map((k) => k.weapon)).size
        const headshots = kills.filter((k) => k.headshot).length
        const resultado = calcularPontuacao({ kills: kills.length, headshots, clutchKind, armasDistintas })
        pontuacaoTotal = resultado.total
        pontuacaoDetalhe = resultado
      }
    }

    await db.query(
      `update allstar_clips set
         status = coalesce($2, status),
         clip_url = coalesce($3, clip_url),
         clip_title = coalesce($4, clip_title),
         clip_snapshot_url = coalesce($5, clip_snapshot_url),
         error_message = coalesce($6, error_message),
         pontuacao_total = coalesce($7, pontuacao_total),
         pontuacao_detalhe = coalesce($8, pontuacao_detalhe),
         updated_at = now()
       where request_id = $1`,
      [requestId, status ?? null, clipUrl ?? null, clipTitle ?? null, clipSnapshotURL ?? null, message ?? null,
        pontuacaoTotal, pontuacaoDetalhe ? JSON.stringify(pontuacaoDetalhe) : null],
    )
    // 2xx sempre, mesmo se o request_id não bater com nada gravado (evento de um
    // clipe que a gente nunca chegou a registrar não é erro do lado deles) — senão
    // eles ficam reenviando à toa por 2h (8 tentativas × 15min).
    res.json({ ok: true })
  })

  return router
}
