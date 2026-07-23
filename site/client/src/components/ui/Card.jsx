// Painel padrão do site (cantos cortados + hairline border); `interativo` liga hover/cursor.
// `corte=false` remove o clip-path dos cantos — usado por modais de tela cheia no mobile,
// que não podem ter canto cortado (expõe o backdrop atrás); eles restauram o corte só no
// desktop via `lg:panel-cut` na className.
export default function Card({ as: Comp = 'div', interativo = false, corte = true, className = '', children, ...props }) {
  const base = `${corte ? 'panel-cut ' : ''}border border-borda bg-superficie`
  const hover = interativo ? ' transition-colors duration-200 hover:border-destaque/60 cursor-pointer' : ''
  return (
    <Comp className={`${base}${hover} ${className}`.trim()} {...props}>
      {children}
    </Comp>
  )
}
