// Biblioteca automática de granadas: agrupa os arremessos reais (tabela `lineups`,
// alimentada pelo Coletor) em "lineups" — mesmo tipo + lado, posição de arremesso
// E alvo próximos no radar. Puro (sem db) pra ser testável direto.
//
// Coordenadas de radar são 0..1 (1024 px no radar da Valve). 0.02 ≈ 20 px ≈ 100
// unidades de mundo em Mirage (scale 5): o mesmo spot de arremesso com uma folga de
// posicionamento; o alvo tolera mais (a granada rola/quica).
export const RAIO_ARREMESSO = 0.02
export const RAIO_ALVO = 0.03

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by)

function mediana(valores) {
  const v = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(v.length / 2)
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2
}

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

function fmt(n) {
  const s = Number(n).toFixed(2)
  return s === '-0.00' ? '0.00' : s
}

// Comando de console do CS2 pra cair exatamente no spot, já mirando:
// `setpos X Y Z; setang PITCH YAW 0`. Devolve null se faltar qualquer coordenada.
export function comandoTreino(m) {
  if (!m) return null
  const { x, y, z, pitch, yaw } = m
  if ([x, y, z, pitch, yaw].some((v) => v == null || !Number.isFinite(v))) return null
  return `setpos ${fmt(x)} ${fmt(y)} ${fmt(z)}; setang ${fmt(pitch)} ${fmt(yaw)} 0`
}

// Linha crua do Postgres (snake_case, numeric como string) -> forma interna.
export function normalizarLinha(r) {
  const wx = num(r.thrower_world_x)
  const wy = num(r.thrower_world_y)
  const wz = num(r.thrower_world_z)
  return {
    id: r.id,
    matchId: r.match_id,
    roundNumber: Number(r.round_number),
    tick: Number(r.tick),
    frame: num(r.replay_frame),
    map: r.map,
    tipo: r.tipo,
    lado: r.lado ?? null,
    origem: r.origem,
    steamId: r.thrower_steam_id,
    nick: r.thrower_nick ?? '',
    ax: Number(r.thrower_x),
    ay: Number(r.thrower_y),
    tx: Number(r.target_x),
    ty: Number(r.target_y),
    yaw: num(r.thrower_yaw) ?? 0,
    pitch: num(r.thrower_pitch) ?? 0,
    mundo: wx != null && wy != null && wz != null
      ? { x: wx, y: wy, z: wz, yaw: num(r.thrower_yaw) ?? 0, pitch: num(r.thrower_pitch) ?? 0 }
      : null,
  }
}

function ranking(membros, chave, rotulo) {
  const cont = new Map()
  for (const m of membros) {
    const k = chave(m)
    const atual = cont.get(k) ?? { ...rotulo(m), usos: 0 }
    atual.usos += 1
    cont.set(k, atual)
  }
  return [...cont.values()].sort((a, b) => b.usos - a.usos || String(a.nick).localeCompare(String(b.nick))).slice(0, 3)
}

function maisProximo(membros, centro) {
  let melhor = null
  let melhorD = Infinity
  for (const m of membros) {
    const d = dist(m.ax, m.ay, centro.ax, centro.ay) + dist(m.tx, m.ty, centro.tx, centro.ty)
    if (d < melhorD) { melhor = m; melhorD = d }
  }
  return melhor
}

function resumirCluster(membros) {
  const centro = {
    ax: mediana(membros.map((m) => m.ax)),
    ay: mediana(membros.map((m) => m.ay)),
    tx: mediana(membros.map((m) => m.tx)),
    ty: mediana(membros.map((m) => m.ty)),
  }
  // Arremesso "mediano": o membro real mais perto da mediana (não uma média de
  // ângulos, que pode nem existir no jogo).
  const rep = maisProximo(membros, centro)
  // Exemplo pra abrir no Replay 2D: prefere partida do grupo (pro não abre na Partida).
  const doGrupo = membros.filter((m) => m.origem === 'grupo')
  const exemplo = doGrupo.length ? maisProximo(doGrupo, centro) : rep
  // Comando de treino: o membro mais central QUE tenha coordenada de mundo.
  const comMundo = membros.filter((m) => m.mundo)
  const treino = comMundo.length ? maisProximo(comMundo, centro) : null

  const usosGrupo = doGrupo.length
  return {
    id: `c-${rep.id}`,
    map: rep.map,
    tipo: rep.tipo,
    lado: rep.lado,
    total: membros.length,
    usosGrupo,
    usosPro: membros.length - usosGrupo,
    arremessoX: Number(centro.ax.toFixed(4)),
    arremessoY: Number(centro.ay.toFixed(4)),
    alvoX: Number(centro.tx.toFixed(4)),
    alvoY: Number(centro.ty.toFixed(4)),
    yaw: (treino ?? rep).yaw,
    pitch: (treino ?? rep).pitch,
    jogadores: ranking(doGrupo, (m) => m.steamId, (m) => ({ steamId: m.steamId, nick: m.nick })),
    pros: ranking(membros.filter((m) => m.origem === 'pro'), (m) => m.nick, (m) => ({ nick: m.nick })),
    exemplo: {
      matchId: exemplo.matchId,
      roundNumber: exemplo.roundNumber,
      tick: exemplo.tick,
      frame: exemplo.frame,
      origem: exemplo.origem,
    },
    mundo: treino ? treino.mundo : null,
    comando: treino ? comandoTreino(treino.mundo) : null,
  }
}

// linhas: já normalizadas. Agrupamento guloso (leader clustering) por tipo+lado: cada
// arremesso entra no cluster mais próximo cujo centróide está dentro dos dois raios, ou
// abre um novo. Ordem estável (por tick/id) pra o resultado não mudar a cada request.
export function agruparLineups(linhas, { raioArremesso = RAIO_ARREMESSO, raioAlvo = RAIO_ALVO, minUsos = 1 } = {}) {
  const porGrupo = new Map()
  const ordenadas = [...linhas].sort((a, b) => String(a.matchId).localeCompare(String(b.matchId))
    || a.tick - b.tick || String(a.id).localeCompare(String(b.id)))
  for (const l of ordenadas) {
    if (![l.ax, l.ay, l.tx, l.ty].every(Number.isFinite)) continue
    const chave = `${l.tipo}|${l.lado ?? ''}`
    if (!porGrupo.has(chave)) porGrupo.set(chave, [])
    const clusters = porGrupo.get(chave)
    let alvo = null
    let melhorD = Infinity
    for (const c of clusters) {
      const da = dist(l.ax, l.ay, c.ax, c.ay)
      const dt = dist(l.tx, l.ty, c.tx, c.ty)
      if (da <= raioArremesso && dt <= raioAlvo && da + dt < melhorD) { alvo = c; melhorD = da + dt }
    }
    if (!alvo) {
      alvo = { ax: l.ax, ay: l.ay, tx: l.tx, ty: l.ty, membros: [] }
      clusters.push(alvo)
    }
    alvo.membros.push(l)
    const n = alvo.membros.length
    alvo.ax += (l.ax - alvo.ax) / n
    alvo.ay += (l.ay - alvo.ay) / n
    alvo.tx += (l.tx - alvo.tx) / n
    alvo.ty += (l.ty - alvo.ty) / n
  }
  const saida = []
  for (const clusters of porGrupo.values()) {
    for (const c of clusters) {
      if (c.membros.length >= minUsos) saida.push(resumirCluster(c.membros))
    }
  }
  return saida.sort((a, b) => b.total - a.total || a.id.localeCompare(b.id))
}
