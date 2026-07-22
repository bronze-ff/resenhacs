import Chip from './Chip.jsx'

// Chip pequeno reutilizável (Vitória/Derrota/AUTO/PRO): mono uppercase, tom controla a cor.
// 'destaque' marca categoria/tag (ex. PRO, MELHOR MOMENTO), sem julgar bom/ruim — por
// isso StatTile.jsx (que só julga valor numérico) tem um TONS menor, sem 'destaque'.
const TONS = {
  destaque: 'border-destaque/40 bg-destaque/10 text-destaque',
  sucesso: 'border-sucesso/40 bg-sucesso/10 text-sucesso',
  perigo: 'border-perigo/40 bg-perigo/10 text-perigo',
  neutro: 'border-borda bg-superficie text-texto-fraco',
}

export default function Badge({ tom = 'neutro', className = '', children, ...props }) {
  const cor = TONS[tom] ?? TONS.neutro
  return (
    <Chip toneClassName={cor} className={`text-[10px] uppercase tracking-wide ${className}`.trim()} {...props}>
      {children}
    </Chip>
  )
}
