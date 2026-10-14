// Estados de tela padronizados: carregando (skeleton), vazio e erro. Antes cada
// página escrevia um <p> cru ("Carregando…", "Nenhuma partida ainda.") com classes
// diferentes.

export function Skeleton({ className = 'h-4 w-full' }) {
  return <div aria-hidden="true" className={`animate-skeleton ${className}`} />
}

// Bloco de linhas de skeleton com o formato de uma lista de cards/linhas.
export function SkeletonLista({ linhas = 4, altura = 'h-16', rotulo = 'Carregando' }) {
  return (
    <div role="status" aria-label={rotulo} className="space-y-2">
      {Array.from({ length: linhas }, (_, i) => (
        <Skeleton key={i} className={`panel-cut-sm ${altura} w-full`} />
      ))}
      <span className="sr-only">{rotulo}…</span>
    </div>
  )
}

function IconeMira({ className = 'h-8 w-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function EstadoVazio({ titulo, descricao = null, acao = null, icone = null, className = '' }) {
  return (
    <div className={`panel-cut relative flex flex-col items-center justify-center gap-3 overflow-hidden border border-dashed border-borda-forte bg-superficie/40 px-6 py-12 text-center ${className}`}>
      <span className="panel-cut-sm flex h-14 w-14 items-center justify-center border border-borda bg-superficie-alta text-texto-fraco">
        {icone ?? <IconeMira />}
      </span>
      <div className="max-w-md">
        <p className="font-display text-lg font-semibold uppercase tracking-wide text-texto">{titulo}</p>
        {descricao && <p className="mt-1 text-sm leading-relaxed text-texto-fraco">{descricao}</p>}
      </div>
      {acao}
    </div>
  )
}

export function EstadoErro({ mensagem, acao = null, className = '' }) {
  return (
    <div role="alert" className={`panel-cut-sm flex items-start gap-3 border border-perigo/40 bg-perigo/5 px-4 py-3 ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-0.5 h-4 w-4 shrink-0 text-perigo" aria-hidden="true">
        <path d="M12 8v5M12 16.5v.5" />
        <path d="M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      </svg>
      <div className="min-w-0 flex-1 text-sm text-texto">{mensagem}</div>
      {acao}
    </div>
  )
}
