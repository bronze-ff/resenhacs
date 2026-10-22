import { Router } from 'express'
import crypto from 'node:crypto'
import { presignUpload } from '../r2.js'
import { limiteEstrito } from '../rateLimit.js'

const SHARE_CODE_RE = /^CSGO(-\S{5}){5}$/
// Valida o formato; o fuso é obrigatório antes de aceitar a data.
const PLAYED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?([+-]\d{2}:\d{2}|Z)?$/
// Sem integração oficial com essas plataformas (diferente de valve_mm/faceit, que a
// gente puxa automático) — é só um rótulo informativo que o próprio jogador escolhe.
const PLATAFORMAS_MANUAIS = new Set(['faceit', 'gamers_club', 'xplay_gg'])
const TOLERANCIA_DIAS = 3
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_UPLOAD_BYTES = 400 * 1024 * 1024

// Upload manual de demo: o arquivo (100-300MB) sobe DIRETO pro R2 via URL
// pré-assinada — nunca passa pelo corpo da request na função serverless
// (limite de payload da Vercel, poucos MB, não aguentaria). Uma linha fica
// pendente em uploads_pendentes; o Coletor (GitHub Actions, a cada 30 min)
// baixa do R2 e processa. Mesmo padrão já usado pela fila de Partidas Pro
// (site/server/src/routes/partidasPro.js), mas aberto a qualquer jogador logado,
// não só super admin.
const MAX_UPLOADS_PENDENTES = 5

export function createUploadRouter({ db, requireAuth, r2Client, r2Bucket }) {
  const router = Router()

  router.post('/upload-url', limiteEstrito, requireAuth, async (req, res) => {
    if (!r2Client) return res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })

    const filename = String(req.body?.filename ?? '').trim()
    if (!filename.toLowerCase().endsWith('.dem')) {
      return res.status(400).json({ erro: 'Só arquivos .dem são aceitos (demos comprimidos .bz2/.gz ainda não)' })
    }
    const tamanho = req.body?.tamanho
    if (!Number.isInteger(tamanho) || tamanho <= 0) {
      return res.status(400).json({ erro: 'Tamanho de arquivo inválido' })
    }
    if (tamanho > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ erro: `Arquivo excede o limite de ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB` })
    }
    const shareCode = String(req.body?.shareCode ?? '').trim()
    if (shareCode && !SHARE_CODE_RE.test(shareCode)) {
      return res.status(400).json({ erro: 'Share code inválido (formato CSGO-…-…-…-…-…)' })
    }
    const playedAt = String(req.body?.playedAt ?? '').trim()
    if (playedAt && !PLAYED_AT_RE.test(playedAt)) {
      return res.status(400).json({ erro: 'Data/hora inválida' })
    }
    // O .dem não guarda data real em lugar nenhum (confirmado lendo o demo.proto oficial
    // do CS2) — playedAt é sempre digitado pelo jogador. A janela de tolerância reduz a
    // fraude "óbvia" (baixar demo antiga, declarar uma data dentro do período de uma
    // competição em andamento) sem bloquear o caso legítimo (jogou há 1-2 dias, sobe
    // agora). Não elimina o risco — só reduz a superfície de abuso.
    if (playedAt) {
      const dataInformada = new Date(playedAt)
      if (Number.isNaN(dataInformada.getTime())) {
        return res.status(400).json({ erro: 'Data/hora inválida' })
      }
      if (!/(Z|[+-]\d{2}:\d{2})$/.test(playedAt)) {
        return res.status(400).json({ erro: 'Data sem fuso' })
      }
      const agora = new Date()
      const limiteAntigo = new Date(agora.getTime() - TOLERANCIA_DIAS * 24 * 60 * 60 * 1000)
      if (dataInformada > agora || dataInformada < limiteAntigo) {
        return res.status(400).json({
          erro: `A data informada precisa estar entre ${TOLERANCIA_DIAS} dias atrás e agora.`,
        })
      }
    }
    const plataformaManual = String(req.body?.plataformaManual ?? '').trim()
    if (plataformaManual && !PLATAFORMAS_MANUAIS.has(plataformaManual)) {
      return res.status(400).json({ erro: 'Plataforma inválida' })
    }

    // Envio amarrado a uma Partida específica (botão "Enviar demo desta partida" na
    // página da Partida): o vínculo é explícito, então dá pra exigir prova de
    // participação e checar elegibilidade antes de gastar 300MB de upload.
    const matchId = String(req.body?.matchId ?? '').trim()
    if (matchId) {
      if (!UUID_RE.test(matchId)) return res.status(400).json({ erro: 'Partida inválida' })
      const { rows } = await db.query(
        `select m.tem_demo, m.source,
                exists (
                  select 1 from match_players mp
                  where mp.match_id = m.id and mp.steam_id64 = $2
                ) as participou
         from matches m where m.id = $1`,
        [matchId, req.player.steamId],
      )
      const alvo = rows[0]
      // Partida inexistente e partida onde ele não jogou dão a MESMA resposta —
      // senão o 404/403 vira um oráculo de "esta partida existe".
      if (!alvo || !alvo.participou) {
        return res.status(403).json({ erro: 'Só quem jogou esta partida pode enviar a demo dela' })
      }
      if (alvo.tem_demo) {
        return res.status(409).json({ erro: 'Esta partida já tem demo processada' })
      }
      if (alvo.source !== 'faceit') {
        return res.status(409).json({ erro: 'Esta partida não aceita envio de demo' })
      }
    }

    if (shareCode && !matchId) {
      const existente = await db.query(
        "select 1 from matches where share_code = $1 and status = 'parsed' limit 1",
        [shareCode],
      )
      if (existente.rows.length) return res.status(409).json({ erro: 'Essa Partida já está registrada.' })
    }

    const key = `uploads-pendentes/${crypto.randomUUID()}.dem`
    // Com alvo, os metadados vêm da própria Partida — nada de share code, data ou
    // plataforma digitados pelo cliente (menos superfície pra dado mentiroso).
    const params = matchId
      ? [req.player.steamId, key, null, null, null, matchId]
      : [req.player.steamId, key, shareCode || null, playedAt || null, plataformaManual || null, null]
    let rows
    const client = await db.connect()
    try {
      await client.query('begin')
      // A cota impede que uma conta Steam descartável encha o R2 com pedidos paralelos.
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`uploads:${req.player.steamId}`])
      const pendentesQ = await client.query(
        `select count(*)::int as n from uploads_pendentes
         where adicionado_por = $1 and (
           status in ('pendente', 'processando')
           or (status = 'falhou' and adicionado_em > now() - interval '24 hours')
         )`,
        [req.player.steamId],
      )
      if ((pendentesQ.rows[0]?.n ?? 0) >= MAX_UPLOADS_PENDENTES) {
        await client.query('rollback')
        return res.status(429).json({ erro: `Você já tem ${MAX_UPLOADS_PENDENTES} demos esperando processamento. Aguarde o Coletor processar antes de enviar mais.` })
      }
      ;({ rows } = await client.query(
        `insert into uploads_pendentes (adicionado_por, arquivo_r2_key, share_code, played_at, plataforma_manual, match_alvo_id)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        params,
      ))
      await client.query('commit')
    } catch (e) {
      await client.query('rollback').catch(() => {})
      // uploads_pendentes_alvo_ativo_idx: um envio ativo por Partida (a trava é do
      // banco, não do aplicativo — dois cliques simultâneos não passam pelos dois).
      // Escopado a matchId porque é a única unicidade que esse índice parcial descreve
      // hoje; qualquer outro 23505 (inclusive no fluxo genérico, sem matchId) é um bug
      // real e não deve virar essa mensagem.
      if (matchId && e?.code === '23505') {
        return res.status(409).json({ erro: 'Já existe um envio em andamento pra esta partida' })
      }
      throw e
    } finally {
      client.release()
    }
    const uploadUrl = await presignUpload(r2Client, r2Bucket, key, 'application/octet-stream', 900, tamanho)
    res.json({ id: rows[0].id, uploadUrl, key })
  })

  return router
}
