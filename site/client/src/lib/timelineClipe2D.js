// Lógica pura do Clipe 2D: monta a sequência (cartão de título + cena do Replay 2D)
// a partir das kills escolhidas, e diz o que desenhar em cada instante da gravação.
// O desenho e o MediaRecorder ficam em gravadorClipe2D.js.
import { ordenarKills } from './selecaoKills.js'

export const SEGUNDOS_ANTES = 3
export const SEGUNDOS_DEPOIS = 2
export const DURACAO_TITULO_MS = 1000

// O endpoint de kills fala em tick da Demo; o replay fala em índice de frame do round
// (amostrado a ~8 Hz). A ponte é a própria kill do replay: a vítima só morre uma vez
// por round, então casar pela vítima basta. Desempata pelo killer se vier repetido
// (replay antigo com evento duplicado).
export function frameDaKill(kill, roundData) {
  const vitima = kill.victim?.steamId
  if (!vitima || !roundData?.kills?.length) return null
  const candidatas = roundData.kills.filter((k) => k.victim === vitima && k.t != null)
  if (candidatas.length === 0) return null
  const killer = kill.killer?.steamId ?? null
  const exata = candidatas.find((k) => (k.killer ?? null) === killer)
  return (exata ?? candidatas[0]).t
}

// `rounds`: { [numero]: round completo do replay (com frames e kills) }.
// Kills do mesmo round com janelas encostadas viram uma cena só (multi-kill não
// repete o mesmo trecho duas vezes).
export function montarTimeline(kills, {
  tickRate,
  rounds,
  antes = SEGUNDOS_ANTES,
  depois = SEGUNDOS_DEPOIS,
  tituloMs = DURACAO_TITULO_MS,
}) {
  const hz = tickRate > 0 ? tickRate : 8
  const cenas = []
  const ignoradas = []

  for (const kill of ordenarKills(kills ?? [])) {
    const rd = rounds?.[kill.round]
    const total = rd?.frames?.length ?? 0
    if (!total) { ignoradas.push({ kill, motivo: 'round sem Replay 2D' }); continue }
    const frame = frameDaKill(kill, rd)
    if (frame == null) { ignoradas.push({ kill, motivo: 'kill não encontrada no Replay 2D' }); continue }

    const frameIni = Math.max(0, Math.round(frame - antes * hz))
    const frameFim = Math.min(total - 1, Math.round(frame + depois * hz))
    const ultima = cenas[cenas.length - 1]
    if (ultima && ultima.round === kill.round && frameIni <= ultima.frameFim) {
      ultima.frameFim = Math.max(ultima.frameFim, frameFim)
      ultima.kills.push(kill)
      ultima.framesKill.push(frame)
    } else {
      cenas.push({ round: kill.round, frameIni, frameFim, kills: [kill], framesKill: [frame] })
    }
  }

  const itens = []
  let cursor = 0
  let contadorKill = 0
  for (const cena of cenas) {
    const primeiraKill = contadorKill + 1
    contadorKill += cena.kills.length
    const comum = { round: cena.round, kills: cena.kills, primeiraKill, ultimaKill: contadorKill }
    if (tituloMs > 0) {
      itens.push({ tipo: 'titulo', ...comum, inicioMs: cursor, duracaoMs: tituloMs })
      cursor += tituloMs
    }
    // +1 frame: a cena mostra o último frame inteiro em vez de cortar no instante dele.
    const duracaoMs = ((cena.frameFim - cena.frameIni + 1) / hz) * 1000
    itens.push({ tipo: 'cena', ...comum, frameIni: cena.frameIni, frameFim: cena.frameFim, framesKill: cena.framesKill, inicioMs: cursor, duracaoMs })
    cursor += duracaoMs
  }

  return { itens, duracaoMs: cursor, tickRate: hz, totalKills: contadorKill, ignoradas }
}

// O que mostrar `ms` milissegundos depois do início da gravação. `frame` é
// fracionário (o gravador interpola posições entre dois frames do replay).
export function posicaoNaTimeline(timeline, ms) {
  const { itens, duracaoMs, tickRate } = timeline
  if (!itens.length) return { indice: -1, item: null, frame: 0, progresso: 1, fim: true }
  const t = Math.max(0, ms)
  const fim = t >= duracaoMs
  const alvo = fim ? duracaoMs - 1e-6 : t
  let indice = itens.findIndex((it) => alvo >= it.inicioMs && alvo < it.inicioMs + it.duracaoMs)
  if (indice === -1) indice = itens.length - 1
  const item = itens[indice]
  let frame = 0
  if (item.tipo === 'cena') {
    frame = Math.min(item.frameFim, item.frameIni + ((alvo - item.inicioMs) / 1000) * tickRate)
  }
  return { indice, item, frame, progresso: duracaoMs > 0 ? Math.min(1, t / duracaoMs) : 1, fim }
}

// Recorte do mapa (coordenadas normalizadas 0..1) que enquadra killer e vítima de
// todas as kills da cena, com folga. Fixo durante a cena: câmera parada lê melhor
// que câmera seguindo boneco a 8 Hz.
export function enquadramento(roundData, item, { minimo = 0.4, folga = 0.14 } = {}) {
  const pontos = []
  item.kills.forEach((k, i) => {
    const frame = roundData?.frames?.[item.framesKill[i]]
    for (const id of [k.killer?.steamId, k.victim?.steamId]) {
      const p = id && frame?.players?.find((pl) => pl.id === id)
      if (p) pontos.push(p)
    }
  })
  if (!pontos.length) return { x: 0, y: 0, lado: 1 }
  const xs = pontos.map((p) => p.x)
  const ys = pontos.map((p) => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const lado = Math.min(1, Math.max(minimo, Math.max(maxX - minX, maxY - minY) + folga * 2))
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const prender = (v) => Math.min(1 - lado, Math.max(0, v))
  return { x: prender(cx - lado / 2), y: prender(cy - lado / 2), lado }
}

// Posições interpoladas entre o frame inteiro e o próximo (o replay é amostrado a
// ~8 Hz; o vídeo sai a 60 fps). Devolve um round com só aquele frame trocado.
export function roundInterpolado(roundData, frame) {
  const i = Math.floor(frame)
  const a = frame - i
  const atual = roundData?.frames?.[i]
  const prox = roundData?.frames?.[i + 1]
  if (!atual || !prox || a <= 0) return roundData
  const porId = new Map(prox.players.map((p) => [p.id, p]))
  const players = atual.players.map((p) => {
    const q = porId.get(p.id)
    if (!q || !p.alive) return p
    let dy = (q.yaw ?? 0) - (p.yaw ?? 0)
    if (dy > 180) dy -= 360
    if (dy < -180) dy += 360
    return { ...p, x: p.x + (q.x - p.x) * a, y: p.y + (q.y - p.y) * a, yaw: (p.yaw ?? 0) + dy * a }
  })
  const frames = roundData.frames.slice()
  frames[i] = { ...atual, players }
  return { ...roundData, frames }
}
