// Tile de estatística no padrão FACEIT/perfil: rótulo mono em cima, valor grande, sub opcional.
import Card from './Card.jsx'

const TONS = {
  sucesso: 'text-sucesso',
  perigo: 'text-perigo',
  neutro: 'text-texto',
}

export default function StatTile({ rotulo, valor, sub, tom = 'neutro', className = '', ...props }) {
  const corValor = TONS[tom] ?? TONS.neutro
  return (
    <Card className={`relative p-4 ${className}`.trim()} {...props}>
      <div className="absolute left-0 top-0 h-[2px] w-6 bg-destaque/60" />
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-texto-fraco">{rotulo}</div>
      <div className={`mt-1.5 font-display text-2xl font-semibold tabular-nums display-tight ${corValor}`}>{valor}</div>
      {sub != null && <div className="mt-0.5 font-mono text-xs text-texto-fraco">{sub}</div>}
    </Card>
  )
}
