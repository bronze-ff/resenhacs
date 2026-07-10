import { useEffect, useRef, useState } from 'react'
import { frameIndexAt, duracaoSegundos, COR_TIME } from '../lib/replayEngine.js'
import { nomeMapa } from '../lib/format.js'

const TAM = 640 // lado do canvas em px

function desenharFrame(ctx, frame, radar) {
  ctx.clearRect(0, 0, TAM, TAM)
  // Fundo: imagem de radar se carregada; senão, grade neutra.
  if (radar && radar.complete && radar.naturalWidth > 0) {
    ctx.drawImage(radar, 0, 0, TAM, TAM)
  } else {
    ctx.fillStyle = '#0b0e13'
    ctx.fillRect(0, 0, TAM, TAM)
    ctx.strokeStyle = '#1a2130'
    ctx.lineWidth = 1
    for (let i = 0; i <= TAM; i += TAM / 16) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, TAM); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(TAM, i); ctx.stroke()
    }
  }
  if (!frame) return
  for (const p of frame.players) {
    const cx = p.x * TAM
    const cy = p.y * TAM
    ctx.globalAlpha = p.alive ? 1 : 0.3
    ctx.fillStyle = COR_TIME[p.team] ?? '#888'
    ctx.beginPath()
    ctx.arc(cx, cy, 6, 0, Math.PI * 2)
    ctx.fill()
    // direção (yaw): traço curto apontando pra onde olha
    if (p.alive) {
      const rad = (-p.yaw * Math.PI) / 180
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(rad) * 11, cy + Math.sin(rad) * 11)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
}

export default function ReplayViewer({ replay }) {
  const canvasRef = useRef(null)
  const radarRef = useRef(null)
  const rafRef = useRef(0)
  const inicioRef = useRef(0)
  const [roundIdx, setRoundIdx] = useState(0)
  const [tocando, setTocando] = useState(false)
  const [velocidade, setVelocidade] = useState(1)
  const [frameAtual, setFrameAtual] = useState(0)
  const [radarPronto, setRadarPronto] = useState(false)

  const round = replay.rounds[roundIdx]
  const frames = round?.frames ?? []
  const total = frames.length

  // Carrega a imagem de radar do mapa (opcional; se não existir, usa a grade).
  // radarPronto força o redesenho quando a imagem termina de carregar.
  useEffect(() => {
    setRadarPronto(false)
    const img = new Image()
    img.onload = () => { radarRef.current = img; setRadarPronto(true) }
    img.onerror = () => { radarRef.current = null; setRadarPronto(false) }
    img.src = `/radars/${replay.map}.png`
  }, [replay.map])

  // Loop de animação.
  useEffect(() => {
    if (!tocando) return
    inicioRef.current = performance.now() - (frameAtual / replay.tickRate) * 1000 / velocidade
    function passo(agora) {
      const elapsed = ((agora - inicioRef.current) / 1000) * velocidade
      const idx = frameIndexAt(elapsed, replay.tickRate, total)
      setFrameAtual(idx)
      if (idx >= total - 1) {
        setTocando(false)
        return
      }
      rafRef.current = requestAnimationFrame(passo)
    }
    rafRef.current = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(rafRef.current)
  }, [tocando, velocidade, roundIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  // Redesenha quando o frame muda OU quando o radar termina de carregar.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) desenharFrame(ctx, frames[frameAtual], radarRef.current)
  }, [frameAtual, roundIdx, radarPronto]) // eslint-disable-line react-hooks/exhaustive-deps

  const dur = duracaoSegundos(total, replay.tickRate)

  return (
    <div className="space-y-3">
      {!replay.calibrated && (
        <p className="text-xs text-amber-400">
          Mapa sem calibração de radar — posições em coordenadas cruas (adicione a calibração no Coletor).
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={roundIdx}
          onChange={(e) => { setRoundIdx(Number(e.target.value)); setFrameAtual(0); setTocando(false) }}
          className="rounded border border-borda bg-superficie px-2 py-1 text-sm"
        >
          {replay.rounds.map((r, i) => (
            <option key={r.round} value={i}>Round {r.round}</option>
          ))}
        </select>
        <button
          onClick={() => setTocando((t) => !t)}
          className="rounded bg-destaque px-4 py-1 text-sm font-medium text-fundo"
        >
          {tocando ? 'Pausar' : 'Play'}
        </button>
        <select
          value={velocidade}
          onChange={(e) => setVelocidade(Number(e.target.value))}
          className="rounded border border-borda bg-superficie px-2 py-1 text-sm"
        >
          {[0.5, 1, 2, 4].map((v) => <option key={v} value={v}>{v}x</option>)}
        </select>
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={frameAtual}
          onChange={(e) => { setFrameAtual(Number(e.target.value)); setTocando(false) }}
          className="flex-1 accent-[color:var(--color-destaque)]"
        />
        <span className="w-24 text-right text-xs tabular-nums text-texto-fraco">
          {(frameAtual / replay.tickRate).toFixed(1)}s / {dur.toFixed(1)}s
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={TAM}
        height={TAM}
        className="mx-auto block w-full max-w-[640px] rounded-xl border border-borda"
        aria-label={`Replay 2D de ${nomeMapa(replay.map)}`}
      />
    </div>
  )
}
