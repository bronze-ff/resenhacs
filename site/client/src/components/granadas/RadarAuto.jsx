import { useState } from 'react'
import { MarcadorTipo } from './RadarGranadas.jsx'

// Radar da biblioteca automática: cada lineup (cluster) é um traço arremesso→alvo
// com o ícone do tipo no alvo. Traços ficam discretos; o ativo (hover/seleção) acende.
export default function RadarAuto({ mapa, clusters, selecionadoId, onSelecionar, rotuloDe }) {
  const [hoverId, setHoverId] = useState(null)
  const ativoId = hoverId ?? selecionadoId
  const ativo = clusters.find((c) => c.id === ativoId)

  return (
    <div className="relative mx-auto w-full max-w-[calc(100vh-9rem)]">
      <svg viewBox="0 0 100 100" className="panel-cut block w-full border border-borda bg-fundo" role="img" aria-label="Radar de lineups automáticas">
        <image href={`/radars/${mapa}.png`} width="100" height="100" opacity="0.9" />

        {clusters.map((c) => (
          <line
            key={`l-${c.id}`}
            x1={c.arremessoX * 100} y1={c.arremessoY * 100}
            x2={c.alvoX * 100} y2={c.alvoY * 100}
            stroke="#d2d2d7" strokeWidth="0.25" opacity={ativoId ? 0.12 : 0.3}
            className="pointer-events-none"
          />
        ))}

        {ativo && (
          <g className="pointer-events-none">
            <line
              x1={ativo.arremessoX * 100} y1={ativo.arremessoY * 100}
              x2={ativo.alvoX * 100} y2={ativo.alvoY * 100}
              stroke="#ffd166" strokeWidth="0.5" strokeDasharray="1.5 1.5"
            />
            <circle cx={ativo.arremessoX * 100} cy={ativo.arremessoY * 100} r="1.4" fill="#ffd166" />
          </g>
        )}

        {clusters.map((c) => (
          <g
            key={c.id}
            role="button"
            tabIndex={0}
            aria-label={rotuloDe ? rotuloDe(c) : c.tipo}
            onMouseEnter={() => setHoverId(c.id)}
            onMouseLeave={() => setHoverId(null)}
            onFocus={() => setHoverId(c.id)}
            onBlur={() => setHoverId(null)}
            onClick={() => onSelecionar(c)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelecionar(c) } }}
            className="cursor-pointer outline-none"
          >
            <circle cx={c.alvoX * 100} cy={c.alvoY * 100} r="3" fill="transparent" />
            <MarcadorTipo tipo={c.tipo} x={c.alvoX * 100} y={c.alvoY * 100} ativo={c.id === ativoId} />
          </g>
        ))}
      </svg>

      {ativo && hoverId && (
        <div
          className="panel-cut-sm pointer-events-none absolute z-10 border border-borda bg-superficie px-2.5 py-1.5 shadow-flutuante"
          style={{ left: `${Math.min(ativo.alvoX * 100, 62)}%`, top: `${Math.min(ativo.alvoY * 100 + 4, 84)}%` }}
        >
          <p className="text-xs font-medium text-texto">{rotuloDe ? rotuloDe(ativo) : ativo.tipo}</p>
          <p className="font-mono text-[11px] tabular-nums text-texto-fraco">
            {ativo.total} {ativo.total === 1 ? 'uso' : 'usos'}{ativo.lado ? ` · ${ativo.lado}` : ''}
          </p>
        </div>
      )}
    </div>
  )
}
