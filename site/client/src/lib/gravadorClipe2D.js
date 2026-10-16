// Gravador do Clipe 2D: toca a timeline (timelineClipe2D.js) num <canvas> usando o
// mesmo desenho do Replay 2D e grava com canvas.captureStream + MediaRecorder. Tudo no
// navegador: nada sobe pro servidor.
import { desenharFrame, TAM } from '../components/ReplayViewer.jsx'
import { nomeMapa, nomeArma } from './format.js'
import { posicaoNaTimeline, enquadramento, roundInterpolado } from './timelineClipe2D.js'
import { marcasKill } from './selecaoKills.js'

export const LARGURA = 1280
export const ALTURA = 720
export const FPS = 60

// Espelho dos tokens de index.css (canvas não lê var(--...)).
const COR = {
  fundo: '#0a0a0b', superficie: '#111113', borda: '#232327', texto: '#ededef', fraco: '#8a8a93',
  destaque: '#ff6a1a', perigo: '#f2555a',
}
const FONTE = 'Geist, Inter, system-ui, sans-serif'
const FONTE_MONO = 'Geist Mono, ui-monospace, monospace'

const MIMES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

// mp4 quando o navegador grava mp4 (Safari, Chrome recente); senão webm.
export function escolherMimeType(MR = globalThis.MediaRecorder) {
  if (!MR) return null
  if (typeof MR.isTypeSupported !== 'function') return ''
  return MIMES.find((m) => MR.isTypeSupported(m)) ?? ''
}

export function extensaoDoMime(mime) {
  return String(mime || '').startsWith('video/mp4') ? 'mp4' : 'webm'
}

export function suportaGravacao() {
  if (typeof globalThis.MediaRecorder !== 'function') return false
  if (typeof HTMLCanvasElement === 'undefined') return false
  return typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

// Índice do replay + os rounds pedidos, completos. Aceita o formato antigo (índice já
// com frames) e o de streaming por round (`/round/:n`).
export async function carregarReplayParaClipe(replayUrl, numeros, fetchFn = globalThis.fetch) {
  const res = await fetchFn(replayUrl)
  if (!res.ok) throw new Error('replay indisponível')
  const indice = await res.json()
  const rounds = {}
  const streaming = indice.rounds.length > 0 && indice.rounds[0].frames === undefined
  if (!streaming) {
    for (const r of indice.rounds) if (numeros.includes(r.round)) rounds[r.round] = r
    return { replay: indice, rounds }
  }
  await Promise.all([...new Set(numeros)].map(async (n) => {
    const r = await fetchFn(`${replayUrl}/round/${n}`)
    if (r.ok) rounds[n] = await r.json()
  }))
  return { replay: indice, rounds }
}

export function carregarImagem(src) {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') { resolve(null); return }
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function nickDe(replay, jogador) {
  if (!jogador) return 'ambiente'
  return jogador.nick || replay?.names?.[jogador.steamId] || jogador.steamId
}

function textoKill(replay, k) {
  const marcas = marcasKill(k).map((m) => m.rotulo).join(' · ')
  return {
    linha: `${nickDe(replay, k.killer)} → ${nickDe(replay, k.victim)}`,
    detalhe: [nomeArma(k.weapon), marcas].filter(Boolean).join(' · '),
  }
}

function rotuloContagem(item, total) {
  return item.primeiraKill === item.ultimaKill
    ? `Kill ${item.primeiraKill} de ${total}`
    : `Kills ${item.primeiraKill}–${item.ultimaKill} de ${total}`
}

function desenharTitulo(ctx, item, { replay, total }) {
  ctx.fillStyle = COR.fundo
  ctx.fillRect(0, 0, LARGURA, ALTURA)
  ctx.textAlign = 'center'
  ctx.fillStyle = COR.fraco
  ctx.font = `500 24px ${FONTE}`
  ctx.fillText(`${nomeMapa(replay.map)} · ${rotuloContagem(item, total)}`, LARGURA / 2, ALTURA / 2 - 90)
  ctx.fillStyle = COR.texto
  ctx.font = `600 72px ${FONTE}`
  ctx.fillText(`Round ${item.round}`, LARGURA / 2, ALTURA / 2 - 10)
  ctx.font = `500 30px ${FONTE}`
  item.kills.slice(0, 3).forEach((k, i) => {
    const { linha, detalhe } = textoKill(replay, k)
    const y = ALTURA / 2 + 60 + i * 70
    ctx.fillStyle = COR.texto
    ctx.font = `500 30px ${FONTE}`
    ctx.fillText(linha, LARGURA / 2, y)
    ctx.fillStyle = k.teamKill ? COR.perigo : COR.fraco
    ctx.font = `400 22px ${FONTE_MONO}`
    ctx.fillText(detalhe, LARGURA / 2, y + 30)
  })
  ctx.fillStyle = COR.destaque
  ctx.fillRect(LARGURA / 2 - 24, ALTURA - 60, 48, 3)
}

function anel(ctx, x, y, raio, cor, tracejado) {
  ctx.save()
  ctx.strokeStyle = cor
  ctx.lineWidth = 3
  if (tracejado) ctx.setLineDash([6, 4])
  ctx.beginPath(); ctx.arc(x, y, raio, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
}

function desenharCena(ctx, item, frame, { replay, rounds, radar, base, total, cache, indice }) {
  const rd = rounds[item.round]
  ctx.fillStyle = COR.fundo
  ctx.fillRect(0, 0, LARGURA, ALTURA)

  // Replay 2D inteiro num canvas 640×640 (mesmo desenho do ReplayViewer), recortado e
  // ampliado no quadrado da esquerda.
  const interp = roundInterpolado(rd, frame)
  const f = Math.floor(frame)
  const bctx = base?.getContext?.('2d')
  if (bctx) {
    desenharFrame(bctx, interp, f, radar, replay, null)
    let rec = cache.get(indice)
    if (!rec) { rec = enquadramento(rd, item); cache.set(indice, rec) }
    ctx.drawImage(base, rec.x * TAM, rec.y * TAM, rec.lado * TAM, rec.lado * TAM, 0, 0, ALTURA, ALTURA)

    // Destaque: anel laranja no killer, anel tracejado vermelho na vítima.
    const players = interp.frames[f]?.players ?? []
    const paraTela = (p) => [((p.x - rec.x) / rec.lado) * ALTURA, ((p.y - rec.y) / rec.lado) * ALTURA]
    const escala = Math.max(1, 1 / rec.lado)
    for (const k of item.kills) {
      const v = players.find((p) => p.id === k.victim?.steamId)
      if (v) anel(ctx, ...paraTela(v), 12 * escala, COR.perigo, true)
      const a = k.killer && players.find((p) => p.id === k.killer.steamId)
      if (a) anel(ctx, ...paraTela(a), 12 * escala, COR.destaque, false)
    }
  }

  // Painel da direita: mapa, round, kills da cena.
  const x0 = ALTURA + 48
  ctx.fillStyle = COR.superficie
  ctx.fillRect(ALTURA, 0, LARGURA - ALTURA, ALTURA)
  ctx.fillStyle = COR.borda
  ctx.fillRect(ALTURA, 0, 1, ALTURA)
  ctx.textAlign = 'left'
  ctx.fillStyle = COR.fraco
  ctx.font = `500 20px ${FONTE}`
  ctx.fillText(`${nomeMapa(replay.map)} · ${rotuloContagem(item, total)}`, x0, 72)
  ctx.fillStyle = COR.texto
  ctx.font = `600 48px ${FONTE}`
  ctx.fillText(`Round ${item.round}`, x0, 130)
  item.kills.slice(0, 4).forEach((k, i) => {
    const { linha, detalhe } = textoKill(replay, k)
    const y = 210 + i * 86
    const aconteceu = frame >= item.framesKill[i]
    ctx.globalAlpha = aconteceu ? 1 : 0.45
    ctx.fillStyle = COR.texto
    ctx.font = `500 24px ${FONTE}`
    ctx.fillText(linha, x0, y, LARGURA - x0 - 32)
    ctx.fillStyle = k.teamKill ? COR.perigo : COR.fraco
    ctx.font = `400 18px ${FONTE_MONO}`
    ctx.fillText(detalhe, x0, y + 30, LARGURA - x0 - 32)
    ctx.globalAlpha = 1
  })
  const seg = Math.max(0, (frame - item.framesKill[0]) / replay.tickRate)
  ctx.fillStyle = COR.fraco
  ctx.font = `400 18px ${FONTE_MONO}`
  ctx.fillText(`${frame < item.framesKill[0] ? '−' : '+'}${Math.abs(seg).toFixed(1)}s`, x0, ALTURA - 56)
  ctx.textAlign = 'right'
  ctx.fillText('Resenha · Clipe 2D', LARGURA - 32, ALTURA - 56)
}

export function desenharQuadro(ctx, posicao, contexto) {
  if (!ctx || !posicao.item) return
  if (posicao.item.tipo === 'titulo') desenharTitulo(ctx, posicao.item, contexto)
  else desenharCena(ctx, posicao.item, posicao.frame, { ...contexto, indice: posicao.indice })
}

function erroCancelado() {
  const e = new Error('Gravação cancelada')
  e.name = 'AbortError'
  return e
}

// Toca a timeline em tempo real no `canvas` e grava. Resolve com { blob, mime }.
// `agora`/`agendar` existem pra teste (relógio e loop injetáveis).
export function gravarClipe2D({
  canvas, timeline, replay, rounds, radar = null, sinal, onProgresso,
  agora = () => performance.now(),
  agendar = (fn) => requestAnimationFrame(fn),
  MR = globalThis.MediaRecorder,
}) {
  return new Promise((resolve, reject) => {
    if (sinal?.aborted) { reject(erroCancelado()); return }
    const ctx = canvas.getContext?.('2d') ?? null
    const base = typeof document !== 'undefined' ? document.createElement('canvas') : null
    if (base) { base.width = TAM; base.height = TAM }
    const contexto = { replay, rounds, radar, base, total: timeline.totalKills, cache: new Map() }

    const mime = escolherMimeType(MR)
    const stream = canvas.captureStream(FPS)
    let gravador
    try {
      gravador = new MR(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined)
    } catch (e) {
      stream.getTracks?.().forEach((t) => t.stop())
      reject(e)
      return
    }
    const pedacos = []
    let cancelado = false
    let encerrado = false

    gravador.ondataavailable = (e) => { if (e.data && e.data.size > 0) pedacos.push(e.data) }
    gravador.onerror = (e) => { encerrar(); reject(e?.error ?? new Error('Falha na gravação')) }
    gravador.onstop = () => {
      stream.getTracks?.().forEach((t) => t.stop())
      if (cancelado) { reject(erroCancelado()); return }
      const tipo = mime || gravador.mimeType || 'video/webm'
      resolve({ blob: new Blob(pedacos, { type: tipo }), mime: tipo })
    }

    function encerrar() {
      if (encerrado) return
      encerrado = true
      if (gravador.state !== 'inactive') gravador.stop()
    }
    sinal?.addEventListener?.('abort', () => { cancelado = true; encerrar() })

    desenharQuadro(ctx, posicaoNaTimeline(timeline, 0), contexto)
    gravador.start(250)
    const t0 = agora()

    function passo() {
      if (encerrado) return
      const pos = posicaoNaTimeline(timeline, agora() - t0)
      desenharQuadro(ctx, pos, contexto)
      onProgresso?.(pos.progresso)
      if (pos.fim) { encerrar(); return }
      agendar(passo)
    }
    agendar(passo)
  })
}
