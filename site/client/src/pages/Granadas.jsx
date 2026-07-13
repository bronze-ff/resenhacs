import { useEffect, useRef, useState } from 'react'
import { nomeMapa } from '../lib/format.js'

const MAPAS = ['de_mirage', 'de_dust2', 'de_inferno', 'de_nuke', 'de_overpass', 'de_vertigo', 'de_ancient', 'de_anubis', 'de_train']
const TIPOS = [['', 'Todas'], ['smoke', 'Smoke'], ['flash', 'Flash'], ['he', 'HE'], ['molotov', 'Molotov']]

// Desenha o ponto de arremesso (azul) e o de aterrissagem/alvo (vermelho), ligados
// por uma linha — mesmo padrão simples de canvas 2D do MapaCalor.jsx, só que menor e
// com dois pontos fixos em vez de uma nuvem. thrower/target já vêm normalizados 0..1
// do coletor (world_to_radar), então o desenho não sabe nada de coordenada de mundo.
function MiniRadar({ map, throwerX, throwerY, targetX, targetY, size = 140 }) {
  const canvasRef = useRef(null)
  const radarRef = useRef(null)
  const [radarPronto, setRadarPronto] = useState(false)

  useEffect(() => {
    setRadarPronto(false)
    const img = new Image()
    img.onload = () => { radarRef.current = img; setRadarPronto(true) }
    img.onerror = () => { radarRef.current = null; setRadarPronto(false) }
    img.src = `/radars/${map}.png`
  }, [map])

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, size, size)
    if (radarRef.current && radarRef.current.complete && radarRef.current.naturalWidth > 0) {
      ctx.drawImage(radarRef.current, 0, 0, size, size)
    } else {
      ctx.fillStyle = '#0a0d12'
      ctx.fillRect(0, 0, size, size)
    }

    const tx = throwerX * size, ty = throwerY * size
    const ax = targetX * size, ay = targetY * size

    ctx.strokeStyle = 'rgba(255,154,31,0.6)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(tx, ty)
    ctx.lineTo(ax, ay)
    ctx.stroke()

    ctx.fillStyle = '#4da6ff' // arremesso
    ctx.beginPath()
    ctx.arc(tx, ty, size >= 300 ? 6 : 4, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#e5484d' // aterrissagem/alvo
    ctx.beginPath()
    ctx.arc(ax, ay, size >= 300 ? 6 : 4, 0, Math.PI * 2)
    ctx.fill()
  }, [radarPronto, throwerX, throwerY, targetX, targetY, size])

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="panel-cut mx-auto block border border-borda"
      style={{ width: size, height: size }}
    />
  )
}

function GranadaCard({ l, aberta, onClicar }) {
  return (
    <div className="panel-cut border border-borda bg-superficie p-3">
      <button onClick={onClicar} className="block w-full text-left">
        <MiniRadar map={l.map} throwerX={l.throwerX} throwerY={l.throwerY} targetX={l.targetX} targetY={l.targetY} />
        <p className="mt-2 font-display text-sm font-semibold uppercase text-texto">{l.tipo}</p>
        <p className="font-mono text-xs text-texto-fraco">{l.throwerNick || l.throwerSteamId}</p>
        <span className={`mt-1 inline-block panel-cut-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${l.origem === 'pro' ? 'border border-destaque/40 bg-destaque/10 text-destaque' : 'border border-borda text-texto-fraco'}`}>
          {l.origem === 'pro' ? 'Pro' : 'Grupo'}
        </span>
      </button>
      {aberta && (
        <div className="mt-3 space-y-2 border-t border-borda pt-3">
          <MiniRadar map={l.map} throwerX={l.throwerX} throwerY={l.throwerY} targetX={l.targetX} targetY={l.targetY} size={300} />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs text-texto-fraco">
            <dt>Tipo</dt><dd className="text-texto">{l.tipo}</dd>
            <dt>Mapa</dt><dd className="text-texto">{nomeMapa(l.map)}</dd>
            <dt>Round</dt><dd className="text-texto">{l.roundNumber}</dd>
            <dt>Jogador</dt><dd className="text-texto">{l.throwerNick || l.throwerSteamId}</dd>
          </dl>
        </div>
      )}
    </div>
  )
}

export default function Granadas() {
  const [mapa, setMapa] = useState(MAPAS[0])
  const [tipo, setTipo] = useState('')
  const [lineups, setLineups] = useState(null)
  const [abertaId, setAbertaId] = useState(null)

  useEffect(() => {
    setLineups(null)
    setAbertaId(null)
    const params = new URLSearchParams({ map: mapa })
    if (tipo) params.set('tipo', tipo)
    fetch(`/api/lineups?${params}`)
      .then((res) => res.json())
      .then(setLineups)
      .catch(() => setLineups([]))
  }, [mapa, tipo])

  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">Granadas</h2>
      <div className="flex flex-wrap gap-3">
        <select value={mapa} onChange={(e) => setMapa(e.target.value)} className="rounded border border-borda bg-superficie px-2 py-1 font-mono text-sm">
          {MAPAS.map((m) => <option key={m} value={m}>{nomeMapa(m)}</option>)}
        </select>
        <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
          {TIPOS.map(([v, label]) => (
            <button
              key={v || 'todas'}
              onClick={() => setTipo(v)}
              className={`px-3 py-1.5 transition-colors ${tipo === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {!lineups && <p className="font-mono text-sm text-texto-fraco">Carregando…</p>}
      {lineups && lineups.length === 0 && <p className="font-mono text-sm text-texto-fraco">Nenhuma granada registrada pra esse filtro ainda.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {lineups?.map((l) => (
          <GranadaCard key={l.id} l={l} aberta={abertaId === l.id} onClicar={() => setAbertaId((v) => (v === l.id ? null : l.id))} />
        ))}
      </div>
    </div>
  )
}
