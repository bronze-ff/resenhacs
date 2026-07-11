import { Router } from 'express'

// Duas Partidas entram na mesma "Resenha" (sessão) se a diferença entre elas é menor
// que isso — várias partidas seguidas numa noite viram um resumo só, em vez de N cards
// separados no feed. 3h cobre folga pro intervalo/trocar de mapa sem juntar noites diferentes.
const GAP_MS = 3 * 60 * 60 * 1000

function resultadoDeUmaPartida(jogadoresDoGrupo) {
  if (jogadoresDoGrupo.length === 0) return null
  if (jogadoresDoGrupo.every((p) => p.won === true)) return 'vitoria'
  if (jogadoresDoGrupo.every((p) => p.won === false)) return 'derrota'
  if (jogadoresDoGrupo.every((p) => p.won === null)) return 'empate'
  return 'misto'
}

export function createSessionsRouter({ db, requireAuth }) {
  const router = Router()

  // "Resenhas": Partidas jogadas seguidas (gap < 3h) agrupadas num resumo — quem se
  // destacou, quantas venceu/perdeu, ao invés de olhar partida por partida.
  router.get('/', requireAuth, async (req, res) => {
    const matchesQ = await db.query(
      `select id, map, played_at, score_a, score_b
       from matches where status = 'parsed' order by played_at asc nulls last`,
    )
    const playersQ = await db.query(
      `select mp.match_id, mp.steam_id64, p.nick, mp.kills, mp.deaths, mp.assists,
              mp.rating, mp.won, mp.clutch_wins, mp.entry_kills
       from match_players mp
       join players p on p.steam_id64 = mp.steam_id64
       where mp.match_id in (select id from matches where status = 'parsed')`,
    )
    const acesQ = await db.query(
      `select h.match_id, h.steam_id64, count(*)::int as aces
       from highlights h where h.kind = 'ace' group by h.match_id, h.steam_id64`,
    )

    const jogadoresPorPartida = new Map()
    for (const r of playersQ.rows) {
      if (!jogadoresPorPartida.has(r.match_id)) jogadoresPorPartida.set(r.match_id, [])
      jogadoresPorPartida.get(r.match_id).push(r)
    }
    const acesPorPartidaJogador = new Map()
    for (const r of acesQ.rows) acesPorPartidaJogador.set(`${r.match_id}:${r.steam_id64}`, r.aces)

    // Agrupa Partidas em sessões pelo gap de tempo.
    const sessoes = []
    let atual = null
    let ultimoTs = null
    for (const m of matchesQ.rows) {
      const ts = m.played_at ? new Date(m.played_at).getTime() : null
      if (!atual || (ts != null && ultimoTs != null && ts - ultimoTs > GAP_MS)) {
        atual = { inicio: m.played_at, fim: m.played_at, matches: [] }
        sessoes.push(atual)
      }
      atual.matches.push(m)
      atual.fim = m.played_at ?? atual.fim
      if (ts != null) ultimoTs = ts
    }

    const resumo = sessoes.map((s) => {
      const porJogador = new Map() // steamId -> agregado da sessão
      let vitorias = 0, derrotas = 0, empates = 0, mistos = 0
      for (const m of s.matches) {
        const jogadores = jogadoresPorPartida.get(m.id) ?? []
        const resultado = resultadoDeUmaPartida(jogadores)
        if (resultado === 'vitoria') vitorias++
        else if (resultado === 'derrota') derrotas++
        else if (resultado === 'empate') empates++
        else if (resultado === 'misto') mistos++

        for (const j of jogadores) {
          if (!porJogador.has(j.steam_id64)) {
            porJogador.set(j.steam_id64, {
              steamId: j.steam_id64, nick: j.nick, partidas: 0, kills: 0, deaths: 0,
              assists: 0, ratingSoma: 0, clutchWins: 0, entryKills: 0, aces: 0,
            })
          }
          const acc = porJogador.get(j.steam_id64)
          acc.partidas++
          acc.kills += j.kills
          acc.deaths += j.deaths
          acc.assists += j.assists
          acc.ratingSoma += j.rating == null ? 0 : Number(j.rating)
          acc.clutchWins += j.clutch_wins
          acc.entryKills += j.entry_kills
          acc.aces += acesPorPartidaJogador.get(`${m.id}:${j.steam_id64}`) ?? 0
        }
      }
      const jogadores = [...porJogador.values()]
        .map((j) => ({ ...j, ratingMedio: j.partidas ? Math.round((j.ratingSoma / j.partidas) * 100) / 100 : 0 }))
        .sort((a, b) => b.ratingMedio - a.ratingMedio)

      return {
        inicio: s.inicio,
        fim: s.fim,
        partidas: s.matches.length,
        vitorias, derrotas, empates, mistos,
        matchIds: s.matches.map((m) => m.id),
        destaque: jogadores[0] ?? null, // maior rating médio na sessão
        jogadores,
      }
    })

    resumo.reverse() // mais recente primeiro
    const limite = Number(req.query.limit) || 15
    res.json(resumo.slice(0, limite))
  })

  return router
}
