import { Router } from 'express'
import { limiteEstrito } from '../rateLimit.js'
import { keyFromR2Url, presignDownload } from '../r2.js'
import { partidaVisivelExpr } from '../friendships.js'
import { criarClienteDemoSlap, montarClipes, resumirStatusRender, ErroDemoSlap } from '../demoSlap.js'

// Clipe REAL (vídeo do CS2) das kills que o Jogador escolhe, via DEMO-SLAP. Uma kill =
// um clipe; várias = montagem num vídeo só. Não há worker: o status avança quando
// alguém consulta a lista (a aba Clipes consulta de tempos em tempos enquanto houver
// clipe em andamento). Cada passo que gasta crédito na DEMO-SLAP é reservado antes com
// um update condicional, então duas consultas ao mesmo tempo não pedem o render duas vezes.
const STEAM_ID64 = /^\d{17}$/
const MAX_KILLS = 10
const MAX_POR_DIA = 10
// Passo reservado ('enviando'/'juntando') que não terminou nesse tempo foi interrompido
// (função da Vercel encerrada no meio). Vira erro pra o Jogador poder pedir de novo.
const RESERVA_EXPIRADA_MS = 5 * 60 * 1000

const FINAIS = new Set(['pronto', 'erro'])

function mensagemErro(e) {
  if (e instanceof ErroDemoSlap) return e.mensagem || 'A DEMO-SLAP recusou o pedido'
  return 'Falha ao falar com a DEMO-SLAP'
}

function killsValidas(kills) {
  if (!Array.isArray(kills) || kills.length === 0 || kills.length > MAX_KILLS) return null
  const saida = []
  for (const k of kills) {
    const tick = Number(k?.tick)
    const round = Number(k?.round)
    if (!Number.isInteger(tick) || tick < 0 || !Number.isInteger(round) || round < 1) return null
    if (typeof k?.pov !== 'string' || !STEAM_ID64.test(k.pov)) return null
    saida.push({ tick, round, pov: k.pov })
  }
  return saida.sort((a, b) => a.tick - b.tick)
}

export function createClipesReaisRouter({ db, requireAuth, r2Client, r2Bucket, config, demoSlap }) {
  const router = Router()
  const cliente = demoSlap ?? (config.demoSlapApiKey ? criarClienteDemoSlap(config.demoSlapApiKey) : null)

  async function partidaVisivel(id, steamId) {
    const { rows } = await db.query(
      `select m.id, m.map, m.demo_url from matches m where m.id = $1 and ${partidaVisivelExpr('m', '$2')}`,
      [id, steamId],
    )
    return rows[0] ?? null
  }

  async function marcarErro(id, erro) {
    await db.query(
      "update clipes_reais set status = 'erro', erro = $2, updated_at = now() where id = $1",
      [id, String(erro).slice(0, 300)],
    )
  }

  // Atualiza a análise da Partida (working → done/error) e devolve a linha atual.
  async function analiseAtual(matchId) {
    const { rows } = await db.query(
      'select job_id, status, tick_rate, erro from demoslap_analises where match_id = $1',
      [matchId],
    )
    const a = rows[0]
    if (!a || a.status !== 'working') return a ?? null
    const st = await cliente.statusAnalise(a.job_id)
    if (st?.status === 'done') {
      const dados = await cliente.dadosAnalise(a.job_id)
      const tickRate = Number(dados?.tickRate) || 64
      await db.query(
        "update demoslap_analises set status = 'done', tick_rate = $2, updated_at = now() where match_id = $1",
        [matchId, tickRate],
      )
      return { ...a, status: 'done', tick_rate: tickRate }
    }
    if (st?.status === 'error') {
      const erro = st.errorMessage || 'A DEMO-SLAP não conseguiu ler a Demo'
      await db.query(
        "update demoslap_analises set status = 'error', erro = $2, updated_at = now() where match_id = $1",
        [matchId, erro],
      )
      return { ...a, status: 'error', erro }
    }
    return a
  }

  // Leva um clipe ao próximo estado, quando dá. Erro de rede/API transitório deixa o
  // clipe onde está (a próxima consulta tenta de novo); recusa da DEMO-SLAP num passo
  // que gasta crédito vira erro do clipe.
  async function avancar(c, contexto) {
    if (FINAIS.has(c.status)) return
    const parado = Date.now() - new Date(c.updated_at).getTime() > RESERVA_EXPIRADA_MS
    if (c.status === 'enviando' || (c.status === 'juntando' && !c.fragmovie_job_id)) {
      if (parado) await marcarErro(c.id, 'O pedido foi interrompido. Peça o clipe de novo.')
      return
    }
    try {
      if (c.status === 'analisando') {
        const a = contexto.analise ?? (contexto.analise = await analiseAtual(c.match_id))
        if (!a) return marcarErro(c.id, 'Análise da Demo não encontrada. Peça o clipe de novo.')
        if (a.status === 'error') return marcarErro(c.id, a.erro || 'A DEMO-SLAP não conseguiu ler a Demo')
        if (a.status !== 'done') return
        const reserva = await db.query(
          "update clipes_reais set status = 'enviando', updated_at = now() where id = $1 and status = 'analisando' returning id",
          [c.id],
        )
        if (reserva.rows.length === 0) return
        try {
          const ids = await cliente.renderizar(a.job_id, montarClipes(c.kills, a.tick_rate))
          if (ids.length === 0) return marcarErro(c.id, 'A DEMO-SLAP não aceitou nenhum trecho')
          await db.query(
            "update clipes_reais set status = 'renderizando', video_job_ids = $2, updated_at = now() where id = $1",
            [c.id, ids],
          )
        } catch (e) {
          console.error(`demoslap: render recusado no clipe ${c.id}: ${e.message}`)
          await marcarErro(c.id, mensagemErro(e))
        }
        return
      }

      if (c.status === 'renderizando') {
        const mapa = contexto.statusRender ?? (contexto.statusRender = await cliente.statusRender(c.job_id))
        const r = resumirStatusRender(mapa, c.video_job_ids ?? [])
        if (r.status === 'error') return marcarErro(c.id, r.erro)
        if (r.status !== 'done') return
        if ((c.video_job_ids ?? []).length <= 1) {
          await db.query("update clipes_reais set status = 'pronto', updated_at = now() where id = $1", [c.id])
          return
        }
        const reserva = await db.query(
          "update clipes_reais set status = 'juntando', updated_at = now() where id = $1 and status = 'renderizando' returning id",
          [c.id],
        )
        if (reserva.rows.length === 0) return
        try {
          const titulo = `${c.nick || 'Resenha'} · ${contexto.mapa || 'CS2'}`.slice(0, 60)
          const fid = await cliente.juntar(c.job_id, c.video_job_ids, titulo)
          await db.query(
            'update clipes_reais set fragmovie_job_id = $2, updated_at = now() where id = $1',
            [c.id, fid],
          )
        } catch (e) {
          console.error(`demoslap: montagem recusada no clipe ${c.id}: ${e.message}`)
          await marcarErro(c.id, mensagemErro(e))
        }
        return
      }

      if (c.status === 'juntando') {
        const st = await cliente.statusMontagem(c.fragmovie_job_id)
        if (st?.status === 'error') return marcarErro(c.id, st.errorMessage || 'Falha ao juntar a montagem')
        if (st?.status === 'done') {
          await db.query("update clipes_reais set status = 'pronto', updated_at = now() where id = $1", [c.id])
        }
      }
    } catch (e) {
      console.error(`demoslap: falha ao consultar o clipe ${c.id}: ${e.message}`)
    }
  }

  async function carregar(matchId) {
    const { rows } = await db.query(
      `select c.id, c.match_id, c.pedido_por, c.kills, c.status, c.video_job_ids,
              c.fragmovie_job_id, c.erro, c.created_at, c.updated_at,
              a.job_id, p.nick
       from clipes_reais c
       left join demoslap_analises a on a.match_id = c.match_id
       left join players p on p.steam_id64 = c.pedido_por
       where c.match_id = $1
       order by c.created_at desc
       limit 20`,
      [matchId],
    )
    return rows
  }

  // URL assinada do vídeo pronto. Pedida na hora (expira); falha vira null.
  async function urlDoVideo(c, contexto) {
    try {
      if (c.fragmovie_job_id) {
        const dados = await cliente.dadosMontagem(c.fragmovie_job_id)
        const clipes = dados?.highlightClips ?? {}
        return (clipes[c.fragmovie_job_id] ?? Object.values(clipes)[0])?.clipUrl ?? null
      }
      const dados = contexto.dadosRender ?? (contexto.dadosRender = await cliente.dadosRender(c.job_id))
      return dados?.highlightClips?.[c.video_job_ids?.[0]]?.clipUrl ?? null
    } catch (e) {
      console.error(`demoslap: falha ao buscar o vídeo do clipe ${c.id}: ${e.message}`)
      return null
    }
  }

  function serializar(c, videoUrl) {
    const url = typeof videoUrl === 'string' && videoUrl.startsWith('https://') ? videoUrl : null
    return {
      id: c.id,
      status: c.status,
      erro: c.status === 'erro' ? c.erro : null,
      kills: c.kills,
      montagem: Array.isArray(c.kills) && c.kills.length > 1,
      pedidoPor: { steamId: c.pedido_por, nick: c.nick ?? null },
      criadoEm: c.created_at,
      videoUrl: c.status === 'pronto' ? url : null,
    }
  }

  async function listar(partida) {
    const contexto = { mapa: partida.map }
    let linhas = await carregar(partida.id)
    if (cliente && linhas.some((c) => !FINAIS.has(c.status))) {
      for (const c of linhas) await avancar(c, contexto)
      linhas = await carregar(partida.id)
    }
    const saida = []
    for (const c of linhas) {
      saida.push(serializar(c, c.status === 'pronto' && cliente ? await urlDoVideo(c, contexto) : null))
    }
    return saida
  }

  router.get('/:id/clipes-reais', requireAuth, async (req, res) => {
    const partida = await partidaVisivel(req.params.id, req.player.steamId)
    if (!partida) return res.status(404).json({ erro: 'Partida não encontrada' })
    res.json({ disponivel: Boolean(cliente), clipes: await listar(partida) })
  })

  // limiteEstrito: cada pedido gasta crédito na DEMO-SLAP.
  router.post('/:id/clipes-reais', limiteEstrito, requireAuth, async (req, res) => {
    if (!cliente) return res.status(503).json({ erro: 'Clipe real ainda não configurado' })
    const kills = killsValidas(req.body?.kills)
    if (!kills) return res.status(400).json({ erro: `Escolha de 1 a ${MAX_KILLS} kills` })

    const partida = await partidaVisivel(req.params.id, req.player.steamId)
    if (!partida) return res.status(404).json({ erro: 'Partida não encontrada' })

    // Cada kill tem que existir na Partida, e a câmera só segue quem matou ou quem morreu.
    const { rows: existentes } = await db.query(
      'select tick, round_number, killer, victim from kill_positions where match_id = $1 and tick = any($2::int[])',
      [partida.id, kills.map((k) => k.tick)],
    )
    const valida = (k) => existentes.some((e) =>
      e.tick === k.tick && e.round_number === k.round && (e.killer === k.pov || e.victim === k.pov))
    if (!kills.every(valida)) return res.status(400).json({ erro: 'Kill não encontrada nessa Partida' })

    const { rows: [{ total }] } = await db.query(
      "select count(*)::int as total from clipes_reais where pedido_por = $1 and created_at > now() - interval '1 day'",
      [req.player.steamId],
    )
    if (total >= MAX_POR_DIA) {
      return res.status(429).json({ erro: `Limite de ${MAX_POR_DIA} clipes por dia. Tente amanhã.` })
    }

    const { rows: analises } = await db.query(
      'select status from demoslap_analises where match_id = $1',
      [partida.id],
    )
    if (analises.length === 0 || analises[0].status === 'error') {
      if (!r2Client || !partida.demo_url) {
        return res.status(404).json({ erro: 'A Demo dessa Partida não está mais guardada' })
      }
      const demoKey = keyFromR2Url(partida.demo_url, r2Bucket)
      if (!demoKey) return res.status(404).json({ erro: 'A Demo dessa Partida não está mais guardada' })
      try {
        // 24h: a fila da DEMO-SLAP pode demorar pra baixar a Demo.
        const url = await presignDownload(r2Client, r2Bucket, demoKey, 86400)
        const jobId = await cliente.analisar(url)
        await db.query(
          `insert into demoslap_analises (match_id, job_id) values ($1, $2)
           on conflict (match_id) do update
             set job_id = excluded.job_id, status = 'working', erro = null, tick_rate = null, updated_at = now()`,
          [partida.id, jobId],
        )
      } catch (e) {
        console.error(`demoslap: falha ao analisar a partida ${partida.id}: ${e.message}`)
        return res.status(502).json({ erro: mensagemErro(e) })
      }
    }

    await db.query(
      'insert into clipes_reais (match_id, pedido_por, kills) values ($1, $2, $3::jsonb)',
      [partida.id, req.player.steamId, JSON.stringify(kills)],
    )
    res.status(201).json({ clipes: await listar(partida) })
  })

  return router
}
