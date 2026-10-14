// Margens abaixo do header hoje viviam espalhadas como overrides de className em cada
// página (mb-0/mb-1/mb-2/mb-4 escritos à mão) — os valores realmente usados no app viram
// variantes nomeadas aqui, então nenhuma página precisa mais reinventar a margem via
// className externo (ver finding U8 do review de consistência entre páginas).
const MARGENS = {
  nenhuma: 'mb-0',
  compacta: 'mb-1',
  pequena: 'mb-2',
  padrao: 'mb-3',
  grande: 'mb-4',
}

// Título de seção padronizado (display uppercase) com slot opcional de ação à direita e
// subtítulo opcional embaixo (mesmo componente que antes era duplicado como <p> cru em
// cada página — ver ExplorarMapas/Comparar/EnviarDemo antes desse fix).
export default function SectionHeader({ titulo, subtitulo, acao, margem = 'padrao', className = '' }) {
  return (
    <div className={MARGENS[margem] ?? MARGENS.padrao}>
      <div className={`flex items-center justify-between gap-3 ${subtitulo != null ? 'mb-1' : ''} ${className}`.trim()}>
        <h2 className="flex min-w-0 items-center gap-2 truncate font-display text-xl font-bold uppercase tracking-wide text-texto">
          <span className="h-3.5 w-[3px] shrink-0 bg-destaque" aria-hidden="true" />
          <span className="min-w-0 truncate">{titulo}</span>
        </h2>
        {acao != null && <div className="flex-shrink-0">{acao}</div>}
      </div>
      {subtitulo != null && <p className="text-sm text-texto-fraco">{subtitulo}</p>}
    </div>
  )
}
