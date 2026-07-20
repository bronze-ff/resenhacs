// Recalcula K/D/A/ADR/rating/KAST filtrado por lado (T/CT) dentro de UMA Partida —
// pedido do usuário (estilo scope.gg/Leetify: clicar em "T"/"CT" recalcula a tabela
// só com os rounds daquele lado). Porta em JS das mesmas fórmulas do coletor
// (transform.py: hltv_rating, trade_kills, kast_pct) — têm que ficar em sincronia se
// uma mudar. Roda em cima de dado já persistido (kill_positions + match_player_round_damage),
// sem reparsear o .dem.

const JANELA_TRADE_TICKS = 5 * 64 // 5s a 64 tick — mesma janela de transform.py

// Uma kill é "trade" quando vinga um companheiro morto há pouco, dentro da janela.
function tradeKills(kills, teams) {
  const porRound = new Map()
  for (const k of kills) {
    if (!porRound.has(k.roundNumber)) porRound.set(k.roundNumber, [])
    porRound.get(k.roundNumber).push(k)
  }
  const saida = []
  for (const roundKills of porRound.values()) {
    const ordenado = [...roundKills].filter((k) => k.killer).sort((a, b) => a.tick - b.tick)
    for (let i = 0; i < ordenado.length; i++) {
      const k = ordenado[i]
      const atkTime = teams.get(k.killer)
      for (let j = i - 1; j >= 0; j--) {
        const anterior = ordenado[j]
        if (k.tick - anterior.tick > JANELA_TRADE_TICKS) break
        if (anterior.killer === k.victim && teams.get(anterior.victim) === atkTime) {
          saida.push({ roundNumber: k.roundNumber, attacker: k.killer, avengedTeammate: anterior.victim })
          break
        }
      }
    }
  }
  return saida
}

// % de rounds (do subconjunto `roundNumbers`) com Kill, Assist, Sobreviveu ou Traded.
function kastPct(kills, trades, steamIds, roundNumbers) {
  const resultado = new Map(steamIds.map((s) => [s, 0]))
  if (roundNumbers.length === 0) return resultado
  const porRound = new Map()
  for (const k of kills) {
    if (!porRound.has(k.roundNumber)) porRound.set(k.roundNumber, [])
    porRound.get(k.roundNumber).push(k)
  }
  const vingadosPorRound = new Map()
  for (const t of trades) {
    if (!vingadosPorRound.has(t.roundNumber)) vingadosPorRound.set(t.roundNumber, new Set())
    vingadosPorRound.get(t.roundNumber).add(t.avengedTeammate)
  }
  const atende = new Map(steamIds.map((s) => [s, 0]))
  for (const rn of roundNumbers) {
    const roundKills = porRound.get(rn) || []
    const morreram = new Set(roundKills.map((k) => k.victim))
    const mataram = new Set(roundKills.filter((k) => k.killer).map((k) => k.killer))
    const assistiram = new Set(roundKills.filter((k) => k.assister).map((k) => k.assister))
    const vingados = vingadosPorRound.get(rn) || new Set()
    for (const sid of steamIds) {
      if (mataram.has(sid) || assistiram.has(sid) || vingados.has(sid) || !morreram.has(sid)) {
        atende.set(sid, atende.get(sid) + 1)
      }
    }
  }
  for (const sid of steamIds) {
    resultado.set(sid, Math.round((atende.get(sid) / roundNumbers.length) * 1000) / 10)
  }
  return resultado
}

function distribuicaoMultikills(kills, steamId) {
  const porRound = new Map()
  for (const k of kills) {
    if (k.killer !== steamId) continue
    porRound.set(k.roundNumber, (porRound.get(k.roundNumber) || 0) + 1)
  }
  const contagem = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const qtd of porRound.values()) {
    const capped = Math.min(qtd, 5)
    if (capped >= 1) contagem[capped] += 1
  }
  return contagem
}

// Aproximação do HLTV Rating 1.0 — mesma fórmula de transform.py:hltv_rating.
function hltvRating(kills, deaths, rounds, k) {
  if (rounds <= 0) return 0
  const killRating = kills / rounds / 0.679
  const survivalRating = (rounds - deaths) / rounds / 0.317
  const pontosMulti = 1 * k[1] + 4 * k[2] + 9 * k[3] + 16 * k[4] + 25 * k[5]
  const multiRating = pontosMulti / rounds / 1.277
  return Math.round(((killRating + 0.7 * survivalRating + multiRating) / 2.7) * 100) / 100
}

// `rounds` de um TIME específico pro filtro pedido — lado troca de sentido conforme
// o time (side_a é sempre relativo ao time A; o time B é sempre o oposto).
function roundsDoTime(rounds, time, filtro) {
  if (filtro === 'all') return rounds.map((r) => r.roundNumber)
  return rounds
    .filter((r) => {
      if (!r.sideA) return false
      const ladoDoTime = time === 'A' ? r.sideA : r.sideA === 'CT' ? 'T' : 'CT'
      return ladoDoTime === filtro
    })
    .map((r) => r.roundNumber)
}

/**
 * @param players [{steamId, team}] — time FIXO A/B de cada jogador.
 * @param rounds [{roundNumber, sideA}] — sideA pode ser null (partida não reprocessada
 *   depois do FIL-51b) — nesse caso o filtro T/CT não acha nenhum round (roundsPlayed=0).
 * @param kills [{roundNumber, tick, killer, victim, assister, headshot}] — kills reais
 *   (kill_positions já exclui team-kill no coletor).
 * @param roundDamage [{roundNumber, steamId, damage}]
 * @param filtro 'all' | 'CT' | 'T'
 * @returns {Object<string, {kills,deaths,assists,headshotKills,damage,roundsPlayed,adr,hsPct,kastPct,rating}>}
 */
export function calcularStatsPorLado({ players, rounds, kills, roundDamage, filtro }) {
  const teams = new Map(players.map((p) => [p.steamId, p.team]))
  const porTime = new Map() // time -> [steamIds]
  for (const p of players) {
    if (!porTime.has(p.team)) porTime.set(p.team, [])
    porTime.get(p.team).push(p.steamId)
  }

  const resultado = {}
  for (const [time, steamIds] of porTime) {
    const roundNumbers = roundsDoTime(rounds, time, filtro)
    const roundSet = new Set(roundNumbers)
    const killsDoTime = kills.filter((k) => roundSet.has(k.roundNumber))
    const trades = tradeKills(killsDoTime, teams)
    const kast = kastPct(killsDoTime, trades, steamIds, roundNumbers)

    for (const sid of steamIds) {
      const meusKills = killsDoTime.filter((k) => k.killer === sid).length
      const minhasMortes = killsDoTime.filter((k) => k.victim === sid).length
      const meusHS = killsDoTime.filter((k) => k.killer === sid && k.headshot).length
      const meusAssists = killsDoTime.filter((k) => k.assister === sid).length
      const meuDano = roundDamage
        .filter((d) => d.steamId === sid && roundSet.has(d.roundNumber))
        .reduce((s, d) => s + d.damage, 0)
      const dist = distribuicaoMultikills(killsDoTime, sid)
      resultado[sid] = {
        kills: meusKills,
        deaths: minhasMortes,
        assists: meusAssists,
        headshotKills: meusHS,
        damage: meuDano,
        roundsPlayed: roundNumbers.length,
        adr: roundNumbers.length ? Math.round((meuDano / roundNumbers.length) * 10) / 10 : 0,
        hsPct: meusKills ? Math.round((meusHS / meusKills) * 1000) / 10 : 0,
        kastPct: kast.get(sid) ?? 0,
        rating: hltvRating(meusKills, minhasMortes, roundNumbers.length, dist),
      }
    }
  }
  return resultado
}
