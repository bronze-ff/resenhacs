// Filtro de escolha única com muitas opções (tipos de granada, tipo de tática,
// armas). Mesmo trilho afundado e mesmo estado ativo das Abas segmentadas, mas
// quebra em linha no mobile e vira coluna no desktop (sidebar estreita de 14rem,
// onde 5-7 opções não cabem lado a lado). Para 2-4 opções curtas use `Abas`.
// `itens`: [{ valor, rotulo, contagem?, desabilitado? }].
export default function ListaFiltro({ itens, valor, onChange, rotulo }) {
  return (
    <div
      role="group"
      aria-label={rotulo}
      className="panel-cut-tr flex flex-wrap gap-0.5 border border-borda bg-fundo/60 p-0.5 lg:flex-col lg:flex-nowrap"
    >
      {itens.map((item) => {
        const ativo = item.valor === valor
        return (
          <button
            key={item.valor}
            type="button"
            aria-pressed={ativo}
            disabled={item.desabilitado}
            onClick={() => onChange(item.valor)}
            className={`flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-pequeno)] px-3 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-8 lg:w-full ${
              ativo
                ? 'bg-superficie-topo text-texto shadow-[inset_0_-2px_0_0_var(--color-destaque)]'
                : 'text-texto-fraco hover:text-texto'
            }`}
          >
            <span>{item.rotulo}</span>
            {item.contagem != null && (
              <span className={`text-[11px] tabular-nums ${ativo ? 'text-destaque' : 'text-texto-fraco/70'}`}>{item.contagem}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
