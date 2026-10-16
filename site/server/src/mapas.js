// Página Mapas (/mapas): desempenho de um Jogador por mapa, período atual vs período de
// comparação, com winrate de rounds por lado (CT/T) e a média do grupo como referência.
// Funções puras — a rota (routes/mapas.js) só busca as linhas e chama estas.

export const PARTIDAS_POR_PERIODO = 30
const DIA_MS = 86400000

export function dataValida(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
}

function inicioDoDia(s) {
  return Date.parse(`${s}T00:00:00Z`)
}
function fimDoDia(s) {
  return inicioDoDia(s) + DIA_MS - 1
}
function isoDia(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

function noIntervalo(partida, de, ate) {
  if (!partida.playedAt) return false
  const t = new Date(partida.playedAt).getTime()
  if (de && t < inicioDoDia(de)) return false
  if (ate && t > fimDoDia(ate)) return false
  return true
}

/**
 * Separa as Partidas do Jogador (já ordenadas da mais recente pra mais antiga) em período
 * atual e de comparação.
 * - Sem datas: as últimas 30 vs as 30 anteriores.
 * - Com `de`/`ate`: atual = esse intervalo. Comparação = `compararDe`/`compararAte` se
 *   vierem; senão, um intervalo do mesmo tamanho logo antes de `de` (só se `de` e `ate`
 *   vierem os dois — sem um dos lados não há "tamanho" pra repetir).
 */
export function separarPeriodos(partidas, { de, ate, compararDe, compararAte } = {}) {
  const deOk = dataValida(de) ? de : null
  const ateOk = dataValida(ate) ? ate : null
  if (!deOk && !ateOk) {
    const atual = partidas.slice(0, PARTIDAS_POR_PERIODO)
    const anterior = partidas.slice(PARTIDAS_POR_PERIODO, PARTIDAS_POR_PERIODO * 2)
    return { modo: 'partidas', atual, anterior, intervaloAtual: intervaloDe(atual), intervaloAnterior: intervaloDe(anterior) }
  }
  const atual = partidas.filter((p) => noIntervalo(p, deOk, ateOk))
  let cDe = dataValida(compararDe) ? compararDe : null
  let cAte = dataValida(compararAte) ? compararAte : null
  if (!cDe && !cAte && deOk && ateOk) {
    const dias = Math.round((inicioDoDia(ateOk) - inicioDoDia(deOk)) / DIA_MS) + 1
    cAte = isoDia(inicioDoDia(deOk) - DIA_MS)
    cDe = isoDia(inicioDoDia(deOk) - dias * DIA_MS)
  }
  const anterior = cDe || cAte ? partidas.filter((p) => noIntervalo(p, cDe, cAte)) : []
  return {
    modo: 'datas',
    atual,
    anterior,
    intervaloAtual: { de: deOk, ate: ateOk },
    intervaloAnterior: cDe || cAte ? { de: cDe, ate: cAte } : null,
  }
}

function intervaloDe(lista) {
  const datas = lista.map((p) => p.playedAt).filter(Boolean).map((d) => new Date(d).getTime())
  if (datas.length === 0) return null
  return { de: isoDia(Math.min(...datas)), ate: isoDia(Math.max(...datas)) }
}

export function ladoDoTime(time, sideA) {
  if (sideA !== 'CT' && sideA !== 'T') return null
  if (time === 'A') return sideA
  if (time === 'B') return sideA === 'CT' ? 'T' : 'CT'
  return null
}

function pct(parte, total) {
  return total ? Math.round((parte / total) * 1000) / 10 : null
}

function resumoPorMapa(partidas, roundsPorPartida) {
  const mapas = new Map()
  for (const p of partidas) {
    if (!mapas.has(p.map)) {
      mapas.set(p.map, { partidas: 0, vitorias: 0, derrotas: 0, empates: 0, lados: { CT: [0, 0], T: [0, 0] } })
    }
    const m = mapas.get(p.map)
    m.partidas += 1
    if (p.scoreA != null && p.scoreA === p.scoreB) m.empates += 1
    else if (p.won) m.vitorias += 1
    else m.derrotas += 1
    for (const r of roundsPorPartida.get(p.id) ?? []) {
      const lado = ladoDoTime(p.team, r.sideA)
      if (!lado) continue
      m.lados[lado][1] += 1
      if (r.winnerTeam === p.team) m.lados[lado][0] += 1
    }
  }
  return mapas
}

/**
 * @param partidas [{id, map, playedAt, team, won, scoreA, scoreB}] — do Jogador, mais recente primeiro.
 * @param rounds [{matchId, sideA, winnerTeam}]
 * @param grupo [{map, lado, rounds, vitorias}] — winrate de rounds por lado do grupo.
 */
export function montarMapas({ partidas, rounds, grupo, filtros }) {
  const periodos = separarPeriodos(partidas, filtros)
  const roundsPorPartida = new Map()
  for (const r of rounds) {
    if (!roundsPorPartida.has(r.matchId)) roundsPorPartida.set(r.matchId, [])
    roundsPorPartida.get(r.matchId).push(r)
  }
  const atual = resumoPorMapa(periodos.atual, roundsPorPartida)
  const anterior = resumoPorMapa(periodos.anterior, roundsPorPartida)
  const grupoPorMapa = new Map()
  for (const g of grupo) {
    if (!grupoPorMapa.has(g.map)) grupoPorMapa.set(g.map, {})
    grupoPorMapa.get(g.map)[g.lado] = pct(g.vitorias, g.rounds)
  }

  const mapas = [...atual.entries()]
    .map(([map, a]) => {
      const p = anterior.get(map)
      const winrate = pct(a.vitorias, a.partidas)
      const winrateAnterior = p ? pct(p.vitorias, p.partidas) : null
      const lado = (l) => ({
        atual: pct(a.lados[l][0], a.lados[l][1]),
        rounds: a.lados[l][1],
        anterior: p ? pct(p.lados[l][0], p.lados[l][1]) : null,
        grupo: grupoPorMapa.get(map)?.[l] ?? null,
      })
      return {
        map,
        partidas: a.partidas,
        vitorias: a.vitorias,
        derrotas: a.derrotas,
        empates: a.empates,
        winrate,
        anterior: p ? { partidas: p.partidas, winrate: winrateAnterior } : null,
        variacao: winrateAnterior == null ? null : Math.round((winrate - winrateAnterior) * 10) / 10,
        lados: { CT: lado('CT'), T: lado('T') },
      }
    })
    .sort((x, y) => y.partidas - x.partidas || x.map.localeCompare(y.map))

  return {
    periodo: {
      modo: periodos.modo,
      atual: { ...(periodos.intervaloAtual ?? { de: null, ate: null }), partidas: periodos.atual.length },
      anterior: { ...(periodos.intervaloAnterior ?? { de: null, ate: null }), partidas: periodos.anterior.length },
    },
    mapas,
  }
}
