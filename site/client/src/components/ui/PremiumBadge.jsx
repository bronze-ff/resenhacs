import Chip from './Chip.jsx'

// Badge do Jogador Premium: quem apoia o site, marcado pelo admin (migration 0061).
// `compacta` mostra só a estrela, pro topo do site, onde o nick já é apertado.
function Estrela() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3 fill-current">
      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />
    </svg>
  )
}

export default function PremiumBadge({ compacta = false, className = '' }) {
  return (
    <Chip
      toneClassName="border-aviso/40 bg-aviso/10 text-aviso"
      icon={<Estrela />}
      className={`text-[11px] font-medium uppercase ${className}`.trim()}
      title="Jogador Premium: apoia o site"
    >
      {compacta ? <span className="sr-only">Premium</span> : 'Premium'}
    </Chip>
  )
}
