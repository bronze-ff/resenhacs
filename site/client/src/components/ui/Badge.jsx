// Chip pequeno reutilizável (Vitória/Derrota/AUTO/PRO): mono uppercase, tom controla a cor.
const TONS = {
  destaque: 'border-destaque/40 bg-destaque/10 text-destaque',
  sucesso: 'border-sucesso/40 bg-sucesso/10 text-sucesso',
  perigo: 'border-perigo/40 bg-perigo/10 text-perigo',
  neutro: 'border-borda bg-superficie text-texto-fraco',
}

export default function Badge({ tom = 'neutro', className = '', children, ...props }) {
  const cor = TONS[tom] ?? TONS.neutro
  return (
    <span
      className={`panel-cut-sm inline-block border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${cor} ${className}`.trim()}
      {...props}
    >
      {children}
    </span>
  )
}
