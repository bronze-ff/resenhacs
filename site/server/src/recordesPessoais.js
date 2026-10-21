// Recorde pessoal: uma Partida em que o Jogador superou a própria melhor marca de todas
// as Partidas anteriores dele num stat. Alimenta o aviso "você bateu seu recorde" no
// Feed (estilo Leetify). Lógica pura pra testar sem banco.

function arred1(n) {
  return Math.round(n * 10) / 10
}

// ADR e rating são taxas por round: numa Partida encerrada com 3 rounds um ADR 200+ viraria
// recorde. Abaixo desse mínimo a Partida não conta pra essas duas métricas.
export const MIN_ROUNDS_RECORDE = 10

export const METRICAS_RECORDE = [
  { chave: 'kills', nome: 'kills', valor: (r) => r.kills },
  { chave: 'adr', nome: 'ADR', valor: (r) => (r.rounds_played >= MIN_ROUNDS_RECORDE ? arred1(r.damage / r.rounds_played) : null) },
  { chave: 'rating', nome: 'rating', valor: (r) => (r.rating == null || r.rounds_played < MIN_ROUNDS_RECORDE ? null : Number(r.rating)) },
  { chave: 'utilitaria', nome: 'dano de utilitária', valor: (r) => r.utility_damage ?? null },
]

// `linhas`: as Partidas do Jogador em ordem cronológica crescente, cada uma com
// match_id, map, played_at e os campos crus de match_players.
// Só conta recorde depois de `minimoAnteriores` Partidas com o stat: sem isso a 2ª
// Partida de alguém novo vira "recorde" de tudo.
// Devolve no máximo um recorde por métrica (o mais recente), do mais novo pro mais velho,
// só das Partidas jogadas a partir de `desde`.
// `base`: o histórico MAIS VELHO que `linhas`, já agregado — `{ [chave]: { max, n } }`
// (melhor marca e quantas Partidas com o stat). Sem ele, a comparação começaria do zero
// na primeira linha recebida.
export function recordesPessoais(linhas, { desde, minimoAnteriores = 10, base = {} } = {}) {
  const limite = desde ? new Date(desde).getTime() : -Infinity
  const porMetrica = new Map()
  for (const m of METRICAS_RECORDE) {
    let melhor = base[m.chave]?.max ?? null
    let anteriores = base[m.chave]?.n ?? 0
    for (const r of linhas) {
      const v = m.valor(r)
      if (v == null) continue
      const ts = r.played_at ? new Date(r.played_at).getTime() : null
      if (melhor != null && anteriores >= minimoAnteriores && v > melhor && ts != null && ts >= limite) {
        porMetrica.set(m.chave, {
          metrica: m.chave,
          nome: m.nome,
          valor: v,
          anterior: melhor,
          matchId: r.match_id,
          map: r.map,
          playedAt: r.played_at,
        })
      }
      if (melhor == null || v > melhor) melhor = v
      anteriores += 1
    }
  }
  return [...porMetrica.values()].sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt))
}
