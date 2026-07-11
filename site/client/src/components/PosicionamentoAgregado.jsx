import { useEffect, useRef, useState } from 'react'
import { nomeMapa } from '../lib/format.js'

const TAM = 480

function desenhar(ctx, radar, pontos, cor) {
  ctx.clearRect(0, 0, TAM, TAM)
  if (radar && radar.complete && radar.naturalWidth > 0) {
    ctx.drawImage(radar, 0, 0, TAM, TAM)
  } else {
    ctx.fillStyle = '#0a0d12'
    ctx.fillRect(0, 0, TAM, TAM)
  }
  ctx.globalCompositeOperation = 'lighter'
  for (const p of pontos) {
    ctx.fillStyle = cor
    ctx.beginPath()
    ctx.arc(p.x * TAM, p.y * TAM, 8, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
}

// Preview de posicionamento agregado — "onde ele mais mata/morre" ao longo de VÁRIAS
// Partidas (não uma só, como o Replay 2D). Componente próprio (não reaproveita
// MapaCalor.jsx) porque não tem click-to-replay nem round/frame — é uma nuvem de
// pontos pool de várias partidas, não uma linha do tempo de UMA partida.
export default function PosicionamentoAgregado({ steamId }) {
  const canvasRef = useRef(null)
  const radarRef = useRef(null)
  const [radarPronto, setRadarPronto] = useState(false)
  const [modo, setModo] = useState('mortes') // mortes | kills
  const [dados, setDados] = useState(null)
  const [mapaEscolhido, setMapaEscolhido] = useState('')

  useEffect(() => {
    setDados(null)
    const qs = new URLSearchParams({ modo })
    if (mapaEscolhido) qs.set('map', mapaEscolhido)
    fetch(`/api/profile/${steamId}/posicoes?${qs}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setDados)
      .catch(() => setDados(null))
  }, [steamId, modo, mapaEscolhido])

  useEffect(() => {
    if (!dados?.map) return
    setRadarPronto(false)
    const img = new Image()
    img.onload = () => { radarRef.current = img; setRadarPronto(true) }
    img.onerror = () => { radarRef.current = null; setRadarPronto(false) }
    img.src = `/radars/${dados.map}.png`
  }, [dados?.map])

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx || !dados) return
    const cor = modo === 'mortes' ? 'rgba(229,72,77,0.4)' : 'rgba(255,154,31,0.4)'
    desenhar(ctx, radarRef.current, dados.pontos, cor)
  }, [dados, modo, radarPronto])

  if (dados === null && !mapaEscolhido) {
    return <p className="font-mono text-sm text-texto-fraco">Carregando posicionamento…</p>
  }
  if (dados && !dados.map) {
    return <p className="font-mono text-sm text-texto-fraco">Sem dados de posicionamento ainda.</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
          {[['mortes', 'Onde morre'], ['kills', 'Onde mata']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setModo(v)}
              className={`px-3 py-1.5 transition-colors ${modo === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {dados?.mapas?.length > 0 && (
          <select
            value={mapaEscolhido || dados.map}
            onChange={(e) => setMapaEscolhido(e.target.value)}
            className="rounded border border-borda bg-superficie px-2 py-1 font-mono text-xs"
          >
            {dados.mapas.map((m) => (
              <option key={m.map} value={m.map}>{nomeMapa(m.map)} ({m.pontos})</option>
            ))}
          </select>
        )}
        {dados && <span className="font-mono text-xs text-texto-fraco">{dados.pontos.length} pontos</span>}
      </div>
      {dados && !dados.calibrated && (
        <p className="font-mono text-xs uppercase tracking-wide text-amber-400">
          Mapa sem calibração de radar — sem preview visual ainda.
        </p>
      )}
      <canvas
        ref={canvasRef}
        width={TAM}
        height={TAM}
        className="panel-cut mx-auto block w-full max-w-[480px] border border-borda"
        aria-label={`Posicionamento agregado em ${nomeMapa(dados?.map)}`}
      />
    </div>
  )
}
