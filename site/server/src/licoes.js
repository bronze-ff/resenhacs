import { JANELA_TROCA_TICKS } from './trades.js'

function resumir(mortes) {
  return {
    quantidade: mortes.length,
    rounds: mortes.map((k) => ({ round: k.roundNumber, tick: k.tick }))
      .sort((a, b) => a.round - b.round || a.tick - b.tick).slice(0, 5),
  }
}

export function calcularLicoes({ steamId, jogadores, kills, flashes }) {
  const times = new Map(jogadores.map((j) => [j.steamId, j.team]))
  const validas = kills.filter((k) => k.killer != null && !k.isTeamKill)
  const mortes = validas.filter((k) => k.victim === steamId)
  const primeiraTick = new Map()
  for (const k of validas) {
    primeiraTick.set(k.roundNumber, Math.min(primeiraTick.get(k.roundNumber) ?? Infinity, k.tick))
  }
  // O Coletor usa 64 ticks/s: a janela de 5 s de trades.js equivale a 320 ticks.
  const semTrade = mortes.filter((morte) => !validas.some((k) =>
    k.roundNumber === morte.roundNumber && k.victim === morte.killer &&
    k.killer !== steamId && times.get(k.killer) === times.get(steamId) &&
    k.tick >= morte.tick && k.tick - morte.tick <= JANELA_TROCA_TICKS,
  ))
  const flashAliado = { vezes: 0, segundos: 0 }
  for (const f of flashes) {
    if (f.attacker !== steamId || f.victim === steamId || times.get(steamId) == null || times.get(f.victim) !== times.get(steamId)) continue
    flashAliado.vezes += f.count
    flashAliado.segundos += f.durationSum
  }
  flashAliado.segundos = Math.round(flashAliado.segundos * 10) / 10
  return {
    mortesSemTrade: resumir(semTrade),
    primeirasMortes: resumir(mortes.filter((k) => k.tick === primeiraTick.get(k.roundNumber))),
    flashAliado,
  }
}
