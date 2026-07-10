export default function StatTile({ rotulo, valor, sub, destaque }) {
  return (
    <div className="rounded-xl border border-borda bg-superficie p-4">
      <div className="text-xs uppercase tracking-wide text-texto-fraco">{rotulo}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${destaque ?? 'text-texto'}`}>{valor}</div>
      {sub && <div className="mt-0.5 text-xs text-texto-fraco">{sub}</div>}
    </div>
  )
}
