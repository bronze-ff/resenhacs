import { useRef, useState } from 'react'
import { thumbYoutube } from '../../lib/youtube.js'

const ROTULO_TECNICA = {
  normal: null, jumpthrow: 'lançar com salto', walkthrow: 'andando',
  runthrow: 'correndo', run_jumpthrow: 'correr + saltar',
}

// Ícone simples por tipo, desenhado direto em SVG (sem lib de ícones).
function MarcadorTipo({ tipo, x, y, ativo }) {
  const cor = ativo ? '#ffd166' : { smoke: '#d2d2d7', flash: '#fff8d6', he: '#ffaa3c', molotov: '#ff6e1e' }[tipo]
  if (tipo === 'smoke') {
    return <circle cx={x} cy={y} r={ativo ? 2.2 : 1.8} fill={cor} opacity="0.9" />
  }
  if (tipo === 'molotov') {
    return <path d={`M ${x} ${y - 2} L ${x + 1.6} ${y + 1.4} L ${x - 1.6} ${y + 1.4} Z`} fill={cor} opacity="0.9" />
  }
  if (tipo === 'flash') {
    return <rect x={x - 1.4} y={y - 1.4} width="2.8" height="2.8" transform={`rotate(45 ${x} ${y})`} fill={cor} opacity="0.9" />
  }
  return <circle cx={x} cy={y} r={ativo ? 2 : 1.5} fill="none" stroke={cor} strokeWidth="0.7" opacity="0.9" />
}

export default function RadarGranadas({
  mapa, lineups, selecionadaId, onSelecionar,
  callouts = [], nivelCallouts = 'sem',
  modoMarcacao = null, onCliqueMarcacao = null,
  sugestoes = [], sugestaoAtiva = null,
}) {
  const svgRef = useRef(null)
  const [hoverId, setHoverId] = useState(null)

  const ativa = lineups.find((l) => l.id === (hoverId ?? selecionadaId))
  const hovered = lineups.find((l) => l.id === hoverId)

  function coordsDoClique(e) {
    const rect = svgRef.current.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }
  }

  const calloutsVisiveis = nivelCallouts === 'sem' ? []
    : callouts.filter((c) => nivelCallouts === 'pro' || c.nivel === 'noob')

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        onClick={modoMarcacao && onCliqueMarcacao ? (e) => onCliqueMarcacao(coordsDoClique(e)) : undefined}
        className={`panel-cut block w-full border border-borda bg-fundo ${modoMarcacao ? 'cursor-crosshair' : ''}`}
        aria-label={`Radar de granadas`}
      >
        <image href={`/radars/${mapa}.png`} width="100" height="100" opacity="0.9" />

        {calloutsVisiveis.map((c) => (
          <text
            key={c.nome}
            x={c.x * 100}
            y={c.y * 100}
            textAnchor="middle"
            className="pointer-events-none select-none"
            fill="#e8e8ec"
            fontSize={c.nivel === 'noob' ? 2.6 : 1.8}
            opacity={c.nivel === 'noob' ? 0.9 : 0.7}
            style={{ paintOrder: 'stroke', stroke: '#0a0d12', strokeWidth: 0.5 }}
          >
            {c.nome}
          </text>
        ))}

        {ativa && (
          <>
            <line
              x1={ativa.arremessoX * 100} y1={ativa.arremessoY * 100}
              x2={ativa.alvoX * 100} y2={ativa.alvoY * 100}
              stroke="#ffd166" strokeWidth="0.5" strokeDasharray="1.5 1.5" opacity="0.9"
            />
            <circle cx={ativa.arremessoX * 100} cy={ativa.arremessoY * 100} r="1.6" fill="#ffd166" />
          </>
        )}

        {sugestoes.map((s, i) => (
          <circle
            key={`sug-${i}`}
            cx={s.alvoX * 100} cy={s.alvoY * 100}
            r={sugestaoAtiva === i ? 2.4 : 1.4}
            fill="none" stroke="#8fd3a6" strokeWidth="0.5"
            opacity={sugestaoAtiva === i ? 1 : 0.5}
          />
        ))}

        {lineups.map((l) => (
          <g
            key={l.id}
            onMouseEnter={() => setHoverId(l.id)}
            onMouseLeave={() => setHoverId(null)}
            onClick={(e) => {
              if (modoMarcacao) return
              e.stopPropagation()
              onSelecionar(l)
            }}
            className="cursor-pointer"
          >
            {/* área de acerto maior que o ícone, senão o hover fica nervoso */}
            <circle cx={l.alvoX * 100} cy={l.alvoY * 100} r="3" fill="transparent" />
            <MarcadorTipo tipo={l.tipo} x={l.alvoX * 100} y={l.alvoY * 100} ativo={l.id === (hoverId ?? selecionadaId)} />
          </g>
        ))}

        {modoMarcacao?.arremesso && (
          <circle cx={modoMarcacao.arremesso.x * 100} cy={modoMarcacao.arremesso.y * 100} r="1.6" fill="#ffd166" />
        )}
        {modoMarcacao?.alvo && (
          <>
            <circle cx={modoMarcacao.alvo.x * 100} cy={modoMarcacao.alvo.y * 100} r="1.6" fill="#4fb6ff" />
            <line
              x1={modoMarcacao.arremesso.x * 100} y1={modoMarcacao.arremesso.y * 100}
              x2={modoMarcacao.alvo.x * 100} y2={modoMarcacao.alvo.y * 100}
              stroke="#ffd166" strokeWidth="0.5" strokeDasharray="1.5 1.5"
            />
          </>
        )}
      </svg>

      {hovered && !modoMarcacao && (
        <div
          className="panel-cut pointer-events-none absolute z-10 w-56 border border-borda bg-superficie p-3 shadow-lg"
          style={{
            left: `${Math.min(hovered.alvoX * 100, 62)}%`,
            top: `${Math.min(hovered.alvoY * 100 + 4, 78)}%`,
          }}
        >
          <p className="font-display text-sm font-semibold text-texto">{hovered.titulo}</p>
          {ROTULO_TECNICA[hovered.tecnica] && (
            <span className="mt-1 inline-block panel-cut-sm border border-borda px-1.5 py-0.5 font-mono text-[10px] uppercase text-texto-fraco">
              {ROTULO_TECNICA[hovered.tecnica]}
            </span>
          )}
          {thumbYoutube(hovered.videoUrl) && (
            <img src={thumbYoutube(hovered.videoUrl)} alt="" className="mt-2 w-full rounded" />
          )}
          <p className="mt-1 font-mono text-[10px] uppercase text-texto-fraco">clique pra ver vídeo e passos</p>
        </div>
      )}
    </div>
  )
}
