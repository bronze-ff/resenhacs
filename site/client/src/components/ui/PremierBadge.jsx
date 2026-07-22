import Chip from './Chip.jsx'
import { AZUL, ROXO, ROSA, AMARELO } from '../../lib/colors.js'

// Badge de Premier (CS Rating) — mesmas 7 faixas de cor que o próprio CS2 usa (fonte:
// pesquisa web confirmada na spec, docs/superpowers/specs/2026-07-16-premier-rating-design.md).
// Não renderiza nada se o jogador nunca jogou Premier (valor null) — sem "sem dado" cru
// ocupando espaço num lugar que boa parte do grupo pode nunca ter usado.
const FAIXAS = [
  { max: 5000, cor: 'text-texto-fraco', bg: 'bg-superficie-alta', border: 'border-borda' },
  { max: 10000, cor: 'text-time-b', bg: 'bg-time-b/10', border: 'border-time-b/40' },
  { max: 15000, cor: AZUL.texto, bg: AZUL.fundo, border: AZUL.borda },
  { max: 20000, cor: ROXO.texto, bg: ROXO.fundo, border: ROXO.borda },
  { max: 25000, cor: ROSA.texto, bg: ROSA.fundo, border: ROSA.borda },
  { max: 30000, cor: 'text-perigo', bg: 'bg-perigo/10', border: 'border-perigo/40' },
  { max: Infinity, cor: AMARELO.texto, bg: AMARELO.fundo, border: AMARELO.borda },
]
function faixaDe(valor) {
  return FAIXAS.find((f) => valor < f.max) ?? FAIXAS[FAIXAS.length - 1]
}

// `size`: 'compacto' (default, linha/lista) ou 'normal' (destaque, ex. header de
// perfil). Mesmo vocabulário do ResultChip — antes os dois usavam "size" com sentido
// oposto (aqui o default era o grande; lá o default era o compacto), o que confundia
// quem lia os dois lado a lado. Ver ResultChip.jsx.
export default function PremierBadge({ valor, size = 'compacto' }) {
  if (valor == null) return null
  const f = faixaDe(valor)
  const grande = size === 'normal'
  return (
    <Chip
      toneClassName={`${f.bg} ${f.border} ${f.cor}`}
      size={grande ? 'normal' : 'compacto'}
      className={`font-bold tabular-nums ${grande ? 'text-sm' : 'text-xs'}`}
      title="Premier (CS Rating)"
    >
      {Math.round(valor)}
    </Chip>
  )
}
