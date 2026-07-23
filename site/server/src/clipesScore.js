// site/server/src/clipesScore.js
// Pontuação própria dos clipes (aba Competições + aba Clipes) — a Allstar não expõe a
// fórmula deles no webhook, então esta é uma fórmula nossa, granular o bastante pra não
// empatar na prática (a versão anterior tinha só 16 valores possíveis — 8 `kind` × bônus
// binário de headshot). Ver docs/superpowers/specs/2026-07-22-competicoes-clipes-design.md.
const PONTOS_POR_KILL = { 0: 0, 1: 10, 2: 25, 3: 50, 4: 80, 5: 120 }
const PONTOS_POR_HEADSHOT = 8
const PONTOS_POR_ARMA = 5
const PONTOS_CLUTCH = { '1v1': 10, '1v2': 20, '1v3': 35, '1v4': 55, '1v5': 80 }

export function calcularPontuacao({ kills = 0, headshots = 0, clutchKind = null, armasDistintas = 0 }) {
  const killsClamp = Math.min(Math.max(kills, 0), 5)
  const pontosKills = PONTOS_POR_KILL[killsClamp]
  const pontosHeadshots = Math.max(headshots, 0) * PONTOS_POR_HEADSHOT
  const pontosClutch = PONTOS_CLUTCH[clutchKind] ?? 0
  const pontosArmas = Math.max(armasDistintas, 0) * PONTOS_POR_ARMA
  return {
    kills, pontosKills,
    headshots, pontosHeadshots,
    clutch: clutchKind ?? null, pontosClutch,
    armas: armasDistintas, pontosArmas,
    total: pontosKills + pontosHeadshots + pontosClutch + pontosArmas,
  }
}
