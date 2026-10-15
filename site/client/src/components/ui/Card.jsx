// Painel padrão do site (cantos cortados + hairline border + realce de 1px no topo);
// `interativo` liga hover/cursor. `corte=false` remove o clip-path dos cantos — usado
// por containers que não podem ter canto cortado (ex.: algo que precisa de
// overflow visível); eles restauram o corte só no desktop via `lg:panel-cut`.
export default function Card({ as: Comp = 'div', interativo = false, corte = true, className = '', children, ...props }) {
  const base = `${corte ? 'panel-cut ' : ''}realce-topo border border-borda bg-superficie`
  const hover = interativo
    ? ' cursor-pointer transition-[border-color,background-color] duration-200 hover:border-borda-forte hover:bg-superficie-alta/60'
    : ''
  return (
    <Comp className={`${base}${hover} ${className}`.trim()} {...props}>
      {children}
    </Comp>
  )
}
