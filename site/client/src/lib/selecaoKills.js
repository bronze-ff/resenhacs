// Lógica pura do seletor de kills dos clipes (o componente fica em
// components/clipes/SeletorKills.jsx). Kill no formato de
// GET /api/matches/:id/kills?jogador=<steamId64>.

const GRANADAS = new Set(['hegrenade', 'molotov', 'incgrenade', 'inferno', 'flashbang', 'smokegrenade', 'decoy'])

export function ehGranada(weapon) {
  return GRANADAS.has(weapon)
}

// Identidade estável de uma kill: a vítima só morre uma vez por round.
export function chaveKill(k) {
  return `${k.round}:${k.tick}:${k.victim?.steamId ?? ''}`
}

export function ordenarKills(kills) {
  return [...kills].sort((a, b) => a.round - b.round || a.tick - b.tick)
}

// Só as kills feitas pelo jogador escolhido (o endpoint filtra por jogador, mas o
// contrato não garante se mortes dele entram na lista — aqui o clipe é de quem matou).
export function killsDoJogador(kills, steamId) {
  return ordenarKills((kills ?? []).filter((k) => k.killer?.steamId === steamId))
}

export function filtrarKills(kills, { soTkGranada = false } = {}) {
  if (!soTkGranada) return kills
  return kills.filter((k) => k.teamKill || ehGranada(k.weapon))
}

// "Kill bonita": quanto mais marca difícil, mais pontos. Usado pelo atalho
// "1 por round" pra escolher a melhor de cada round (empate = a primeira).
export function pontuacaoKill(k) {
  return (
    (k.headshot ? 2 : 0) + (k.wallbang ? 3 : 0) + (k.thrusmoke ? 2 : 0) +
    (k.attackerblind ? 2 : 0) + (k.noscope ? 3 : 0) + (ehGranada(k.weapon) ? 1 : 0)
  )
}

export function umaPorRound(kills) {
  const melhor = new Map()
  for (const k of ordenarKills(kills)) {
    const atual = melhor.get(k.round)
    if (!atual || pontuacaoKill(k) > pontuacaoKill(atual)) melhor.set(k.round, k)
  }
  return [...melhor.values()].map(chaveKill)
}

// Marcas da kill, na ordem em que aparecem na tabela. `tom` segue o Badge do ui.
export function marcasKill(k) {
  const marcas = []
  if (k.teamKill) marcas.push({ id: 'tk', rotulo: 'TK', titulo: 'Fogo amigo (matou alguém do próprio time)', tom: 'perigo' })
  if (k.headshot) marcas.push({ id: 'hs', rotulo: 'HS', titulo: 'Headshot', tom: 'neutro' })
  if (k.wallbang) marcas.push({ id: 'wallbang', rotulo: 'Wallbang', titulo: 'Atravessou parede', tom: 'neutro' })
  if (k.thrusmoke) marcas.push({ id: 'smoke', rotulo: 'Smoke', titulo: 'Através da smoke', tom: 'neutro' })
  if (k.attackerblind) marcas.push({ id: 'cego', rotulo: 'Cego', titulo: 'Matou estando cego', tom: 'neutro' })
  if (k.noscope) marcas.push({ id: 'noscope', rotulo: 'Noscope', titulo: 'Sem mira', tom: 'neutro' })
  return marcas
}
