// Helpers puros da biblioteca automática de granadas (clusters de /api/granadas/automaticas).

export const ROTULO_TIPO = { smoke: 'Smoke', flash: 'Flash', molotov: 'Molotov', he: 'HE' }

// Dica que acompanha o comando copiado: setpos/setang só funcionam com cheats.
export const DICA_TREINO = 'Num servidor local (ex.: map de_mirage), rode sv_cheats 1 no console e cole o comando.'

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by)

// Chamada mais próxima de um ponto do radar (0..1); null se nenhuma estiver perto.
export function calloutMaisProximo(callouts, x, y, raio = 0.12) {
  let melhor = null
  let melhorD = raio
  for (const c of callouts ?? []) {
    const d = dist(c.x, c.y, x, y)
    if (d < melhorD) { melhor = c; melhorD = d }
  }
  return melhor?.nome ?? null
}

// Nome legível do lineup a partir das chamadas do mapa: "Smoke em Jungle, de T spawn".
export function nomeLineup(cluster, callouts) {
  const tipo = ROTULO_TIPO[cluster.tipo] ?? cluster.tipo
  const alvo = calloutMaisProximo(callouts, cluster.alvoX, cluster.alvoY)
  const de = calloutMaisProximo(callouts, cluster.arremessoX, cluster.arremessoY)
  if (!alvo) return tipo
  return de && de !== alvo ? `${tipo} em ${alvo}, de ${de}` : `${tipo} em ${alvo}`
}

// Link pro Replay 2D da Partida de exemplo. Só Partida do grupo abre (Partida pro não
// tem página); null nesse caso.
export function linkReplay(exemplo) {
  if (!exemplo || exemplo.origem !== 'grupo' || !exemplo.matchId) return null
  const qs = new URLSearchParams({ round: String(exemplo.roundNumber), tick: String(exemplo.tick) })
  if (exemplo.frame != null) qs.set('frame', String(exemplo.frame))
  return `/partida/${encodeURIComponent(exemplo.matchId)}?${qs.toString()}`
}

// Direção da mira no radar a partir do yaw de mundo (graus). No CS, yaw 0 aponta pra +X
// (direita no radar) e 90 pra +Y (que no radar é PRA CIMA, porque o eixo Y da imagem é
// invertido). Devolve um vetor unitário no espaço do radar.
export function vetorMira(yaw) {
  const r = (Number(yaw) * Math.PI) / 180
  return { dx: Math.cos(r), dy: -Math.sin(r) }
}

// Pitch do CS: negativo = mirando pra cima.
export function descreverPitch(pitch) {
  const p = Number(pitch)
  if (!Number.isFinite(p) || Math.abs(p) < 2) return 'reto'
  return p < 0 ? 'pra cima' : 'pra baixo'
}

// viewBox (em 0..100) enquadrando arremesso e alvo com folga — o mini-radar do detalhe.
export function enquadrar(c, folga = 8, minimo = 24) {
  const xs = [c.arremessoX * 100, c.alvoX * 100]
  const ys = [c.arremessoY * 100, c.alvoY * 100]
  const lado = Math.min(100, Math.max(minimo, Math.max(xs[1] - xs[0], xs[0] - xs[1], ys[1] - ys[0], ys[0] - ys[1]) + folga * 2))
  const cx = (xs[0] + xs[1]) / 2
  const cy = (ys[0] + ys[1]) / 2
  const x = Math.min(100 - lado, Math.max(0, cx - lado / 2))
  const y = Math.min(100 - lado, Math.max(0, cy - lado / 2))
  return { x, y, lado }
}

export function filtrarClusters(clusters, { tipo = 'todos', lado = 'todos', origem = 'todos' } = {}) {
  return (clusters ?? []).filter((c) =>
    (tipo === 'todos' || c.tipo === tipo)
    && (lado === 'todos' || c.lado === lado)
    && (origem === 'todos' || (origem === 'grupo' ? c.usosGrupo > 0 : c.usosPro > 0)))
}
