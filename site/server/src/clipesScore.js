// Pontuação própria dos clipes (aba Clipes) — a Allstar não expõe a fórmula deles no
// webhook (só clipUrl/clipTitle/clipSnapshotURL/status), então esta é uma fórmula
// nossa: base pelo tipo da jogada + bônus se todos os kills daquele round foram
// headshot. Ver docs/superpowers/specs/2026-07-21-aba-clipes-design.md.
const BASE_POR_KIND = {
  ace: 100,
  clutch_1v5: 100,
  clutch_1v4: 85,
  quad: 80,
  clutch_1v3: 65,
  triple: 60,
  clutch_1v2: 45,
  clutch_1v1: 25,
}
const BASE_PADRAO = 10
const BONUS_TODOS_HEADSHOT = 20

export function calcularPontuacao({ kind, todosHeadshot }) {
  const base = BASE_POR_KIND[kind] ?? BASE_PADRAO
  const bonusHeadshot = todosHeadshot ? BONUS_TODOS_HEADSHOT : 0
  return { base, kind, bonusHeadshot, total: base + bonusHeadshot }
}
