export default function StatTile({ rotulo, valor, sub, destaque, title }) {
  return (
    <div title={title} className="panel-cut-sm relative border border-borda bg-superficie p-4 transition-colors hover:border-destaque/40">
      <div className="absolute left-0 top-0 h-[2px] w-6 bg-destaque/60" />
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-texto-fraco">{rotulo}</div>
      <div className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${destaque ?? 'text-texto'}`}>
        {valor}
      </div>
      {sub && <div className="mt-0.5 font-mono text-xs text-texto-fraco">{sub}</div>}
    </div>
  )
}
