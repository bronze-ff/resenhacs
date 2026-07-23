import Chip from './Chip.jsx'

// Badge de rating estilo FACEIT: verde quando >= 1.0, vermelho quando < 1.0 (2 casas).
// Usa o Chip compartilhado (ver Chip.jsx) — antes desenhava a casca na mão e acabou
// sendo o único badge da família sem `border` (drift real, corrigido aqui).
export default function RatingBadge({ valor, className = '', ...props }) {
  if (valor == null || Number.isNaN(Number(valor))) {
    return (
      <Chip toneClassName="border-borda text-texto-fraco" className={`text-xs font-bold tabular-nums ${className}`.trim()} {...props}>
        –
      </Chip>
    )
  }
  const n = Number(valor)
  const cor = n >= 1 ? 'border-sucesso/40 bg-sucesso/15 text-sucesso' : 'border-perigo/40 bg-perigo/15 text-perigo'
  return (
    <Chip toneClassName={cor} className={`text-xs font-bold tabular-nums ${className}`.trim()} {...props}>
      {n.toFixed(2)}
    </Chip>
  )
}
