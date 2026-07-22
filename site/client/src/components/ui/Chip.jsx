// Primitivo de baixo nível pro "chip colorido": painel cortado + borda + padding + mono.
// Badge/PlataformaBadge/FaceitEloBadge/PremierBadge/RatingBadge desenhavam essa casca
// cada um por conta própria — já causou drift real (RatingBadge era o único sem
// `border`). Tipografia específica de cada badge (caixa alta, peso, tabular-nums,
// tamanho da fonte) continua em cada um via `className`; aqui só mora o que é comum
// aos cinco: tom (cor), ícone opcional e o tamanho do padding.
const PADDING = {
  compacto: 'px-1.5 py-0.5',
  normal: 'px-2 py-1',
}

export default function Chip({ toneClassName = '', size = 'compacto', icon = null, className = '', children, ...props }) {
  const padding = PADDING[size] ?? PADDING.compacto
  return (
    <span
      className={`panel-cut-sm inline-flex items-center gap-1 border font-mono ${padding} ${toneClassName} ${className}`.trim()}
      {...props}
    >
      {icon}
      {children}
    </span>
  )
}
