import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

// Casca única de modal. Os 8 modais do site repetiam backdrop + painel + cabeçalho
// sticky + botão "fechar" com pequenas diferenças. A transição continua com quem
// chama (useTransicaoModal): o modal recebe `visivel` e um `onFechar` que já anima
// a saída. Vai por portal pro <body> — modal dentro de container com clip-path
// (panel-cut) perdia o position:fixed.
//
// Mobile: folha que sobe da base (até 92vh). Desktop: painel centralizado com corte.
const LARGURAS = {
  sm: 'lg:max-w-md',
  md: 'lg:max-w-2xl',
  lg: 'lg:max-w-4xl',
  xl: 'lg:max-w-6xl',
}

export function IconeFechar({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export default function Modal({
  visivel,
  onFechar,
  titulo,
  subtitulo = null,
  acoesCabecalho = null,
  rodape = null,
  tamanho = 'md',
  camada = 'z-50',
  className = '',
  corpoClassName = '',
  rotuloFechar = 'Fechar',
  children,
}) {
  const tituloId = useId()
  const painelRef = useRef(null)
  const onFecharRef = useRef(onFechar)
  onFecharRef.current = onFechar

  useEffect(() => {
    function aoTeclar(e) {
      if (e.key === 'Escape') onFecharRef.current?.()
    }
    document.addEventListener('keydown', aoTeclar)
    const overflowAntes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focoAntes = document.activeElement
    painelRef.current?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.body.style.overflow = overflowAntes
      if (focoAntes && typeof focoAntes.focus === 'function') focoAntes.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div
      className={`fixed inset-0 ${camada} flex items-end justify-center bg-fundo/75 backdrop-blur-sm transition-opacity duration-200 lg:items-center lg:p-6 ${visivel ? 'opacity-100' : 'opacity-0'}`}
      onClick={onFechar}
    >
      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titulo ? tituloId : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`relative flex max-h-[92vh] w-full flex-col border-t border-borda-forte bg-superficie shadow-flutuante outline-none transition-[opacity,transform] duration-200 ease-[var(--ease-saida)] lg:panel-cut lg:max-h-[88vh] lg:border ${LARGURAS[tamanho] ?? LARGURAS.md} ${visivel ? 'translate-y-0 opacity-100 lg:scale-100' : 'translate-y-6 opacity-0 lg:translate-y-0 lg:scale-[0.97]'} ${className}`}
      >
        <div className="absolute left-0 top-0 h-[2px] w-16 bg-destaque" aria-hidden="true" />
        <div className="mx-auto mt-2 h-1 w-10 bg-borda-forte lg:hidden" aria-hidden="true" />
        {(titulo || acoesCabecalho) && (
          <header className="flex items-start justify-between gap-3 border-b border-borda px-4 py-3 lg:px-6 lg:py-4">
            <div className="min-w-0">
              {titulo && (
                <h3 id={tituloId} className="font-display text-xl font-bold uppercase leading-tight tracking-wide text-texto lg:text-2xl">
                  {titulo}
                </h3>
              )}
              {subtitulo && <div className="mt-0.5 font-mono text-xs text-texto-fraco">{subtitulo}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {acoesCabecalho}
              <button
                type="button"
                onClick={onFechar}
                aria-label={rotuloFechar}
                title={rotuloFechar}
                className="panel-cut-tr flex h-10 w-10 items-center justify-center text-texto-fraco transition-colors duration-200 hover:bg-superficie-alta hover:text-texto"
              >
                <IconeFechar />
              </button>
            </div>
          </header>
        )}
        <div className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6 lg:py-5 ${corpoClassName}`}>{children}</div>
        {rodape && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-borda bg-superficie-alta/40 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:px-6">
            {rodape}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
