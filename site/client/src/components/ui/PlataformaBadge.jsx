import { SteamIcon, FaceitIcon } from './icones.jsx'

// Badge de plataforma com logo: PREMIER (matchmaking da Valve, logo Steam) vs FACEIT
// (logo próprio). null pra upload/pro, que já têm suas próprias tags (MANUAL/AUTO e
// PRO) e não precisam de uma terceira. Mesmas cores do Badge (neutro/destaque), mas
// inline-flex pra alinhar o logo com o texto.
const CFG = {
  valve_mm: { Icone: SteamIcon, label: 'PREMIER', cor: 'border-borda bg-superficie text-texto-fraco' },
  faceit: { Icone: FaceitIcon, label: 'FACEIT', cor: 'border-destaque/40 bg-destaque/10 text-destaque' },
}

export default function PlataformaBadge({ source, className = '' }) {
  const cfg = CFG[source]
  if (!cfg) return null
  const { Icone, label, cor } = cfg
  return (
    <span
      className={`panel-cut-sm inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${cor} ${className}`.trim()}
    >
      <Icone className="h-3 w-3 shrink-0" />
      {label}
    </span>
  )
}
