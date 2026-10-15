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
    ? `inline-flex gap-0.5 rounded-[var(--radius-medio)] border border-borda bg-superficie p-0.5 ${larguraTotal ? 'w-full' : ''}`
    : `flex gap-5 overflow-x-auto border-b border-borda ${larguraTotal ? 'w-full' : ''}`

  return (
    <div role="tablist" aria-label={rotulo} className={`${trilho} ${className}`.trim()}>
      {itens.map((item, i) => {
        const ativo = item.valor === valor
        const base = segmentado
          ? `h-9 rounded-[var(--radius-pequeno)] px-3 text-[13px] font-medium transition-colors duration-150 lg:h-7 ${larguraTotal ? 'flex-1' : ''} ${
              ativo ? 'bg-superficie-topo text-texto shadow-[inset_0_0_0_1px_var(--color-borda-forte)]' : 'text-texto-fraco hover:text-texto'
            }`
          : `relative h-11 shrink-0 px-0.5 text-sm font-medium transition-colors duration-150 ${
              ativo
                ? 'text-texto after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:rounded-full after:bg-destaque'
                : 'text-texto-fraco hover:text-texto'
            }`
        return (
          <button
            key={item.valor}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="tab"
            aria-selected={ativo}
            title={item.title}
            tabIndex={ativo ? 0 : -1}
            onClick={() => onChange?.(item.valor)}
            onKeyDown={(e) => aoTeclar(e, i)}
            className={`inline-flex cursor-pointer items-center justify-center gap-1.5 ${base}`}
          >
            {item.rotulo}
            {item.contagem != null && (
              <span className={`rounded-full bg-superficie-alta px-1.5 font-mono text-[11px] tabular-nums ${ativo ? 'text-texto' : 'text-texto-fraco'}`}>{item.contagem}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
