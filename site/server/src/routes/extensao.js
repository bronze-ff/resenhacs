import { Router, json } from 'express'
import { randomUUID } from 'node:crypto'
import { assinarTokenExtensao, renovarTokenExtensao, createRequireExtensao } from '../auth/tokenExtensao.js'
import { validarAlvoUpload, checarCotaUpload } from './upload.js'
import { limiteEstrito } from '../rateLimit.js'
import { capturarErro } from '../observabilidade/sentry.js'

// Pendente X0: paridade com shared/extensao/faceit-demo-hosts.json antes do PR.
export const FACEIT_DEMO_HOSTS = Object.freeze([])
const FACEIT_MATCH_ID = /^1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SITE_ORIGIN = 'https://resenha-phi.vercel.app'

function campos(body, nomes) {
  return body !== null && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).length === nomes.length && nomes.every((nome) => Object.hasOwn(body, nome))
}

function urlPermitida(valor, hosts) {
  if (typeof valor !== 'string' || valor.length > 2048) return false
  try {
    const url = new URL(valor)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname)
  } catch { return false }
}

export function createExtensaoRouter({ db, requireAuth, jwtSecret, faceitDemoHosts = FACEIT_DEMO_HOSTS }) {
  const router = Router()
  const requireExtensao = createRequireExtensao(jwtSecret, db)
  router.use(json({ limit: '4kb' }))

  router.post('/token', limiteEstrito, requireAuth, (req, res) => {
    if (req.get('origin') !== SITE_ORIGIN || req.get('sec-fetch-site') === 'cross-site') {
      return res.status(403).json({ erro: 'Origem não permitida' })
    }
    if (!campos(req.body ?? {}, [])) return res.status(400).json({ erro: 'Campos inválidos' })
    const emitido = assinarTokenExtensao({ steamId: req.player.steamId }, jwtSecret)
    return emitido ? res.json(emitido) : res.status(401).json({ erro: 'Não autenticado' })
  })

  router.post('/renovar', limiteEstrito, requireExtensao, (req, res) => {
    if (!campos(req.body ?? {}, [])) return res.status(400).json({ erro: 'Campos inválidos' })
    const renovado = renovarTokenExtensao(req.get('authorization').slice(7), jwtSecret)
    return renovado ? res.json(renovado) : res.status(401).json({ erro: 'Não autenticado' })
  })

  router.post('/envio', limiteEstrito, requireExtensao, async (req, res) => {
    if (!campos(req.body, ['faceitMatchId', 'downloadUrl'])) return res.status(400).json({ erro: 'Campos inválidos' })
    const { faceitMatchId, downloadUrl } = req.body
    if (typeof faceitMatchId !== 'string' || !FACEIT_MATCH_ID.test(faceitMatchId)) return res.status(400).json({ erro: 'Partida FACEIT inválida' })
    if (!urlPermitida(downloadUrl, faceitDemoHosts)) return res.status(400).json({ erro: 'Link de Demo inválido' })
    let client
    try {
      client = await db.connect()
      await client.query('begin')
      const cota = await checarCotaUpload(client, req.player.steamId)
      if (cota) {
        await client.query('rollback')
        return res.status(cota.status).json({ erro: cota.erro })
      }
      const { rows } = await client.query(
        `select m.id, m.tem_demo, m.source, exists (
           select 1 from match_players mp where mp.match_id = m.id and mp.steam_id64 = $2
         ) as participou from matches m where m.faceit_match_id = $1 for update`,
        [faceitMatchId.toLowerCase(), req.player.steamId],
      )
      const erro = validarAlvoUpload(rows[0])
      if (erro) {
        await client.query('rollback')
        return res.status(erro.status === 403 ? 404 : erro.status).json({ erro: erro.status === 403 ? 'Partida não encontrada no ResenhaCS' : erro.erro })
      }
      const diarios = await client.query(
        `select count(*)::int as n from uploads_pendentes
         where adicionado_por = $1 and origem = 'extensao' and adicionado_em > now() - interval '24 hours'`,
        [req.player.steamId],
      )
      if (diarios.rows[0].n >= 20) {
        await client.query('rollback')
        return res.status(429).json({ erro: 'Limite de envios da extensão atingido. Tente amanhã.' })
      }
      const matchId = rows[0].id
      const key = `uploads-pendentes/${randomUUID()}.dem.gz`
      const inserido = await client.query(
        `insert into uploads_pendentes (adicionado_por, arquivo_r2_key, match_alvo_id, origem_url, origem)
         values ($1, $2, $3, $4, 'extensao') returning id`,
        [req.player.steamId, key, matchId, downloadUrl],
      )
      await client.query('commit')
      return res.status(202).json({ id: inserido.rows[0].id, matchId })
    } catch (erro) {
      if (client) await client.query('rollback').catch(() => {})
      if (erro?.code === '23505' && erro.constraint === 'uploads_pendentes_alvo_ativo_idx') {
        return res.status(409).json({ erro: 'Já existe um envio em andamento pra esta partida' })
      }
      // Responder aqui evita rejeitar a promise com o erro que contém dados do envio.
      capturarErro(new Error('Falha na API da extensão'))
      return res.status(500).json({ erro: 'Erro interno' })
    } finally { client?.release() }
  })

  router.use((erro, req, res, next) => {
    if (erro.type === 'entity.too.large') return res.status(413).json({ erro: 'Corpo JSON excede 4 KB' })
    if (erro.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' })
    // Sem cause: erro de banco/parser pode carregar o link assinado ou o corpo.
    capturarErro(new Error('Falha na API da extensão'))
    return res.status(500).json({ erro: 'Erro interno' })
  })
  return router
}
