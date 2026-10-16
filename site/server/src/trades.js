// Duelos de abertura e trocas (referência: Leetify "Opening Duels", "Trade Kill Success"
// e "Traded Death"). Função pura sobre o que já está persistido: kill_positions (round,
// tick, killer, victim) + time fixo de cada Jogador (match_players.team) + lado do time A
// por round (rounds.side_a). Sem reparsear a Demo.
//
// Definições (as mesmas que o texto da UI explica):
// - Duelo de abertura: a PRIMEIRA kill válida do round (killer conhecido, times opostos,
//   não é team-kill). O killer ganhou a abertura; a vítima perdeu.
// - Morte trocada: a vítima V (time X) foi morta por K e, em até JANELA_TROCA_TICKS depois,
//   um colega de V matou K no mesmo round.
// - Troca feita: a kill desse colega (ele "trocou" a morte de V).
// - Morte sem troca: morte por inimigo que ninguém trocou dentro da janela.
//
// Team-kill (is_team_kill, migration 0054) e morte sem killer (queda, bomba, mundo) não
// contam em nada: não abrem round, não são morte "trocável" e não são troca.

// Demos de MM/Premier e FACEIT são 64 tick (coletor/src/coletor/parse.py: demo_tick_rate=64).
// 5 s é a mesma janela de trade do coletor (transform.py) e de statsLado.js.
export const TICKRATE = 64
export const JANELA_TROCA_TICKS = 5 * TICKRATE

function ladoDoTime(time, sideA) {
  if (sideA !== 'CT' && sideA !== 'T') return null
  if (time === 'A') return sideA
  if (time === 'B') return sideA === 'CT' ? 'T' : 'CT'
  return null
}

function vazio() {
  return {
    aberturas: 0,
    aberturasGanhas: 0,
    aberturasPerdidas: 0,
    porLado: {
      CT: { aberturas: 0, aberturasGanhas: 0 },
      T: { aberturas: 0, aberturasGanhas: 0 },
    },
    mortes: 0,
    mortesTrocadas: 0,
    mortesSemTroca: 0,
    trocasFeitas: 0,
  }
}

/**
 * @param players [{steamId, team}] — time fixo A/B.
 * @param rounds [{roundNumber, sideA}] — sideA pode ser null (partida antiga): aí o
 *   duelo conta no total, mas não entra em porLado.
 * @param kills [{roundNumber, tick, killer, victim, isTeamKill?}]
 * @returns {Object<string, ReturnType<typeof vazio>>} por steamId (só quem está em players).
 */
export function calcularDuelos({ players = [], rounds = [], kills = [] }) {
  const times = new Map(players.map((p) => [p.steamId, p.team]))
  const sidePorRound = new Map(rounds.map((r) => [r.roundNumber, r.sideA]))
  const res = {}
  for (const p of players) res[p.steamId] = vazio()

  const validas = kills.filter((k) => {
    if (!k || !k.killer || !k.victim || k.isTeamKill) return false
    const tk = times.get(k.killer)
    const tv = times.get(k.victim)
    // Sem time conhecido não dá pra saber se é inimigo; mesmo time = team-kill
    // (cinto e suspensório pra partidas antes da coluna is_team_kill).
    return tk != null && tv != null && tk !== tv
  })

  const porRound = new Map()
  for (const k of validas) {
    if (!porRound.has(k.roundNumber)) porRound.set(k.roundNumber, [])
    porRound.get(k.roundNumber).push(k)
  }

  for (const [roundNumber, lista] of porRound) {
    const ordenadas = [...lista].sort((a, b) => a.tick - b.tick)
    const sideA = sidePorRound.get(roundNumber)

    // Duelo de abertura.
    const primeira = ordenadas[0]
    const ganhou = res[primeira.killer]
    const perdeu = res[primeira.victim]
    for (const [r, sid, venceu] of [[ganhou, primeira.killer, true], [perdeu, primeira.victim, false]]) {
      r.aberturas += 1
      if (venceu) r.aberturasGanhas += 1
      else r.aberturasPerdidas += 1
      const lado = ladoDoTime(times.get(sid), sideA)
      if (lado) {
        r.porLado[lado].aberturas += 1
        if (venceu) r.porLado[lado].aberturasGanhas += 1
      }
    }

    // Trocas: cada morte procura, adiante, um colega da vítima matando o killer na janela.
    for (let i = 0; i < ordenadas.length; i++) {
      const morte = ordenadas[i]
      const timeVitima = times.get(morte.victim)
      res[morte.victim].mortes += 1
      let troca = null
      for (let j = i + 1; j < ordenadas.length; j++) {
        const k = ordenadas[j]
        if (k.tick - morte.tick > JANELA_TROCA_TICKS) break
        if (k.victim === morte.killer && times.get(k.killer) === timeVitima) {
          troca = k
          break
        }
      }
      if (troca) {
        res[morte.victim].mortesTrocadas += 1
        res[troca.killer].trocasFeitas += 1
      } else {
        res[morte.victim].mortesSemTroca += 1
      }
    }
  }
  return res
}

function pct(parte, total) {
  return total ? Math.round((parte / total) * 1000) / 10 : null
}

// Soma resultados de várias Partidas (mesmo formato de calcularDuelos()[steamId]) e
// acrescenta as porcentagens prontas pra UI. `null` = sem amostra (a UI mostra "–").
export function somarDuelos(lista) {
  const total = vazio()
  for (const d of lista) {
    if (!d) continue
    total.aberturas += d.aberturas
    total.aberturasGanhas += d.aberturasGanhas
    total.aberturasPerdidas += d.aberturasPerdidas
    for (const lado of ['CT', 'T']) {
      total.porLado[lado].aberturas += d.porLado[lado].aberturas
      total.porLado[lado].aberturasGanhas += d.porLado[lado].aberturasGanhas
    }
    total.mortes += d.mortes
    total.mortesTrocadas += d.mortesTrocadas
    total.mortesSemTroca += d.mortesSemTroca
    total.trocasFeitas += d.trocasFeitas
  }
  return comPercentuais(total)
}

export function comPercentuais(d) {
  return {
    ...d,
    aberturasPct: pct(d.aberturasGanhas, d.aberturas),
    porLado: {
      CT: { ...d.porLado.CT, pct: pct(d.porLado.CT.aberturasGanhas, d.porLado.CT.aberturas) },
      T: { ...d.porLado.T, pct: pct(d.porLado.T.aberturasGanhas, d.porLado.T.aberturas) },
    },
    mortesTrocadasPct: pct(d.mortesTrocadas, d.mortes),
  }
}
