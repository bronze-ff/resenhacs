import { useEffect, useMemo, useRef, useState } from 'react'
import { nomeMapa } from '../lib/format.js'
import { CORES } from '../lib/colors.js'
import { Select } from './ui'

const TAM = 640
const RAIO_CLIQUE = 14 // px — distância máxima do clique até um ponto pra considerar "acertou"
const RAIO_CLIQUE_NORM = RAIO_CLIQUE / TAM // mesmo raio, em coordenadas normalizadas (0..1) — usado pelo cursor de teclado
const PASSO_TECLADO = 0.02 // ~13px em 640 — avanço por tecla, perto do próprio raio de clique

// Reaproveita as mesmas posições já normalizadas (0..1) que o Replay 2D usa —
// nenhum dado novo do demo é necessário, só uma leitura diferente do mesmo JSON.
// Cada ponto guarda round/frame também, pra dar pra clicar e pular pro replay.
// Os arrays de eventos são opcionais no replay JSON (round sem granada não tem `flashes`
// etc.) — mesma convenção do ReplayViewer; sem os `?? []` um round vazio derruba a página.
// side (CT/T) é o lado REAL naquele tick (troca no intervalo, ao contrário do
// team A/B fixo) — permite filtrar "morreu avançando de CT", por exemplo.
function pontosDeMorte(replay, steamId) {
  const pontos = []
  for (const r of replay.rounds ?? []) {
    for (const k of r.kills ?? []) {
      if (steamId && k.victim !== steamId) continue
      const p = r.frames?.[k.t]?.players.find((pl) => pl.id === k.victim)
      if (p) pontos.push({ x: p.x, y: p.y, round: r.round, frame: k.t, side: p.side })
    }
  }
  return pontos
}

function pontosDeKill(replay, steamId) {
  const pontos = []
  for (const r of replay.rounds ?? []) {
    for (const k of r.kills ?? []) {
      if (!k.killer) continue
      if (steamId && k.killer !== steamId) continue
      const p = r.frames?.[k.t]?.players.find((pl) => pl.id === k.killer)
      if (p) pontos.push({ x: p.x, y: p.y, round: r.round, frame: k.t, side: p.side })
    }
  }
  return pontos
}

function pontosDeGranada(replay) {
  const pontos = []
  for (const r of replay.rounds ?? []) {
    for (const s of r.smokes ?? []) pontos.push({ x: s.x, y: s.y, round: r.round, frame: s.tStart, tipo: 'smoke' })
    for (const f of r.fires ?? []) pontos.push({ x: f.x, y: f.y, round: r.round, frame: f.tStart, tipo: 'fire' })
    for (const f of r.flashes ?? []) pontos.push({ x: f.x, y: f.y, round: r.round, frame: f.t, tipo: 'flash' })
    for (const h of r.hes ?? []) pontos.push({ x: h.x, y: h.y, round: r.round, frame: h.t, tipo: 'he' })
  }
  return pontos
}

const COR_GRANADA = { smoke: 'rgba(210,210,215,0.5)', fire: 'rgba(255,110,30,0.5)', flash: 'rgba(255,255,255,0.5)', he: 'rgba(255,170,60,0.5)' }
const TIPOS_GRANADA = [['', 'Todas'], ['flash', 'Flash'], ['smoke', 'Smoke'], ['he', 'HE'], ['fire', 'Molotov']]
const LADOS = [['', 'Ambos'], ['CT', 'CT'], ['T', 'T']]

function desenhar(ctx, radar, pontos, cor, modo, cursorTeclado) {
  ctx.clearRect(0, 0, TAM, TAM)
  if (radar && radar.complete && radar.naturalWidth > 0) {
    ctx.drawImage(radar, 0, 0, TAM, TAM)
  } else {
    ctx.fillStyle = CORES.fundo
    ctx.fillRect(0, 0, TAM, TAM)
  }
  ctx.globalCompositeOperation = 'lighter'
  for (const p of pontos) {
    const x = p.x * TAM, y = p.y * TAM
    ctx.fillStyle = modo === 'granadas' ? COR_GRANADA[p.tipo] ?? cor : cor
    ctx.beginPath()
    ctx.arc(x, y, 10, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  // Cursor virtual do teclado — só existe (não-null) depois que o usuário navega com
  // as setas; some pra quem usa mouse. Anel bem visível, cor de destaque pra não se
  // confundir com os pontos de dado.
  if (cursorTeclado) {
    ctx.strokeStyle = CORES.ouro
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cursorTeclado.x * TAM, cursorTeclado.y * TAM, RAIO_CLIQUE_NORM * TAM, 0, Math.PI * 2)
    ctx.stroke()
  }
}

export default function MapaCalor({ replay, onSelecionarPonto }) {
  const canvasRef = useRef(null)
  const radarRef = useRef(null)
  const [radarPronto, setRadarPronto] = useState(false)
  const [modo, setModo] = useState('mortes') // mortes | kills | granadas
  const [jogadorFiltro, setJogadorFiltro] = useState('')
  const [ladoFiltro, setLadoFiltro] = useState('') // '' | CT | T — só se aplica a mortes/kills
  const [tipoGranadaFiltro, setTipoGranadaFiltro] = useState('') // '' | flash | smoke | he | fire
  // Cursor virtual de teclado (coords normalizadas 0..1) — null até a 1ª tecla de seta,
  // pra não aparecer pra quem só usa mouse. Alternativa a11y ao clique no canvas, que
  // antes só dava pra operar com mouse (achado de acessibilidade "Mapa de Calor 100% mouse").
  const [cursorTeclado, setCursorTeclado] = useState(null)

  const jogadoresIds = useMemo(() => Object.keys(replay.names || {}), [replay])

  useEffect(() => {
    setRadarPronto(false)
    const img = new Image()
    img.onload = () => { radarRef.current = img; setRadarPronto(true) }
    img.onerror = () => { radarRef.current = null; setRadarPronto(false) }
    img.src = `/radars/${replay.map}.png`
  }, [replay.map])

  const pontos = useMemo(() => {
    if (modo === 'mortes' || modo === 'kills') {
      const base = modo === 'mortes' ? pontosDeMorte(replay, jogadorFiltro || null) : pontosDeKill(replay, jogadorFiltro || null)
      return ladoFiltro ? base.filter((p) => p.side === ladoFiltro) : base
    }
    const granadas = pontosDeGranada(replay)
    return tipoGranadaFiltro ? granadas.filter((p) => p.tipo === tipoGranadaFiltro) : granadas
  }, [replay, modo, jogadorFiltro, ladoFiltro, tipoGranadaFiltro])

  const interativo = true // todo ponto (kill/morte/granada) já carrega round+frame pra pular no Replay 2D

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const cor = modo === 'mortes' ? 'rgba(229,72,77,0.35)' : 'rgba(255,154,31,0.35)'
    desenhar(ctx, radarRef.current, pontos, cor, modo, cursorTeclado)
  }, [pontos, modo, radarPronto, cursorTeclado])

  // Ponto mais próximo de (x, y) — coords normalizadas 0..1 — dentro do raio de clique.
  // Compartilhado pelo clique de mouse e pela confirmação (Enter) do cursor de teclado,
  // pra não duplicar a mesma busca por distância duas vezes.
  function selecionarPontoProximo(x, y) {
    if (!onSelecionarPonto) return
    let maisPerto = null
    let menorDist = RAIO_CLIQUE_NORM
    for (const p of pontos) {
      const dist = Math.hypot(p.x - x, p.y - y)
      if (dist < menorDist) {
        menorDist = dist
        maisPerto = p
      }
    }
    if (maisPerto) onSelecionarPonto({ round: maisPerto.round, frame: maisPerto.frame })
  }

  function aoClicarCanvas(e) {
    if (!interativo || !onSelecionarPonto) return
    const rect = canvasRef.current.getBoundingClientRect()
    selecionarPontoProximo((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
  }

  // Setas movem um cursor virtual pelo canvas (surge no centro na 1ª tecla); Enter/Espaço
  // confirma o ponto mais próximo, igual ao clique de mouse. Home recentraliza rápido
  // caso o cursor "se perca" fora da área visível.
  function aoTeclarCanvas(e) {
    if (!interativo || !onSelecionarPonto) return
    const atual = cursorTeclado ?? { x: 0.5, y: 0.5 }
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault(); setCursorTeclado({ x: Math.max(0, atual.x - PASSO_TECLADO), y: atual.y }); break
      case 'ArrowRight':
        e.preventDefault(); setCursorTeclado({ x: Math.min(1, atual.x + PASSO_TECLADO), y: atual.y }); break
      case 'ArrowUp':
        e.preventDefault(); setCursorTeclado({ x: atual.x, y: Math.max(0, atual.y - PASSO_TECLADO) }); break
      case 'ArrowDown':
        e.preventDefault(); setCursorTeclado({ x: atual.x, y: Math.min(1, atual.y + PASSO_TECLADO) }); break
      case 'Home':
        e.preventDefault(); setCursorTeclado({ x: 0.5, y: 0.5 }); break
      case 'Enter':
      case ' ':
        e.preventDefault(); selecionarPontoProximo(atual.x, atual.y); break
      default:
        break
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="panel-cut-sm flex overflow-hidden border border-borda font-mono text-xs uppercase">
          {[['mortes', 'Onde morre'], ['kills', 'Onde mata'], ['granadas', 'Granadas']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setModo(v)}
              className={`flex min-h-10 items-center px-3 py-1.5 transition-colors lg:min-h-0 ${modo === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {modo !== 'granadas' && (
          <>
            <Select value={jogadorFiltro} onChange={(e) => setJogadorFiltro(e.target.value)} selectClassName="text-xs">
              <option value="">Todo mundo</option>
              {jogadoresIds.map((id) => <option key={id} value={id}>{replay.names[id]}</option>)}
            </Select>
            <div className="panel-cut-sm flex overflow-hidden border border-borda font-mono text-xs uppercase">
              {LADOS.map(([v, label]) => (
                <button
                  key={v || 'ambos'}
                  onClick={() => setLadoFiltro(v)}
                  title={v ? `Só quando estava jogando de ${v}` : 'CT e T juntos'}
                  className={`flex min-h-10 items-center px-2.5 py-1.5 transition-colors lg:min-h-0 ${ladoFiltro === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
        {modo === 'granadas' && (
          <div className="panel-cut-sm flex overflow-hidden border border-borda font-mono text-xs uppercase">
            {TIPOS_GRANADA.map(([v, label]) => (
              <button
                key={v || 'todas'}
                onClick={() => setTipoGranadaFiltro(v)}
                className={`flex min-h-10 items-center px-2.5 py-1.5 transition-colors lg:min-h-0 ${tipoGranadaFiltro === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <span className="font-mono text-xs text-texto-fraco">{pontos.length} pontos</span>
        {interativo && (
          <span className="font-mono text-xs text-texto-fraco">
            · clique num ponto (ou navegue com as setas do teclado + Enter) pra assistir no Replay 2D
          </span>
        )}
      </div>
      {!replay.calibrated && (
        <p className="font-mono text-xs uppercase tracking-wide" style={{ color: CORES.aviso }}>
          Mapa sem calibração de radar — posições em coordenadas cruas.
        </p>
      )}
      <canvas
        ref={canvasRef}
        width={TAM}
        height={TAM}
        tabIndex={interativo && onSelecionarPonto ? 0 : undefined}
        onClick={aoClicarCanvas}
        onKeyDown={aoTeclarCanvas}
        className={`panel-cut mx-auto block w-full max-w-[640px] border border-borda ${interativo ? 'cursor-pointer' : ''}`}
        aria-label={`Mapa de calor de ${nomeMapa(replay.map)}. Use as setas do teclado pra mover o cursor e Enter pra selecionar o ponto mais próximo.`}
      />
    </div>
  )
}
