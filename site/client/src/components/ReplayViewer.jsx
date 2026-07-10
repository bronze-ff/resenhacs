import { useEffect, useRef, useState } from 'react'
import { frameIndexAt, duracaoSegundos, COR_TIME } from '../lib/replayEngine.js'
import { nomeMapa } from '../lib/format.js'

const TAM = 640 // lado do canvas em px

function janelaAtiva(itens, f, campoIni = 'tStart', campoFim = 'tEnd') {
  return (itens || []).filter((it) => f >= it[campoIni] && f <= it[campoFim])
}

function desenharFrame(ctx, round, f, radar, replay) {
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
  if (!round) return
  const frame = round.frames[f]
  const hz = replay.tickRate

  // Molotov (fogo) e smoke, por baixo dos jogadores.
  for (const fire of janelaAtiva(round.fires, f)) {
    ctx.fillStyle = 'rgba(255,110,30,0.30)'
    ctx.beginPath(); ctx.arc(fire.x * TAM, fire.y * TAM, 18, 0, Math.PI * 2); ctx.fill()
  }
  for (const sm of janelaAtiva(round.smokes, f)) {
    ctx.fillStyle = 'rgba(210,210,215,0.55)'
    ctx.beginPath(); ctx.arc(sm.x * TAM, sm.y * TAM, 24, 0, Math.PI * 2); ctx.fill()
  }

  // Bomba plantada.
  if (round.bombPlant && f >= round.bombPlant.t) {
    const pulso = 4 + 2 * Math.sin(f / 2)
    ctx.fillStyle = '#e5484d'
    ctx.beginPath(); ctx.arc(round.bombPlant.x * TAM, round.bombPlant.y * TAM, pulso, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.font = '700 9px system-ui'; ctx.textAlign = 'center'
    ctx.fillText('C4', round.bombPlant.x * TAM, round.bombPlant.y * TAM - 8)
  }

  if (!frame) return

  // Quem está com a bomba (segmento ativo) e quem cegou agora.
  const carrier = (round.bomb || []).find((b) => f >= b.tStart && f <= b.tEnd)?.carrier
  const cegos = new Set((round.blinds || []).filter((b) => f >= b.t && f <= b.tEnd).map((b) => b.victim))
  const clutcher = round.clutch && f >= round.clutch.t ? round.clutch.steamid : null

  ctx.textAlign = 'center'
  ctx.font = '600 11px system-ui, sans-serif'
  for (const p of frame.players) {
    const cx = p.x * TAM
    const cy = p.y * TAM
    const hpBaixo = p.alive && p.hp > 0 && p.hp <= 20
    ctx.globalAlpha = p.alive ? 1 : 0.22

    // clutcher: anel dourado
    if (p.id === clutcher && p.alive) {
      ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2.5
      ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.stroke()
    }
    // cego: anel branco
    if (cegos.has(p.id) && p.alive) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.stroke()
    }

    // corpo
    ctx.fillStyle = COR_TIME[p.team] ?? '#888'
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill()
    // HP baixo: anel vermelho fino
    if (hpBaixo) {
      ctx.strokeStyle = '#e5484d'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.stroke()
    }
    // direção (yaw)
    if (p.alive) {
      const rad = (-p.yaw * Math.PI) / 180
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(rad) * 11, cy + Math.sin(rad) * 11); ctx.stroke()
    }
    // portador da bomba: quadradinho laranja ao lado
    if (p.id === carrier && p.alive) {
      ctx.fillStyle = '#f5a623'
      ctx.fillRect(cx + 6, cy - 3, 6, 6)
    }
    // nick (+ estrela se clutcher, + hp se baixo)
    if (p.alive) {
      const nick = (replay.names?.[p.id] || '') + (p.id === clutcher ? ' ★' : '')
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.strokeText(nick, cx, cy - 11); ctx.fillStyle = '#fff'; ctx.fillText(nick, cx, cy - 11)
      if (hpBaixo) {
        ctx.fillStyle = '#f87171'; ctx.font = '700 9px system-ui'
        ctx.fillText(String(p.hp), cx, cy + 16); ctx.font = '600 11px system-ui, sans-serif'
      }
    }
    ctx.globalAlpha = 1
  }

  // Flashes (estouro) e HE, por cima — breves.
  for (const fl of (round.flashes || [])) {
    const dt = f - fl.t
    if (dt >= 0 && dt <= hz) {
      ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - dt / hz)})`
      ctx.beginPath(); ctx.arc(fl.x * TAM, fl.y * TAM, 16, 0, Math.PI * 2); ctx.fill()
    }
  }
  for (const he of (round.hes || [])) {
    const dt = f - he.t
    if (dt >= 0 && dt <= hz / 2) {
      ctx.strokeStyle = `rgba(255,170,60,${1 - dt / (hz / 2)})`; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(he.x * TAM, he.y * TAM, 8 + dt * 4, 0, Math.PI * 2); ctx.stroke()
    }
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
    if (ctx) desenharFrame(ctx, round, frameAtual, radarRef.current, replay)
  }, [frameAtual, roundIdx, radarPronto]) // eslint-disable-line react-hooks/exhaustive-deps

  const dur = duracaoSegundos(total, replay.tickRate)

  // Kill feed: kills do round que já aconteceram e ainda estão dentro da janela de ~6s.
  const janela = replay.tickRate * 6
  const feed = (round?.kills ?? [])
    .filter((k) => k.t <= frameAtual && frameAtual - k.t <= janela)
    .slice(-5)

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
      <div className="relative mx-auto w-full max-w-[640px]">
        <canvas
          ref={canvasRef}
          width={TAM}
          height={TAM}
          className="block w-full rounded-xl border border-borda"
          aria-label={`Replay 2D de ${nomeMapa(replay.map)}`}
        />
        <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1">
          {feed.map((k, i) => (
            <div
              key={`${k.t}-${i}`}
              className="flex items-center gap-1.5 rounded bg-black/70 px-2 py-1 text-xs"
            >
              <span className="font-semibold" style={{ color: COR_TIME[replay.teams?.[k.killer]] ?? '#e6edf3' }}>
                {replay.names?.[k.killer] ?? k.killer}
              </span>
              <span className="text-texto-fraco">{k.weapon}</span>
              {k.headshot && <span className="font-semibold text-rose-400">hs</span>}
              <span className="text-texto-fraco">→</span>
              <span className="font-semibold" style={{ color: COR_TIME[replay.teams?.[k.victim]] ?? '#e6edf3' }}>
                {replay.names?.[k.victim] ?? k.victim}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
