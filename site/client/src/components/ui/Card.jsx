// Painel padrão do site (cantos cortados + hairline border); `interativo` liga hover/cursor.
export default function Card({ as: Comp = 'div', interativo = false, className = '', children, ...props }) {
  const base = 'panel-cut border border-borda bg-superficie'
  const hover = interativo ? ' transition-colors duration-200 hover:border-destaque/60 cursor-pointer' : ''
  return (
    <Comp className={`${base}${hover} ${className}`.trim()} {...props}>
      {children}
    </Comp>
  )
}
