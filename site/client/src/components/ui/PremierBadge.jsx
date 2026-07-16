// Badge de Premier (CS Rating) — mesmas 7 faixas de cor que o próprio CS2 usa (fonte:
// pesquisa web confirmada na spec, docs/superpowers/specs/2026-07-16-premier-rating-design.md).
// Não renderiza nada se o jogador nunca jogou Premier (valor null) — sem "sem dado" cru
// ocupando espaço num lugar que boa parte do grupo pode nunca ter usado.
const FAIXAS = [
  { max: 5000, cor: 'text-texto-fraco', bg: 'bg-superficie-alta', border: 'border-borda' },
  { max: 10000, cor: 'text-time-b', bg: 'bg-time-b/10', border: 'border-time-b/40' },
  { max: 15000, cor: 'text-[#4f7fff]', bg: 'bg-[#4f7fff]/10', border: 'border-[#4f7fff]/40' },
  { max: 20000, cor: 'text-[#a855f7]', bg: 'bg-[#a855f7]/10', border: 'border-[#a855f7]/40' },
  { max: 25000, cor: 'text-[#ec4899]', bg: 'bg-[#ec4899]/10', border: 'border-[#ec4899]/40' },
  { max: 30000, cor: 'text-perigo', bg: 'bg-perigo/10', border: 'border-perigo/40' },
  { max: Infinity, cor: 'text-[#facc15]', bg: 'bg-[#facc15]/10', border: 'border-[#facc15]/40' },
]
function faixaDe(valor) {
  return FAIXAS.find((f) => valor < f.max) ?? FAIXAS[FAIXAS.length - 1]
}

export default function PremierBadge({ valor, size = 'md' }) {
  if (valor == null) return null
  const f = faixaDe(valor)
  const grande = size !== 'sm'
  return (
    <span
      title="Premier (CS Rating)"
      className={`panel-cut-sm inline-flex items-center gap-1 border font-mono font-bold tabular-nums ${f.bg} ${f.border} ${f.cor} ${
        grande ? 'px-2 py-1 text-sm' : 'px-1.5 py-0.5 text-xs'
      }`}
    >
      {Math.round(valor)}
    </span>
  )
}
