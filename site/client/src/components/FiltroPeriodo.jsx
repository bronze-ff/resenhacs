// Par de inputs de data (de → até) usado nos filtros de período do sistema.
export default function FiltroPeriodo({ de, ate, onDe, onAte }) {
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
      <span className="uppercase tracking-wide text-texto-fraco">Período</span>
      <input
        type="date"
        value={de}
        onChange={(e) => onDe(e.target.value)}
        className="rounded border border-borda bg-superficie px-2 py-2 text-texto [color-scheme:dark] lg:py-1"
      />
      <span className="text-texto-fraco">→</span>
      <input
        type="date"
        value={ate}
        onChange={(e) => onAte(e.target.value)}
        className="rounded border border-borda bg-superficie px-2 py-2 text-texto [color-scheme:dark] lg:py-1"
      />
      {(de || ate) && (
        <button
          onClick={() => {
            onDe('')
            onAte('')
          }}
          className="uppercase tracking-wide text-texto-fraco transition-colors hover:text-perigo"
        >
          limpar
        </button>
      )}
    </div>
  )
}
