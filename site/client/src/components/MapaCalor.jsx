import { useEffect, useMemo, useRef, useState } from 'react'
import { nomeMapa } from '../lib/format.js'

const TAM = 640

// Reaproveita as mesmas posições já normalizadas (0..1) que o Replay 2D usa —
// nenhum dado novo do demo é necessário, só uma leitura diferente do mesmo JSON.
function pontosDeMorte(replay, steamId) {
  const pontos = []
  for (const r of replay.rounds) {
    for (const k of r.kills) {
      if (steamId && k.victim !== steamId) continue
      const p = r.frames[k.t]?.players.find((pl) => pl.id === k.victim)
      if (p) pontos.push(p)
    }
  }
  return pontos
}

function pontosDeKill(replay, steamId) {
  const pontos = []
  for (const r of replay.rounds) {
    for (const k of r.kills) {
      if (steamId && k.killer !== steamId) continue
      const p = r.frames[k.t]?.players.find((pl) => pl.id === k.killer)
      if (p) pontos.push(p)
    }
  }
  return pontos
}

function pontosDeGranada(replay) {
  const pontos = []
  for (const r of replay.rounds) {
    for (const s of r.smokes) pontos.push({ ...s, tipo: 'smoke' })
    for (const f of r.fires) pontos.push({ ...f, tipo: 'fire' })
    for (const f of r.flashes) pontos.push({ ...f, tipo: 'flash' })
    for (const h of r.hes) pontos.push({ ...h, tipo: 'he' })
  }
  return pontos
}

const COR_GRANADA = { smoke: 'rgba(210,210,215,0.5)', fire: 'rgba(255,110,30,0.5)', flash: 'rgba(255,255,255,0.5)', he: 'rgba(255,170,60,0.5)' }

function desenhar(ctx, radar, pontos, cor, modo) {
  ctx.clearRect(0, 0, TAM, TAM)
  if (radar && radar.complete && radar.naturalWidth > 0) {
    ctx.drawImage(radar, 0, 0, TAM, TAM)
  } else {
    ctx.fillStyle = '#0a0d12'
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
}

export default function MapaCalor({ replay }) {
  const canvasRef = useRef(null)
  const radarRef = useRef(null)
  const [radarPronto, setRadarPronto] = useState(false)
  const [modo, setModo] = useState('mortes') // mortes | kills | granadas
  const [jogadorFiltro, setJogadorFiltro] = useState('')

  const jogadoresIds = useMemo(() => Object.keys(replay.names || {}), [replay])

  useEffect(() => {
    setRadarPronto(false)
    const img = new Image()
    img.onload = () => { radarRef.current = img; setRadarPronto(true) }
    img.onerror = () => { radarRef.current = null; setRadarPronto(false) }
    img.src = `/radars/${replay.map}.png`
  }, [replay.map])

  const pontos = useMemo(() => {
    if (modo === 'mortes') return pontosDeMorte(replay, jogadorFiltro || null)
    if (modo === 'kills') return pontosDeKill(replay, jogadorFiltro || null)
    return pontosDeGranada(replay)
  }, [replay, modo, jogadorFiltro])

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const cor = modo === 'mortes' ? 'rgba(229,72,77,0.35)' : 'rgba(255,154,31,0.35)'
    desenhar(ctx, radarRef.current, pontos, cor, modo)
  }, [pontos, modo, radarPronto])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
          {[['mortes', 'Onde morre'], ['kills', 'Onde mata'], ['granadas', 'Granadas']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setModo(v)}
              className={`px-3 py-1.5 transition-colors ${modo === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {modo !== 'granadas' && (
          <select
            value={jogadorFiltro}
            onChange={(e) => setJogadorFiltro(e.target.value)}
            className="rounded border border-borda bg-superficie px-2 py-1 font-mono text-xs"
          >
            <option value="">Todo mundo</option>
            {jogadoresIds.map((id) => <option key={id} value={id}>{replay.names[id]}</option>)}
          </select>
        )}
        <span className="font-mono text-xs text-texto-fraco">{pontos.length} pontos</span>
      </div>
      {!replay.calibrated && (
        <p className="font-mono text-xs uppercase tracking-wide text-amber-400">
          Mapa sem calibração de radar — posições em coordenadas cruas.
        </p>
      )}
      <canvas
        ref={canvasRef}
        width={TAM}
        height={TAM}
        className="panel-cut mx-auto block w-full max-w-[640px] border border-borda"
        aria-label={`Mapa de calor de ${nomeMapa(replay.map)}`}
      />
    </div>
  )
}
