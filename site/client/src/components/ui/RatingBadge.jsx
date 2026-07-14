// Badge de rating estilo FACEIT: verde quando >= 1.0, vermelho quando < 1.0 (2 casas).
export default function RatingBadge({ valor, className = '', ...props }) {
  if (valor == null || Number.isNaN(Number(valor))) {
    return (
      <span className={`panel-cut-sm inline-block px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-texto-fraco ${className}`.trim()} {...props}>
        –
      </span>
    )
  }
  const n = Number(valor)
  const cor = n >= 1 ? 'bg-sucesso/15 text-sucesso' : 'bg-perigo/15 text-perigo'
  return (
    <span
      className={`panel-cut-sm inline-block px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums ${cor} ${className}`.trim()}
      {...props}
    >
      {n.toFixed(2)}
    </span>
  )
}
