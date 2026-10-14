import { useRef } from 'react'

// Abas do site em duas formas:
// - 'segmentado' (default): grupo de botões num trilho afundado, pra filtros curtos
//   (Vídeo/Passos, lado T/CT, período).
// - 'sublinhado': navegação de seção de página (Placar/Economia/Replay), barra de 2px
//   no destaque embaixo do item ativo.
// `itens`: [{ valor, rotulo, contagem? }]. Setas ←/→ trocam de aba (padrão WAI-ARIA).
export default function Abas({ itens, valor, onChange, variante = 'segmentado', larguraTotal = false, className = '', rotulo }) {
  const refs = useRef([])

  function aoTeclar(e, indice) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const passo = e.key === 'ArrowRight' ? 1 : -1
    const proximo = (indice + passo + itens.length) % itens.length
    onChange?.(itens[proximo].valor)
    refs.current[proximo]?.focus()
  }

  const segmentado = variante === 'segmentado'
  const trilho = segmentado
    ? `panel-cut-tr inline-flex gap-0.5 border border-borda bg-fundo/60 p-0.5 ${larguraTotal ? 'w-full' : ''}`
    : `flex gap-1 overflow-x-auto border-b border-borda ${larguraTotal ? 'w-full' : ''}`

  return (
    <div role="tablist" aria-label={rotulo} className={`${trilho} ${className}`.trim()}>
      {itens.map((item, i) => {
        const ativo = item.valor === valor
        const base = segmentado
          ? `min-h-10 px-3 font-mono text-xs uppercase tracking-wide transition-colors duration-200 lg:min-h-8 ${larguraTotal ? 'flex-1' : ''} ${
              ativo ? 'bg-superficie-topo text-texto shadow-[inset_0_-2px_0_0_var(--color-destaque)]' : 'text-texto-fraco hover:text-texto'
            }`
          : `relative min-h-11 shrink-0 px-3 font-display text-sm font-semibold uppercase tracking-[0.08em] transition-colors duration-200 ${
              ativo
                ? 'text-texto after:absolute after:inset-x-2 after:-bottom-px after:h-[2px] after:bg-destaque'
                : 'text-texto-fraco hover:text-texto'
            }`
        return (
          <button
            key={item.valor}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="tab"
            aria-selected={ativo}
            tabIndex={ativo ? 0 : -1}
            onClick={() => onChange?.(item.valor)}
            onKeyDown={(e) => aoTeclar(e, i)}
            className={`inline-flex cursor-pointer items-center justify-center gap-1.5 ${base}`}
          >
            {item.rotulo}
            {item.contagem != null && (
              <span className={`font-mono text-[10px] tabular-nums ${ativo ? 'text-destaque' : 'text-texto-fraco/70'}`}>{item.contagem}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
