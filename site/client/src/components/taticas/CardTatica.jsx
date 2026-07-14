import MiniRadarTatica from './MiniRadarTatica.jsx'

export const ROTULO_TIPO_TATICA = {
  execute: 'Execute', fake: 'Fake', explode: 'Explode', rush: 'Rush', split: 'Split', setup: 'Setup',
}
export const ROTULO_ARMAS = { full: 'Full', eco: 'Eco', force: 'Force', pistol: 'Pistol' }

// Card de tática curada: mini-radar com os marcadores de todas as granadas
// linkadas + badges (local, tipo, nº de papéis) + título embaixo — estilo csnades
// (ver docs/superpowers/specs/2026-07-13-taticas-csnades-referencia.md).
export default function CardTatica({ tatica, onSelecionar }) {
  const granadas = (tatica.papeis ?? []).flatMap((p) => p.granadas ?? [])
  const nPapeis = (tatica.papeis ?? []).length

  return (
    <button
      onClick={() => onSelecionar(tatica)}
      className="panel-cut group flex flex-col overflow-hidden border border-borda bg-superficie text-left transition-colors hover:border-destaque"
    >
      <div className="relative">
        <MiniRadarTatica mapa={tatica.map} granadas={granadas} />
        <div className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
          <span className="panel-cut-sm border border-borda bg-fundo/80 px-1.5 py-0.5 font-mono text-[10px] uppercase text-texto-fraco">
            {tatica.local}
          </span>
          <span className="panel-cut-sm border border-destaque/40 bg-fundo/80 px-1.5 py-0.5 font-mono text-[10px] uppercase text-destaque">
            {ROTULO_TIPO_TATICA[tatica.tipo] ?? tatica.tipo}
          </span>
        </div>
        <span className="absolute right-1.5 top-1.5 panel-cut-sm border border-borda bg-fundo/80 px-1.5 py-0.5 font-mono text-[10px] uppercase text-texto-fraco">
          {nPapeis} {nPapeis === 1 ? 'papel' : 'papéis'}
        </span>
      </div>
      <div className="min-w-0 flex-1 p-2">
        <p className="truncate font-display text-sm font-semibold uppercase text-texto">{tatica.titulo}</p>
        <p className="font-mono text-[10px] uppercase text-texto-fraco">
          {tatica.lado} · {ROTULO_ARMAS[tatica.armas] ?? tatica.armas}
        </p>
      </div>
    </button>
  )
}
