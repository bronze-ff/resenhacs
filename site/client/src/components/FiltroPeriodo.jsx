// Par de inputs de data (de → até) usado nos filtros de período do sistema.
// No mobile os dois inputs dividem a largura disponível (flex-1) em vez de quebrar
// linha em posições aleatórias (rótulo numa linha, seta sumida, data órfã na outra —
// visual quebrado real visto no Feed em 2026-07-24); no desktop segue inline compacto.
export default function FiltroPeriodo({ de, ate, onDe, onAte }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2 font-mono text-xs lg:w-auto">
      <span className="uppercase tracking-wide text-texto-fraco">Período</span>
      <div className="flex min-w-0 flex-1 items-center gap-2 lg:flex-none">
        <input
          type="date"
          value={de}
          onChange={(e) => onDe(e.target.value)}
          aria-label="Data inicial do período"
          className="panel-cut-sm min-h-10 w-full min-w-0 flex-1 border border-borda bg-superficie px-3 py-2 text-sm text-texto [color-scheme:dark] lg:min-h-0 lg:w-auto lg:flex-none lg:px-2 lg:py-1 lg:text-xs"
        />
        <span className="shrink-0 text-texto-fraco">→</span>
        <input
          type="date"
          value={ate}
          onChange={(e) => onAte(e.target.value)}
          aria-label="Data final do período"
          className="panel-cut-sm min-h-10 w-full min-w-0 flex-1 border border-borda bg-superficie px-3 py-2 text-sm text-texto [color-scheme:dark] lg:min-h-0 lg:w-auto lg:flex-none lg:px-2 lg:py-1 lg:text-xs"
        />
      </div>
      {(de || ate) && (
        <button
          onClick={() => {
            onDe('')
            onAte('')
          }}
          className="inline-flex min-h-10 shrink-0 items-center px-1 uppercase tracking-wide text-texto-fraco transition-colors hover:text-perigo lg:min-h-0 lg:px-0"
        >
          limpar
        </button>
      )}
    </div>
  )
}
