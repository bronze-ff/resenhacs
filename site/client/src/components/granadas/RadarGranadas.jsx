import { useEffect, useMemo, useRef, useState } from 'react'
import { thumbYoutube } from '../../lib/youtube.js'
import { ROTULO_TECNICA } from '../../lib/rotulos.js'
import { Card, Badge } from '../ui'

// Ícone simples por tipo, desenhado direto em SVG (sem lib de ícones).
// Exportado (named) pra ser reusado no mini-radar dos cards de Táticas
// (MiniRadarTatica.jsx) sem duplicar o desenho dos marcadores.
//
// `estado` é opcional e só usado pelo builder de táticas (FormTatica.jsx):
// 'ativo' (vinculada ao papel selecionado, anel laranja forte), 'outro'
// (vinculada a outro papel, anel cinza fino) ou 'normal'/undefined (sem
// vínculo — some apagada quando `estado` está presente pra dar contraste).
// Sem essa prop o marcador se comporta exatamente como antes.
export function MarcadorTipo({ tipo, x, y, ativo, estado }) {
  const corPorTipo = { smoke: '#d2d2d7', flash: '#fff8d6', he: '#ffaa3c', molotov: '#ff6e1e' }
  const cor = ativo ? '#ffd166' : estado === 'ativo' ? '#ff2e43' : corPorTipo[tipo]
  const opacidade = estado === 'normal' ? 0.4 : 0.9
  const anel = estado === 'ativo'
    ? <circle cx={x} cy={y} r="3.1" fill="none" stroke="#ff2e43" strokeWidth="0.6" opacity="0.95" />
    : estado === 'outro'
      ? <circle cx={x} cy={y} r="2.7" fill="none" stroke="#d2d2d7" strokeWidth="0.4" opacity="0.55" />
      : null

  let forma
  if (tipo === 'smoke') {
    forma = <circle cx={x} cy={y} r={ativo ? 2.2 : 1.8} fill={cor} opacity={opacidade} />
  } else if (tipo === 'molotov') {
    forma = <path d={`M ${x} ${y - 2} L ${x + 1.6} ${y + 1.4} L ${x - 1.6} ${y + 1.4} Z`} fill={cor} opacity={opacidade} />
  } else if (tipo === 'flash') {
    forma = <rect x={x - 1.4} y={y - 1.4} width="2.8" height="2.8" transform={`rotate(45 ${x} ${y})`} fill={cor} opacity={opacidade} />
  } else {
    forma = <circle cx={x} cy={y} r={ativo ? 2 : 1.5} fill="none" stroke={cor} strokeWidth="0.7" opacity={opacidade} />
  }

  return <>{anel}{forma}</>
}

export default function RadarGranadas({
  mapa, lineups, selecionadaId, onSelecionar,
  callouts = [], nivelCallouts = 'sem',
  modoMarcacao = null, onCliqueMarcacao = null,
  estadoPorId = null,
}) {
  const svgRef = useRef(null)
  const [hoverId, setHoverId] = useState(null)
  // Em telas touch não existe hover: detectado uma única vez (não muda em runtime).
  // Nesse caso o 1º tap num marcador só destaca (linha tracejada + card fixo abaixo
  // do radar); abrir o modal exige tocar no botão do card. Com mouse, o hover
  // flutuante de sempre continua e o clique já abre o modal direto.
  const semHover = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches, [])
  const [destaqueId, setDestaqueId] = useState(null)

  useEffect(() => { setDestaqueId(null) }, [lineups])

  const idDestacado = semHover ? destaqueId : hoverId
  const ativa = lineups.find((l) => l.id === (idDestacado ?? selecionadaId))
  const hovered = lineups.find((l) => l.id === hoverId)
  const destacada = semHover ? lineups.find((l) => l.id === destaqueId) : null

  function coordsDoClique(e) {
    const rect = svgRef.current.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }
  }

  function aoClicarMarcador(e, l) {
    if (modoMarcacao) return
    e.stopPropagation()
    if (semHover) setDestaqueId(l.id)
    else onSelecionar(l)
  }

  const calloutsVisiveis = nivelCallouts === 'sem' ? []
    : callouts.filter((c) => nivelCallouts === 'pro' || c.nivel === 'noob')

  return (
    <div>
      {/* O radar é quadrado: em tela larga, ocupar 100% da coluna deixa ele mais ALTO
          que a janela (obriga a scrollar pra ver a metade de baixo do mapa). O teto
          em 100vh menos o header/paddings garante o mapa inteiro visível sem scroll.
          Em mobile quem limita é a largura da tela (menor que a altura), então o
          teto não interfere. */}
      <div className="relative mx-auto w-full max-w-[calc(100vh-9rem)]">
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
              style={{ paintOrder: 'stroke', stroke: '#0a0a0c', strokeWidth: 0.5 }}
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

          {lineups.map((l) => (
            <g
              key={l.id}
              onMouseEnter={() => !semHover && setHoverId(l.id)}
              onMouseLeave={() => !semHover && setHoverId(null)}
              onClick={(e) => aoClicarMarcador(e, l)}
              className="cursor-pointer"
            >
              {/* área de acerto maior que o ícone, senão o hover/tap fica nervoso */}
              <circle cx={l.alvoX * 100} cy={l.alvoY * 100} r="3" fill="transparent" />
              <MarcadorTipo
                tipo={l.tipo} x={l.alvoX * 100} y={l.alvoY * 100}
                ativo={l.id === (idDestacado ?? selecionadaId)}
                estado={estadoPorId ? (estadoPorId[l.id] ?? 'normal') : undefined}
              />
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

        {!semHover && hovered && !modoMarcacao && (
          <Card
            className="pointer-events-none absolute z-10 w-56 p-3 shadow-lg"
            style={{
              left: `${Math.min(hovered.alvoX * 100, 62)}%`,
              top: `${Math.min(hovered.alvoY * 100 + 4, 78)}%`,
            }}
          >
            <p className="font-display text-sm font-semibold text-texto">{hovered.titulo}</p>
            {hovered.tecnica !== 'normal' && (
              <Badge tom="neutro" className="mt-1">{ROTULO_TECNICA[hovered.tecnica]}</Badge>
            )}
            {thumbYoutube(hovered.videoUrl) && (
              <img src={thumbYoutube(hovered.videoUrl)} alt="" className="mt-2 w-full rounded" />
            )}
            <p className="mt-1 font-mono text-[10px] uppercase text-texto-fraco">clique pra ver vídeo e passos</p>
          </Card>
        )}
      </div>

      {/* Touch: sem hover flutuante, então o preview do marcador destacado vira
          um bloco fixo ABAIXO do radar (posição por % fica ruim em tela pequena). */}
      {semHover && destacada && !modoMarcacao && (
        <Card className="mx-auto mt-3 w-full max-w-[calc(100vh-9rem)] p-3">
          <p className="font-display text-sm font-semibold text-texto">{destacada.titulo}</p>
          {destacada.tecnica !== 'normal' && (
            <Badge tom="neutro" className="mt-1">{ROTULO_TECNICA[destacada.tecnica]}</Badge>
          )}
          {thumbYoutube(destacada.videoUrl) && (
            <img src={thumbYoutube(destacada.videoUrl)} alt="" className="mt-2 w-full rounded" />
          )}
          <button
            onClick={() => onSelecionar(destacada)}
            className="mt-2 min-h-10 w-full rounded border border-destaque bg-destaque/10 px-3 font-mono text-xs uppercase text-destaque hover:bg-destaque/20"
          >
            Ver vídeo e passos
          </button>
        </Card>
      )}
    </div>
  )
}
