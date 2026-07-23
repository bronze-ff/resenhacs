import { Children, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Dropdown customizado — NÃO usa <select> nativo. O popup de um <select> é desenhado
// pelo SO (fundo branco/destaque azul no Windows/Chrome) e não aceita estilização;
// destoava do resto do produto ("muito amador", feedback direto de uso). Continua
// aceitando <option value>Label</option> como filhos e chamando onChange com um
// evento { target: { value } } igual ao nativo — API idêntica, nenhum consumidor
// (13 usos no site) precisou mudar uma linha.
export default function Select({ value, onChange, children, className = '', selectClassName = '', disabled = false }) {
  const opcoes = useMemo(
    () =>
      // Só <option> de verdade — Children.toArray não abre um <> passado como filho
      // único (ex.: uma constante de opções extraída pra fora), então filtrar por
      // c?.props != null aceitaria o Fragment inteiro como "uma opção" e renderizaria
      // as <option> cruas dentro do rótulo. Exigir type === 'option' torna esse caso
      // um no-op silencioso em vez de corromper o rótulo/valor.
      Children.toArray(children)
        .filter((c) => c?.type === 'option')
        .map((c) => ({ value: String(c.props.value ?? ''), label: c.props.children })),
    [children],
  )
  const [aberto, setAberto] = useState(false)
  const [ativo, setAtivo] = useState(0)
  const [posicao, setPosicao] = useState(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)

  const valorAtual = String(value ?? '')
  const selecionada = opcoes.find((o) => o.value === valorAtual) ?? null

  function abrir() {
    if (disabled || opcoes.length === 0) return
    const idx = Math.max(0, opcoes.findIndex((o) => o.value === valorAtual))
    setAtivo(idx)
    setAberto(true)
  }
  function fechar() {
    setAberto(false)
    triggerRef.current?.focus()
  }
  function escolher(opt) {
    onChange?.({ target: { value: opt.value } })
    fechar()
  }

  // Painel vai por portal pro <body> com position:fixed calculado à mão — vários
  // Selects vivem dentro de containers com clip-path (panel-cut), que cria um
  // containing block novo pra elementos fixed e quebraria o posicionamento (o
  // mesmo bug já visto no modal de detalhe por round).
  useLayoutEffect(() => {
    if (!aberto) return
    function atualizar() {
      const r = triggerRef.current?.getBoundingClientRect()
      if (r) setPosicao({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    atualizar()
    window.addEventListener('scroll', atualizar, true)
    window.addEventListener('resize', atualizar)
    return () => {
      window.removeEventListener('scroll', atualizar, true)
      window.removeEventListener('resize', atualizar)
    }
  }, [aberto])

  // O painel só existe no DOM depois que `posicao` é calculada (um commit depois de
  // `aberto` virar true) — depender só de `aberto` aqui focava cedo demais e achava
  // panelRef.current === null, deixando teclado (Escape/setas) morto após abrir.
  useEffect(() => {
    if (aberto && posicao) panelRef.current?.focus()
  }, [aberto, posicao])

  useEffect(() => {
    if (!aberto) return
    function aoClicarFora(e) {
      if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      setAberto(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    return () => document.removeEventListener('mousedown', aoClicarFora)
  }, [aberto])

  function aoTeclarTrigger(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      abrir()
    }
  }

  function aoTeclarPainel(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      fechar()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAtivo((i) => Math.min(opcoes.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAtivo((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (opcoes[ativo]) escolher(opcoes[ativo])
    } else if (e.key === 'Tab') {
      setAberto(false)
    }
  }

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        onClick={() => (aberto ? fechar() : abrir())}
        onKeyDown={aoTeclarTrigger}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        // focus:outline-none só tira o outline nativo — precisa do substituto em
        // focus-visible (não em `aberto`, que é o estado de dropdown aberto e não
        // reflete navegação por teclado) senão quem navega via Tab perde a referência
        // visual de onde está o foco.
        className={`peer panel-cut-sm flex min-h-10 w-full items-center gap-2 border bg-superficie py-2 pl-3 pr-9 text-left font-mono text-sm text-texto transition-colors hover:border-destaque/60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-destaque)] disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0 ${aberto ? 'border-destaque' : 'border-borda'} ${selectClassName}`}
      >
        <span className="truncate">{selecionada?.label ?? ' '}</span>
      </button>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 transition-transform peer-hover:text-destaque peer-focus:text-destaque ${aberto ? 'rotate-180 text-destaque' : 'text-texto-fraco'}`}
        aria-hidden="true"
      >
        <path d="M6 9L12 15L18 9" />
      </svg>
      {aberto &&
        posicao &&
        createPortal(
          <ul
            ref={panelRef}
            role="listbox"
            tabIndex={-1}
            onKeyDown={aoTeclarPainel}
            style={{ position: 'fixed', top: posicao.top, left: posicao.left, minWidth: posicao.width, maxWidth: 'calc(100vw - 1rem)', zIndex: 60 }}
            // animate-surgir-painel só roda na entrada (o painel some do DOM direto ao
            // fechar, sem saída animada) — @keyframes e o guard de prefers-reduced-motion
            // ficam em index.css junto do resto das animações do projeto.
            className="panel-cut-sm max-h-60 origin-top animate-surgir-painel overflow-y-auto border border-borda bg-superficie py-1 font-mono text-sm shadow-[0_8px_32px_rgba(0,0,0,0.45)] focus:outline-none"
          >
            {opcoes.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === selecionada?.value}
                onMouseEnter={() => setAtivo(i)}
                onClick={() => escolher(o)}
                className={`flex min-h-10 cursor-pointer items-center justify-between gap-3 px-3 py-2 lg:min-h-0 ${i === ativo ? 'bg-superficie-alta' : ''} ${o.value === selecionada?.value ? 'text-destaque' : 'text-texto'}`}
              >
                <span className="min-w-0 truncate">{o.label}</span>
                {o.value === selecionada?.value && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5 shrink-0">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  )
}
