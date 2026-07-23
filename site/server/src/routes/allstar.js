import { Router } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { calcularPontuacao } from '../clipesScore.js'
import { limiteEstrito } from '../rateLimit.js'
import { parseHttpUrl, hostMatchesDomain } from './urlValidation.js'

// Webhook do Allstar (ADR-0004, docs/allstar/) — recebe o retorno assíncrono de um
// pedido de clipe (POST /:id/jogador/:steamId/clipe em routes/matches.js, via
// allstarClip.js). Rota PÚBLICA (o Allstar não tem como autenticar como um Jogador
// nosso) — a segurança é o header
// Authorization batendo com o valor configurado no dashboard deles ("Webhook Auth"),
// sem isso qualquer um poderia forjar "clipe pronto" com uma URL maliciosa.
//
// Idempotente por design: eles reenviam o mesmo evento até receberem 2xx (até 8x,
// 15min entre tentativas) — um UPDATE por request_id não duplica nada em reenvio.

// finding #15: comparar o header direto com "!==" vaza timing (quanto mais prefixo
// bate, mais rápido a comparação de string curto-circuita) — dá pra descobrir o
// segredo char a char por timing attack. timingSafeEqual precisa dos dois buffers do
// MESMO tamanho (senão lança), por isso a checagem de length ANTES de chamar.
function autorizacaoValida(recebido, esperado) {
  if (!esperado || !recebido) return false
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// finding #5: o payload do webhook não é assinado, só o header Authorization é
// checado — nada impede o Allstar (ou quem forjar a origem, já que a checagem acima é
// só um secret compartilhado) de mandar clip_url/clip_snapshot_url apontando pra fora
// do domínio deles. Como o client renderiza esse link direto, uma URL fora da allowlist
// vazaria como se fosse um clipe "oficial" (phishing/XSS armazenado clicável). Mesma
// lógica de host que clips.js usa pro link que o Jogador cola.
const ALLSTAR_HOST = 'allstar.gg'
function urlDoAllstar(url) {
  const parsed = parseHttpUrl(url)
  return !!parsed && hostMatchesDomain(parsed.hostname, ALLSTAR_HOST)
}

export function createAllstarRouter({ db, config }) {
  const router = Router()

  router.post('/webhook', limiteEstrito, async (req, res) => {
    if (!autorizacaoValida(req.get('Authorization'), config.allstarWebhookAuth)) {
      return res.status(401).json({ erro: 'Não autorizado' })
    }
    const { requestId, status, clipUrl, clipTitle, clipSnapshotURL, message, roundNumber } = req.body || {}
    if (!requestId) return res.status(400).json({ erro: 'requestId ausente' })

    // Descarta só o campo com URL fora da allowlist (vira null → coalesce mantém o
    // valor já gravado) — não falha o webhook inteiro por causa disso, o resto do
    // update (status/title/error/round) segue normal.
    const clipUrlSeguro = clipUrl != null && urlDoAllstar(clipUrl) ? clipUrl : null
    const clipSnapshotSeguro = clipSnapshotURL != null && urlDoAllstar(clipSnapshotURL) ? clipSnapshotURL : null

    // Pontuação nova (docs/superpowers/specs/2026-07-22-competicoes-clipes-design.md)
    // calculada UMA VEZ aqui, quando o clipe vira Processed, e gravada em
    // allstar_clips — nem `clipes.js` nem `competicoes.js` recalculam depois.
    // allstar_clips guarda match_id/steam_id64/round_number direto (migração 0042 —
    // clipe virou "por jogador+partida", ver allstarClip.js) — highlight_id fica
    // nullable pros clipes gerados por esse fluxo novo, então NUNCA usar join (inner)
    // com highlights pra achar esses campos, ou todo clipe novo sumiria da pontuação.
    let pontuacaoTotal = null
    let pontuacaoDetalhe = null
    if (status === 'Processed') {
      const { rows: clipRows } = await db.query(
        'select match_id, steam_id64, round_number from allstar_clips where request_id = $1',
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
         round_number = coalesce($7, round_number),
         pontuacao_total = coalesce($8, pontuacao_total),
         pontuacao_detalhe = coalesce($9, pontuacao_detalhe),
         updated_at = now()
       where request_id = $1`,
      [requestId, status ?? null, clipUrlSeguro, clipTitle ?? null, clipSnapshotSeguro, message ?? null, roundNumber ?? null,
        pontuacaoTotal, pontuacaoDetalhe ? JSON.stringify(pontuacaoDetalhe) : null],
    )
    // 2xx sempre, mesmo se o request_id não bater com nada gravado (evento de um
    // clipe que a gente nunca chegou a registrar não é erro do lado deles) — senão
    // eles ficam reenviando à toa por 2h (8 tentativas × 15min).
    res.json({ ok: true })
  })

  return router
}
