import { FaceitIcon } from './icones.jsx'

// Badge de ELO FACEIT — cores dos níveis oficiais (1 cinza, 2-3 verde, 4-7 amarelo,
// 8-9 laranja, 10 vermelho). `level` vem da API; se faltar, deriva do elo pelos
// thresholds oficiais. Não renderiza nada sem elo (mesma regra do PremierBadge).
const CORES_POR_NIVEL = {
  1: 'text-texto-fraco border-borda bg-superficie-alta',
  2: 'text-sucesso border-sucesso/40 bg-sucesso/10',
  3: 'text-sucesso border-sucesso/40 bg-sucesso/10',
  4: 'text-[#facc15] border-[#facc15]/40 bg-[#facc15]/10',
  5: 'text-[#facc15] border-[#facc15]/40 bg-[#facc15]/10',
  6: 'text-[#facc15] border-[#facc15]/40 bg-[#facc15]/10',
  7: 'text-[#facc15] border-[#facc15]/40 bg-[#facc15]/10',
  8: 'text-[#fb923c] border-[#fb923c]/40 bg-[#fb923c]/10',
  9: 'text-[#fb923c] border-[#fb923c]/40 bg-[#fb923c]/10',
  10: 'text-perigo border-perigo/40 bg-perigo/10',
}
const THRESHOLDS = [500, 750, 900, 1050, 1200, 1350, 1530, 1750, 2000]

function nivelDoElo(elo) {
  const idx = THRESHOLDS.findIndex((t) => elo <= t)
  return idx === -1 ? 10 : idx + 1
}

export default function FaceitEloBadge({ elo, level }) {
  if (elo == null) return null
  const nivel = level ?? nivelDoElo(elo)
  const cor = CORES_POR_NIVEL[nivel] ?? CORES_POR_NIVEL[1]
  return (
    <span
      title={`FACEIT nível ${nivel} — ${elo} de ELO`}
      className={`panel-cut-sm inline-flex items-center gap-1 border px-2 py-1 font-mono text-sm font-bold tabular-nums ${cor}`}
    >
      <FaceitIcon className="h-3.5 w-3.5 shrink-0" />
      {Math.round(elo)}
    </span>
  )
}
