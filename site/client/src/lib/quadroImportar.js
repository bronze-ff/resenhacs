// "Importar de um round": pega um frame do Replay 2D e vira o passo 1 do Quadro tático.
//
// O replay já guarda as posições normalizadas no radar (0..1, mesmas coords que o
// ReplayViewer multiplica pelo tamanho do canvas), então a conversão é direta — desde que
// o mapa esteja calibrado. Sem calibração as coords são cruas do jogo e não cabem no radar.

import { novoId } from './quadroEditor.js'

const limitar = (v) => Math.min(1, Math.max(0, v))

// Puro: replay (com o round já carregado, com `frames`) → objetos do passo 1.
export function objetosDoFrame(replay, numeroRound, frameIdx) {
  if (!replay?.calibrated) return { erro: 'Esse mapa não tem calibração de radar; não dá pra importar as posições.' }
  const round = replay.rounds?.find((r) => r.round === numeroRound)
  const frames = round?.frames ?? []
  if (frames.length === 0) return { erro: 'Round sem dados de posição.' }
  const idx = Math.min(frames.length - 1, Math.max(0, Math.floor(Number(frameIdx) || 0)))
  const frame = frames[idx]
  const objetos = []
  for (const p of frame.players ?? []) {
    if (!p.alive) continue
    if (p.side !== 'CT' && p.side !== 'T') continue
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    const rotulo = String(replay.names?.[p.id] ?? '').slice(0, 24)
    objetos.push({
      id: novoId(),
      tipo: p.side === 'CT' ? 'ct' : 't',
      x: limitar(p.x),
      y: limitar(p.y),
      ...(rotulo ? { rotulo } : {}),
    })
  }
  // CT primeiro, depois T — a ordem do frame não importa pro quadro, só pra leitura.
  objetos.sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'ct' ? -1 : 1))
  return { map: replay.map, objetos, frame: idx }
}

// Busca o índice do replay e, no formato novo (streaming por round), o round pedido.
// Mesmos endpoints da SecaoReplay da Partida.
export async function buscarRoundDoReplay(matchId, numeroRound, fetchImpl = fetch) {
  const base = `/api/matches/${encodeURIComponent(matchId)}/replay`
  // fetch segue o 302 da API até a URL pré-assinada do R2 (redirect padrão).
  const resIndice = await fetchImpl(base)
  if (!resIndice.ok) throw new Error('replay indisponível')
  const indice = await resIndice.json()
  const meta = indice.rounds?.find((r) => r.round === numeroRound)
  if (!meta) throw new Error('round não encontrado')
  if (meta.frames !== undefined) return indice
  const resRound = await fetchImpl(`${base}/round/${numeroRound}`)
  if (!resRound.ok) throw new Error('round indisponível')
  const round = await resRound.json()
  return { ...indice, rounds: indice.rounds.map((r) => (r.round === numeroRound ? round : r)) }
}

// Lê ?partida=&round=&tick= da URL. Devolve null se faltar algo ou vier fora do formato.
export function paramsImportacao(searchParams) {
  const partida = searchParams.get('partida')
  const round = Number(searchParams.get('round'))
  const tick = Number(searchParams.get('tick') ?? 0)
  if (!partida || !/^[0-9a-f-]{36}$/i.test(partida)) return null
  if (!Number.isInteger(round) || round < 1) return null
  if (!Number.isInteger(tick) || tick < 0) return null
  return { partida, round, tick }
}
