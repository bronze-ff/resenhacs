// Classificação de estilo de jogo e badges automáticos — puros, sem I/O, fáceis de
// testar. Calculados sobre os agregados que já existem (match_players/highlights),
// nenhum parsing novo.

const ESTILOS = [
  // razao = valor do jogador ÷ média do grupo elegível (3+ partidas). >= 1.25 = "se
  // destaca" nessa dimensão. O jogador ganha o estilo de maior razão (o que mais o
  // diferencia do grupo), não o de maior valor absoluto.
  { tag: 'entry', label: 'Entry Fragger', calc: (p) => p.entryRate },
  { tag: 'suporte', label: 'Suporte', calc: (p) => p.utilityPerRound },
  { tag: 'clutch', label: 'Jogador de Clutch', calc: (p) => (p.clutchAttempts >= 3 ? p.clutchPct : 0) },
  { tag: 'mira', label: 'Mira Cirúrgica', calc: (p) => p.accuracy },
]
const LIMIAR_DESTAQUE = 1.25
const PARTIDAS_MINIMAS = 3

// jogadores: [{ steamId, partidas, entryRate, utilityPerRound, clutchPct, clutchAttempts, accuracy }]
// Devolve { [steamId]: { tag, label } | null } — null pra quem não tem partidas suficientes.
export function calcularEstilos(jogadores) {
  const elegiveis = jogadores.filter((j) => j.partidas >= PARTIDAS_MINIMAS)
  const medias = {}
  for (const e of ESTILOS) {
    const valores = elegiveis.map((j) => e.calc(j)).filter((v) => Number.isFinite(v) && v >= 0)
    medias[e.tag] = valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : 0
  }

  const porJogador = {}
  for (const j of jogadores) {
    if (j.partidas < PARTIDAS_MINIMAS) {
      porJogador[j.steamId] = null
      continue
    }
    let melhor = null
    for (const e of ESTILOS) {
      const media = medias[e.tag]
      if (!media) continue
      const razao = e.calc(j) / media
      if (razao >= LIMIAR_DESTAQUE && (!melhor || razao > melhor.razao)) {
        melhor = { tag: e.tag, label: e.label, razao }
      }
    }
    porJogador[j.steamId] = melhor ? { tag: melhor.tag, label: melhor.label } : { tag: 'rifler', label: 'Rifler' }
  }
  return porJogador
}

const BADGES = [
  { tag: 'primeiro_ace', label: 'Primeiro ACE', icon: '⭐', check: (s) => s.aces >= 1 },
  { tag: 'primeiro_clutch', label: 'Primeiro clutch', icon: '🎯', check: (s) => s.clutchWins >= 1 },
  { tag: 'clutch_mestre', label: 'Mestre do clutch (10 vitórias)', icon: '👑', check: (s) => s.clutchWins >= 10 },
  { tag: 'sequencia_5', label: '5 vitórias seguidas', icon: '🔥', check: (s) => s.melhorSequencia >= 5 },
  { tag: 'mira_cirurgica', label: 'Mira cirúrgica (30%+ de precisão)', icon: '🔫', check: (s) => s.accuracy >= 30 },
  { tag: 'entry_fragger', label: 'Abre portas (30+ entry kills)', icon: '🚪', check: (s) => s.entryKills >= 30 },
  { tag: 'veterano', label: 'Veterano (50 partidas)', icon: '🎖️', check: (s) => s.partidas >= 50 },
  { tag: 'centuriao', label: 'Centurião (100 partidas)', icon: '💯', check: (s) => s.partidas >= 100 },
]

// stats: { aces, clutchWins, melhorSequencia, accuracy, entryKills, partidas }
export function calcularBadges(stats) {
  return BADGES.filter((b) => b.check(stats)).map((b) => ({ tag: b.tag, label: b.label, icon: b.icon }))
}

// Maior sequência de vitórias consecutivas. `resultados`: array de won (true/false/null)
// em ordem cronológica — empate (null) quebra a sequência sem contar como derrota.
export function melhorSequenciaDeVitorias(resultados) {
  let melhor = 0
  let atual = 0
  for (const won of resultados) {
    atual = won === true ? atual + 1 : 0
    if (atual > melhor) melhor = atual
  }
  return melhor
}
