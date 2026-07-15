// Par de inputs de data (de → até) usado nos filtros de período do sistema.
export default function FiltroPeriodo({ de, ate, onDe, onAte }) {
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
      <span className="uppercase tracking-wide text-texto-fraco">Período</span>
      <input
        type="date"
        value={de}
        onChange={(e) => onDe(e.target.value)}
        className="panel-cut-sm min-h-10 border border-borda bg-superficie px-3 py-2 text-sm text-texto [color-scheme:dark] lg:min-h-0 lg:px-2 lg:py-1 lg:text-xs"
      />
      <span className="text-texto-fraco">→</span>
      <input
        type="date"
        value={ate}
        onChange={(e) => onAte(e.target.value)}
        className="panel-cut-sm min-h-10 border border-borda bg-superficie px-3 py-2 text-sm text-texto [color-scheme:dark] lg:min-h-0 lg:px-2 lg:py-1 lg:text-xs"
      />
      {(de || ate) && (
        <button
          onClick={() => {
            onDe('')
            onAte('')
          }}
          className="inline-flex min-h-10 items-center px-1 uppercase tracking-wide text-texto-fraco transition-colors hover:text-perigo lg:min-h-0 lg:px-0"
        >
          limpar
        </button>
      )}
    </div>
  )
}
