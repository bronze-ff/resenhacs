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

const pilhaModais = []
let overflowOriginal = ''

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
    // Pilha de modais abertos: com um modal sobre outro (DetalheGranada sobre
    // DetalheTatica), Escape fecha só o de cima.
    // A trava de scroll também é da pilha: o primeiro modal guarda o overflow
    // original e só o último a fechar devolve. Se cada um restaurasse o que viu,
    // fechar os dois juntos (ex.: navegação) podia deixar o body preso em hidden.
    const marca = {}
    if (pilhaModais.length === 0) overflowOriginal = document.body.style.overflow
    pilhaModais.push(marca)
    function aoTeclar(e) {
      if (e.key === 'Escape' && pilhaModais[pilhaModais.length - 1] === marca) onFecharRef.current?.()
    }
    document.addEventListener('keydown', aoTeclar)
    document.body.style.overflow = 'hidden'
    const focoAntes = document.activeElement
    painelRef.current?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      const i = pilhaModais.indexOf(marca)
      if (i !== -1) pilhaModais.splice(i, 1)
      if (pilhaModais.length === 0) document.body.style.overflow = overflowOriginal
      if (focoAntes && typeof focoAntes.focus === 'function') focoAntes.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div
      className={`fixed inset-0 ${camada} flex items-end justify-center bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 lg:items-center lg:p-6 ${visivel ? 'opacity-100' : 'opacity-0'}`}
      onClick={onFechar}
    >
      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titulo ? tituloId : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[var(--radius-grande)] border border-borda-forte bg-superficie shadow-flutuante outline-none transition-[opacity,transform] duration-200 ease-[var(--ease-saida)] lg:max-h-[88vh] lg:rounded-[var(--radius-grande)] ${LARGURAS[tamanho] ?? LARGURAS.md} ${visivel ? 'translate-y-0 opacity-100 lg:scale-100' : 'translate-y-6 opacity-0 lg:translate-y-0 lg:scale-[0.97]'} ${className}`}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-borda-forte lg:hidden" aria-hidden="true" />
        {(titulo || acoesCabecalho) && (
          <header className="flex items-start justify-between gap-3 border-b border-borda px-4 py-3 lg:px-5 lg:py-4">
            <div className="min-w-0">
              {titulo && (
                <h3 id={tituloId} className="font-display text-lg font-semibold leading-tight text-texto">
                  {titulo}
                </h3>
              )}
              {subtitulo && <div className="mt-0.5 text-[13px] text-texto-fraco">{subtitulo}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {acoesCabecalho}
              <button
                type="button"
                onClick={onFechar}
                aria-label={rotuloFechar}
                title={rotuloFechar}
                className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-pequeno)] text-texto-fraco transition-colors duration-150 hover:bg-superficie-alta hover:text-texto"
              >
                <IconeFechar className="h-[18px] w-[18px]" />
              </button>
            </div>
          </header>
        )}
        <div className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-5 lg:py-5 ${corpoClassName}`}>{children}</div>
        {rodape && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-borda bg-superficie-alta/50 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:px-5">
            {rodape}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
