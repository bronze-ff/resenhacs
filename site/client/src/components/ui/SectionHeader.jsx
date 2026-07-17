// Título de seção padronizado (display uppercase) com slot opcional de ação à direita.
export default function SectionHeader({ titulo, acao, className = '' }) {
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 ${className}`.trim()}>
      <h2 className="min-w-0 truncate font-display text-lg font-semibold uppercase tracking-wide text-texto">{titulo}</h2>
      {acao != null && <div className="flex-shrink-0">{acao}</div>}
    </div>
  )
}
