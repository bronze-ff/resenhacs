// Mesma fórmula do pct privado de mapas.js: porcentagem com uma casa decimal.
function pct(parte, total) {
  return total ? Math.round((parte / total) * 1000) / 10 : null
}

export function montarPreFila({ jogadores, grupo, individual, duplas }) {
  const porMapa = new Map()
  for (const [lista, fonte] of [[individual, 'individual'], [grupo, 'grupo']]) {
    for (const { map, partidas, vitorias, decididas } of lista) {
      if (partidas >= 3) porMapa.set(map, { map, partidas, vitorias, winrate: pct(vitorias, decididas), fonte })
    }
  }
  const mapas = [...porMapa.values()].sort((a, b) =>
    (b.winrate ?? -1) - (a.winrate ?? -1) || b.partidas - a.partidas || a.map.localeCompare(b.map))
  const pares = duplas.filter(d => d.decididas >= 3)
    .map(({ a, b, partidas, vitorias, decididas }) => ({ a, b, partidas, vitorias, winrate: pct(vitorias, decididas) }))
  const desempata = (a, b) => b.partidas - a.partidas || a.a.localeCompare(b.a) || a.b.localeCompare(b.b)
  const melhorDupla = [...pares].sort((a, b) => b.winrate - a.winrate || desempata(a, b))[0] ?? null
  const pior = [...pares].sort((a, b) => a.winrate - b.winrate || desempata(a, b))[0]
  const piorDupla = pior && pior.winrate < melhorDupla.winrate ? pior : null
  return { jogadores, mapas, melhorDupla, piorDupla }
}
