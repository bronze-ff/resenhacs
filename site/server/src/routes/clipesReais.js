import { Router } from 'express'
import { limiteEstrito } from '../rateLimit.js'
import { keyFromR2Url, presignDownload } from '../r2.js'
import { partidaVisivelExpr } from '../friendships.js'
import { criarClienteDemoSlap, montarClipes, resumirStatusRender, ErroDemoSlap } from '../demoSlap.js'

// Clipe REAL (vídeo do CS2) das kills que o Jogador escolhe, via DEMO-SLAP, em um dos
// modos (clipe, fails, coaching, cheater). Um trecho = um clipe; vários = montagem. Não há worker: o status avança quando
// alguém consulta a lista (a aba Clipes consulta de tempos em tempos enquanto houver
// clipe em andamento). Cada passo que gasta crédito na DEMO-SLAP é reservado antes com
// um update condicional, então duas consultas ao mesmo tempo não pedem o render duas vezes.
const STEAM_ID64 = /^\d{17}$/
const MAX_KILLS = 10
const MAX_POR_DIA = 10
// Passo reservado ('enviando') que não terminou nesse tempo foi interrompido
// (função da Vercel encerrada no meio). Vira erro pra o Jogador poder pedir de novo.
const RESERVA_EXPIRADA_MS = 5 * 60 * 1000

const FINAIS = new Set(['pronto', 'erro'])
// Montagem espera o Coletor (juntar-clipes, cron de 5 em 5 min) juntar os trechos. Se
// passar disso, ela fica pronta assim mesmo e a aba toca os trechos em sequência.
const ESPERA_JUNCAO_MS = 60 * 60 * 1000

// 1080p (sem alta resolução sai 720p), com a marca d'água da DEMO-SLAP. Tirar a marca
// é escolha do Jogador e encarece. Montagem de 7 trechos de 5 s (custom-credits-calc,
// 2026-10-21): 1080p 16 créditos; 720p 11.
const OPCOES_RENDER = { highResolution: true }

// Modos do pedido (migration 0061). Em cada kill marcada, a câmera segue:
//   clipe    → quem o Jogador escolheu (quem matou ou quem morreu)
//   fails    → quem morreu
//   coaching → quem morreu, e depois a mesma morte vista por quem matou
//   cheater  → quem matou, com X-Ray
const PAPEL_DO_POV = { clipe: null, fails: 'victim', coaching: 'victim', cheater: 'killer' }

function opcoesDoPedido(modo, semMarca) {
  return {
    ...OPCOES_RENDER,
    ...(modo === 'cheater' ? { showXRay: true } : {}),
    ...(semMarca ? { hideWatermark: true } : {}),
  }
}

// Confere cada kill contra a Partida e devolve os trechos a gravar, ou null se alguma
// kill não existe ou a câmera não está em quem o modo manda. O pov confirma QUAL kill
// é quando duas acontecem no mesmo tick.
export function trechosDoPedido(modo, kills, existentes) {
  const papel = PAPEL_DO_POV[modo]
  const trechos = []
  for (const k of kills) {
    const e = existentes.find((x) => x.tick === k.tick && x.round_number === k.round &&
      (papel ? x[papel] === k.pov : x.killer === k.pov || x.victim === k.pov))
    if (!e) return null
    trechos.push(k)
    // Morte sem killer (queda, bomba) fica só com a visão de quem morreu.
    if (modo === 'coaching' && e.killer && e.killer !== e.victim) trechos.push({ ...k, pov: e.killer })
  }
  return trechos
}

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

  // Clipe real gasta crédito pago: só Premium (marcado pelo admin) e super admin pedem.
  async function podePedir(steamId) {
    const { rows } = await db.query('select is_super_admin, premium from players where steam_id64 = $1', [steamId])
    return Boolean(rows[0]?.is_super_admin || rows[0]?.premium)
  }

  // Valida o corpo { modo, kills, semMarca } e a Partida. Responde o erro e devolve null,
  // ou devolve { modo, semMarca, partida, trechos }. Usado pelo pedido e pela estimativa.
  async function prepararPedido(req, res) {
    const modo = req.body?.modo ?? 'clipe'
    const semMarca = req.body?.semMarca === true
    if (!Object.hasOwn(PAPEL_DO_POV, modo)) return void res.status(400).json({ erro: 'Modo de clipe inválido' })
    const kills = killsValidas(req.body?.kills)
    if (!kills) return void res.status(400).json({ erro: `Escolha de 1 a ${MAX_KILLS} kills` })
    if (!(await podePedir(req.player.steamId))) {
      return void res.status(403).json({ erro: 'Clipe de vídeo é só para Jogador Premium' })
    }
    const partida = await partidaVisivel(req.params.id, req.player.steamId)
    if (!partida) return void res.status(404).json({ erro: 'Partida não encontrada' })
    const { rows: existentes } = await db.query(
      'select tick, round_number, killer, victim from kill_positions where match_id = $1 and tick = any($2::int[])',
      [partida.id, kills.map((k) => k.tick)],
    )
    const trechos = trechosDoPedido(modo, kills, existentes)
    if (!trechos) return void res.status(400).json({ erro: 'Kill não encontrada nessa Partida' })
    return { modo, semMarca, partida, trechos }
  }

  async function precisaAnalisar(matchId) {
    const { rows } = await db.query('select status from demoslap_analises where match_id = $1', [matchId])
    return rows.length === 0 || rows[0].status === 'error'
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
    if (c.status === 'enviando') {
      if (parado) await marcarErro(c.id, 'O pedido foi interrompido. Peça o clipe de novo.')
      return
    }
    // Montagem com os trechos gravados, esperando o Coletor juntar (juntar-clipes grava
    // video_r2_key e marca pronto). Se ele demorar demais, fica pronta com os trechos.
    if (c.status === 'juntando') {
      if (Date.now() - new Date(c.updated_at).getTime() > ESPERA_JUNCAO_MS) {
        await db.query("update clipes_reais set status = 'pronto', updated_at = now() where id = $1", [c.id])
      }
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
          const ids = await cliente.renderizar(a.job_id, montarClipes(c.kills, a.tick_rate), opcoesDoPedido(c.modo, c.sem_marca))
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
        // Montagem não passa pelo render-fragmovie: ele recusa trechos do render-custom
        // ("No rendered clips found", testado em 2026-10-21). Quem junta é o Coletor; até
        // lá a montagem fica em 'juntando', pra não aparecer em pedaços.
        await db.query(
          (c.video_job_ids ?? []).length > 1
            ? "update clipes_reais set status = 'juntando', updated_at = now() where id = $1"
            : "update clipes_reais set status = 'pronto', updated_at = now() where id = $1",
          [c.id],
        )
      }
    } catch (e) {
      console.error(`demoslap: falha ao consultar o clipe ${c.id}: ${e.message}`)
    }
  }

  async function carregar(matchId) {
    const { rows } = await db.query(
      `select c.id, c.match_id, c.pedido_por, c.modo, c.sem_marca, c.kills, c.status, c.video_job_ids,
              c.fragmovie_job_id, c.video_r2_key, c.erro, c.created_at, c.updated_at,
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

  // URLs assinadas do vídeo pronto. Pedidas na hora (expiram); falha vira lista vazia.
  // Montagem já juntada pelo Coletor (juntar-clipes) = um vídeo no R2; antes disso, os
  // trechos da DEMO-SLAP na ordem das kills.
  async function urlsDosVideos(c, contexto) {
    try {
      if (c.video_r2_key && r2Client) return [await presignDownload(r2Client, r2Bucket, c.video_r2_key, 3600)]
      const dados = contexto.dadosRender ?? (contexto.dadosRender = await cliente.dadosRender(c.job_id))
      return (c.video_job_ids ?? []).map((id) => dados?.highlightClips?.[id]?.clipUrl)
    } catch (e) {
      console.error(`demoslap: falha ao buscar o vídeo do clipe ${c.id}: ${e.message}`)
      return []
    }
  }

  function serializar(c, urls) {
    const videos = (urls ?? []).filter((u) => typeof u === 'string' && u.startsWith('https://'))
    return {
      id: c.id,
      status: c.status,
      erro: c.status === 'erro' ? c.erro : null,
      modo: c.modo ?? 'clipe',
      semMarca: Boolean(c.sem_marca),
      kills: c.kills,
      montagem: Array.isArray(c.kills) && c.kills.length > 1,
      pedidoPor: { steamId: c.pedido_por, nick: c.nick ?? null },
      criadoEm: c.created_at,
      videos: c.status === 'pronto' ? videos : [],
    }
  }

  async function listar(partida) {
    const contexto = {}
    let linhas = await carregar(partida.id)
    if (cliente && linhas.some((c) => !FINAIS.has(c.status))) {
      for (const c of linhas) await avancar(c, contexto)
      linhas = await carregar(partida.id)
    }
    const saida = []
    for (const c of linhas) {
      saida.push(serializar(c, c.status === 'pronto' && cliente ? await urlsDosVideos(c, contexto) : null))
    }
    return saida
  }

  router.get('/:id/clipes-reais', requireAuth, async (req, res) => {
    const partida = await partidaVisivel(req.params.id, req.player.steamId)
    if (!partida) return res.status(404).json({ erro: 'Partida não encontrada' })
    // Sem chave, o recurso está desligado: não toca nas tabelas da 0059 (que podem
    // nem existir ainda) e a aba só mostra o aviso.
    if (!cliente) return res.json({ disponivel: false, clipes: [] })
    res.json({ disponivel: true, permitido: await podePedir(req.player.steamId), clipes: await listar(partida) })
  })

  // Quanto o pedido vai gastar, antes de pedir. Só calcula: não gasta crédito.
  router.post('/:id/clipes-reais/estimativa', requireAuth, async (req, res) => {
    if (!cliente) return res.status(503).json({ erro: 'Clipe real ainda não configurado' })
    const p = await prepararPedido(req, res)
    if (!p) return
    try {
      // O cálculo só usa a duração de cada trecho; o tick rate não muda o preço. Calcula
      // com e sem a marca d'água pra a aba mostrar quanto a mais custa tirar.
      const clipes = montarClipes(p.trechos, 64)
      const [comMarca, semMarca] = await Promise.all([
        cliente.calcular(clipes, opcoesDoPedido(p.modo, false)),
        cliente.calcular(clipes, opcoesDoPedido(p.modo, true)),
      ])
      const creditos = p.semMarca ? semMarca : comMarca
      const analise = (await precisaAnalisar(p.partida.id)) ? 1 : 0
      const total = creditos + analise
      const emReais = (n) => Math.round(n * config.demoSlapReaisPorCredito * 100) / 100
      res.json({
        trechos: p.trechos.length, creditos, analise, total, reais: emReais(total),
        extraSemMarca: semMarca - comMarca, reaisExtraSemMarca: emReais(semMarca - comMarca),
      })
    } catch (e) {
      console.error(`demoslap: falha ao estimar o custo na partida ${p.partida.id}: ${e.message}`)
      res.status(502).json({ erro: mensagemErro(e) })
    }
  })

  // limiteEstrito: cada pedido gasta crédito na DEMO-SLAP.
  router.post('/:id/clipes-reais', limiteEstrito, requireAuth, async (req, res) => {
    if (!cliente) return res.status(503).json({ erro: 'Clipe real ainda não configurado' })
    const p = await prepararPedido(req, res)
    if (!p) return
    const { partida } = p

    const { rows: [{ total }] } = await db.query(
      "select count(*)::int as total from clipes_reais where pedido_por = $1 and created_at > now() - interval '1 day'",
      [req.player.steamId],
    )
    if (total >= MAX_POR_DIA) {
      return res.status(429).json({ erro: `Limite de ${MAX_POR_DIA} clipes por dia. Tente amanhã.` })
    }

    if (await precisaAnalisar(partida.id)) {
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
      'insert into clipes_reais (match_id, pedido_por, modo, kills, sem_marca) values ($1, $2, $3, $4::jsonb, $5)',
      [partida.id, req.player.steamId, p.modo, JSON.stringify(p.trechos), p.semMarca],
    )
    res.status(201).json({ clipes: await listar(partida) })
  })

  return router
}
