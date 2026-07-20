import { Router } from 'express'

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
    const { requestId, status, clipUrl, clipTitle, clipSnapshotURL, message } = req.body || {}
    if (!requestId) return res.status(400).json({ erro: 'requestId ausente' })

    await db.query(
      `update allstar_clips set
         status = coalesce($2, status),
         clip_url = coalesce($3, clip_url),
         clip_title = coalesce($4, clip_title),
         clip_snapshot_url = coalesce($5, clip_snapshot_url),
         error_message = coalesce($6, error_message),
         updated_at = now()
       where request_id = $1`,
      [requestId, status ?? null, clipUrl ?? null, clipTitle ?? null, clipSnapshotURL ?? null, message ?? null],
    )
    // 2xx sempre, mesmo se o request_id não bater com nada gravado (evento de um
    // clipe que a gente nunca chegou a registrar não é erro do lado deles) — senão
    // eles ficam reenviando à toa por 2h (8 tentativas × 15min).
    res.json({ ok: true })
  })

  return router
}
