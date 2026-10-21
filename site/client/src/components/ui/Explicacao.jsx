import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Rótulo de métrica que explica o próprio número. O sublinhado pontilhado já era a
// convenção de "tem explicação" no site, mas a explicação vivia num `title` (só no
// hover, invisível no celular). Aqui o rótulo é um botão: clique ou toque abre um painel
// com o que é, a unidade e como ler. `metrica`: { nome, texto, unidade?, sentido? }
// (sentido: 'mais' = quanto maior melhor, 'menos' = quanto menor melhor).
const LEITURA = { mais: 'Quanto maior, melhor.', menos: 'Quanto menor, melhor.' }
const LARGURA = 288 // px do painel

export default function Explicacao({ metrica, children, className = '' }) {
  const [aberto, setAberto] = useState(false)
  const [posicao, setPosicao] = useState(null)
  const botaoRef = useRef(null)
  const painelRef = useRef(null)
  const id = useId()

  // Portal + position:fixed pelo mesmo motivo do Select: painéis com clip-path e
  // tabelas com overflow cortariam um popover absoluto.
  useLayoutEffect(() => {
    if (!aberto) return undefined
    function atualizar() {
      const r = botaoRef.current?.getBoundingClientRect()
      if (!r) return
      const left = Math.min(Math.max(8, r.left + r.width / 2 - LARGURA / 2), window.innerWidth - LARGURA - 8)
      const abaixo = r.bottom + 6
      setPosicao({ left, top: abaixo })
    }
    atualizar()
    window.addEventListener('scroll', atualizar, true)
    window.addEventListener('resize', atualizar)
    return () => {
      window.removeEventListener('scroll', atualizar, true)
      window.removeEventListener('resize', atualizar)
    }
  }, [aberto])

  useEffect(() => {
    if (!aberto) return undefined
    function fora(e) {
      if (botaoRef.current?.contains(e.target) || painelRef.current?.contains(e.target)) return
      setAberto(false)
    }
    function tecla(e) {
      if (e.key === 'Escape') { setAberto(false); botaoRef.current?.focus() }
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', tecla)
    }
  }, [aberto])

  if (!metrica) return children

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setAberto((v) => !v) }}
        aria-expanded={aberto}
        aria-controls={aberto ? id : undefined}
        className={`cursor-help underline decoration-dotted decoration-texto-fraco/50 underline-offset-4 transition-colors hover:text-texto hover:decoration-texto-fraco ${className}`}
      >
        {children}
      </button>
      {aberto && posicao && createPortal(
        <div
          ref={painelRef}
          id={id}
          role="dialog"
          aria-label={metrica.nome}
          style={{ position: 'fixed', top: posicao.top, left: posicao.left, width: LARGURA, zIndex: 60 }}
          className="origin-top animate-surgir-painel rounded-[var(--radius-medio)] border border-borda-forte bg-superficie-alta p-3 text-left text-sm font-normal normal-case tracking-normal text-texto shadow-flutuante"
        >
          <p className="font-semibold">{metrica.nome}</p>
          <p className="mt-1 leading-relaxed text-texto-fraco">{metrica.texto}</p>
          {(metrica.unidade || LEITURA[metrica.sentido]) && (
            <dl className="mt-2.5 space-y-1 border-t border-borda pt-2.5 text-xs">
              {metrica.unidade && (
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-texto-fraco">Unidade</dt><dd>{metrica.unidade}</dd></div>
              )}
              {LEITURA[metrica.sentido] && (
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-texto-fraco">Leitura</dt><dd>{LEITURA[metrica.sentido]}</dd></div>
              )}
            </dl>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
