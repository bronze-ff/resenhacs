import { useEffect, useRef, useState } from 'react'
import { frameIndexAt, duracaoSegundos } from '../lib/replayEngine.js'
import { nomeMapa, nomeArma, categoriaArma } from '../lib/format.js'
import { Select } from './ui'

const TAM = 640 // lado do canvas em px
// Cor por LADO real (CT/T), não pelo time fixo A/B — pedido do usuário: no jogo de
// verdade CT é sempre azul e T sempre laranja, trocando no intervalo; usar o time fixo
// (como Economia/Scoreboard fazem, de propósito, pra somar stats da partida inteira)
// deixava o radar tático "errado" aos olhos de quem tá acostumado com o HUD do CS2.
const COR_LADO = { CT: '#4fb6ff', T: '#f5a524' }

// Lado (CT/T) de um jogador num tick específico do round — usado pro kill feed, que só
// tem o id do killer/vítima e o tick do kill, não o objeto do frame já resolvido.
function ladoNoTick(round, tick, steamId) {
  return round?.frames?.[tick]?.players.find((p) => p.id === steamId)?.side
}
// Quanto tempo (em segundos) o traçado da bala + ícone de kill ficam visíveis depois
// do tiro, desaparecendo aos poucos — mesma ideia do "round recap" da Leetify, só que
// ao vivo durante a reprodução em vez de um card estático de round inteiro.
const DURACAO_TRACADO_S = 1.6

function janelaAtiva(itens, f, campoIni = 'tStart', campoFim = 'tEnd') {
  return (itens || []).filter((it) => f >= it[campoIni] && f <= it[campoFim])
}

// Ícones reais das armas (SVG oficiais do CS2, mesma fonte dos ícones de mapa em
// public/mapicons/ — Juknum/counter-strike-icons, extraído dos arquivos do jogo) em
// public/weapons/<nome-interno>.svg. Antes disso o ícone era uma forma geométrica
// genérica por CATEGORIA (rifle/sniper/pistol/...) — um AK-47 e uma AWP desenhavam a
// mesma silhueta de "rifle"/"sniper", o que o usuário reportou como "ícone errado,
// não condiz com a arma". Cache module-level (a mesma imagem serve qualquer instância
// do viewer); carrega sob demanda e chama `aoCarregar` quando termina, pro componente
// forçar um redesenho — o ícone pode ainda não estar pronto no frame em que é usado
// pela primeira vez (SVG local carrega rápido, mas não é instantâneo).
const cacheIconesArma = new Map()
function obterIconeArma(weapon, aoCarregar) {
  if (!weapon) return null
  let entrada = cacheIconesArma.get(weapon)
  if (!entrada) {
    const img = new Image()
    entrada = { img, pronto: false }
    cacheIconesArma.set(weapon, entrada)
    img.onload = () => { entrada.pronto = true; aoCarregar?.() }
    img.onerror = () => { entrada.pronto = false }
    img.src = `/weapons/${weapon}.svg`
  }
  return entrada.pronto ? entrada.img : null
}

// Plaquinha de fundo escuro (contrasta com o mapa/traçado por baixo, bug real de
// 2026-07-11: sem isso o ícone se perdia dentro do traçado colorido) + o ícone real
// da arma, sempre "em pé" (nunca rotacionado pro ângulo do tiro — uma silhueta de
// arma virada de lado/de cabeça pra baixo fica irreconhecível; toda referência de
// killfeed, do HLTV ao Leetify, mostra o ícone sempre na mesma orientação).
function desenharIconeArma(ctx, weapon, x, y, cor, aoCarregar) {
  ctx.save()
  ctx.fillStyle = 'rgba(10,13,18,0.85)'
  ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = cor; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke()

  const img = obterIconeArma(weapon, aoCarregar)
  if (img && img.naturalWidth > 0) {
    const LADO_MAX = 16 // cabe dentro da plaquinha (raio 11) com folga
    const escala = Math.min(LADO_MAX / img.naturalWidth, LADO_MAX / img.naturalHeight)
    const w = img.naturalWidth * escala, h = img.naturalHeight * escala
    ctx.drawImage(img, x - w / 2, y - h / 2, w, h)
  } else {
    // ainda carregando (ou arma sem ícone mapeado): marcador simples no lugar
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

// Traçado da bala: linha atirador→vítima no MOMENTO do tiro (posições fixas naquele
// frame, não seguem o movimento), some aos poucos. Ícone da arma no meio do traçado —
// mesmo conceito visual do card de round do Leetify, só que ao vivo durante a
// reprodução em vez de ser um resumo estático do round.
//
// `fatal` diferencia kill (round.kills — caveira, "HS" em vermelho, entra no kill feed
// da lateral) de hit sem morte (round.hits — só a marca de acerto). Miss não dá pra
// traçar sem simular física de bala contra o mapa (não temos essa geometria), então
// só cobre tiro que ACERTOU alguém — é a versão honesta de "todo tiro" que dá pra fazer.
function desenharUmTiro(ctx, t, evento, round, f, replay, hz, fatal, aoCarregarIcone) {
  if (t == null || f < t) return
  const dt = (f - t) / hz
  if (dt > DURACAO_TRACADO_S) return
  const alpha = 1 - dt / DURACAO_TRACADO_S
  const frameDoTiro = round.frames[t]
  if (!frameDoTiro) return
  const atirador = evento.killer ? frameDoTiro.players.find((p) => p.id === evento.killer) : null
  const vitima = frameDoTiro.players.find((p) => p.id === evento.victim)
  if (!vitima) return
  const vx = vitima.x * TAM, vy = vitima.y * TAM
  const corTiro = COR_LADO[atirador?.side] ?? '#e6edf3'

  if (atirador) {
    const ax = atirador.x * TAM, ay = atirador.y * TAM
    ctx.globalAlpha = alpha * (fatal ? 0.85 : 0.55)
    ctx.strokeStyle = corTiro
    ctx.lineWidth = evento.headshot ? 2 : 1.3
    ctx.setLineDash(evento.weapon && categoriaArma(evento.weapon) === 'sniper' ? [] : [5, 3])
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(vx, vy); ctx.stroke()
    ctx.setLineDash([])

    ctx.globalAlpha = alpha * (fatal ? 1 : 0.7)
    desenharIconeArma(ctx, evento.weapon, ax + (vx - ax) * 0.5, ay + (vy - ay) * 0.5, corTiro, aoCarregarIcone)
  }

  ctx.globalAlpha = alpha
  ctx.textAlign = 'center'
  if (fatal) {
    // Caveira na vítima (só kill mata de verdade).
    ctx.font = '14px system-ui, sans-serif'
    ctx.fillText('💀', vx, vy + 5)
    if (evento.headshot) {
      ctx.font = '700 8px system-ui'
      ctx.fillStyle = '#f87171'
      ctx.fillText('HS', vx, vy - 10)
    }
  } else {
    // Hit sem morte: marca de acerto (x pequeno), sem caveira.
    ctx.strokeStyle = '#f87171'; ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(vx - 3, vy - 3); ctx.lineTo(vx + 3, vy + 3)
    ctx.moveTo(vx + 3, vy - 3); ctx.lineTo(vx - 3, vy + 3)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function desenharTracadoDeBala(ctx, round, f, replay, hz, aoCarregarIcone) {
  for (const k of round.kills || []) desenharUmTiro(ctx, k.t, k, round, f, replay, hz, true, aoCarregarIcone)
  for (const h of round.hits || []) desenharUmTiro(ctx, h.t, h, round, f, replay, hz, false, aoCarregarIcone)
}

function desenharFrame(ctx, round, f, radar, replay, aoCarregarIcone) {
  ctx.clearRect(0, 0, TAM, TAM)
  // Fundo: imagem de radar se carregada; senão, grade neutra.
  if (radar && radar.complete && radar.naturalWidth > 0) {
    ctx.drawImage(radar, 0, 0, TAM, TAM)
  } else {
    ctx.fillStyle = '#0a0a0c'
    ctx.fillRect(0, 0, TAM, TAM)
    ctx.strokeStyle = '#262f3d'
    ctx.lineWidth = 1
    for (let i = 0; i <= TAM; i += TAM / 16) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, TAM); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(TAM, i); ctx.stroke()
    }
  }
  if (!round) return
  const frame = round.frames[f]
  const hz = replay.tickRate

  // Molotov (fogo) e smoke, por baixo dos jogadores, com o tempo restante no centro.
  ctx.textAlign = 'center'
  for (const fire of janelaAtiva(round.fires, f)) {
    const fx = fire.x * TAM, fy = fire.y * TAM
    ctx.fillStyle = 'rgba(255,110,30,0.30)'
    ctx.beginPath(); ctx.arc(fx, fy, 18, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.font = '700 10px system-ui'
    ctx.fillText(`${((fire.tEnd - f) / hz).toFixed(1)}s`, fx, fy + 3)
  }
  for (const sm of janelaAtiva(round.smokes, f)) {
    const sx = sm.x * TAM, sy = sm.y * TAM
    ctx.fillStyle = 'rgba(210,210,215,0.55)'
    ctx.beginPath(); ctx.arc(sx, sy, 24, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#0b0e13'; ctx.font = '700 10px system-ui'
    ctx.fillText(`${((sm.tEnd - f) / hz).toFixed(1)}s`, sx, sy + 3)
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
  const cegos = new Map()
  for (const b of round.blinds || []) {
    if (f >= b.t && f <= b.tEnd) cegos.set(b.victim, Math.max(cegos.get(b.victim) ?? 0, b.tEnd))
  }
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
    ctx.fillStyle = COR_LADO[p.side] ?? '#888'
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
      ctx.fillStyle = '#f5a524'
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
      // countdown de cegueira ao lado do boneco
      if (cegos.has(p.id)) {
        ctx.textAlign = 'left'; ctx.fillStyle = '#7dd3fc'; ctx.font = '700 9px system-ui'
        ctx.fillText(`${((cegos.get(p.id) - f) / hz).toFixed(1)}s`, cx + 10, cy + 4)
        ctx.textAlign = 'center'; ctx.font = '600 11px system-ui, sans-serif'
      }
    }
    ctx.globalAlpha = 1
  }

  // Traçado de bala + ícone de arma + caveira dos kills recentes (por cima dos jogadores).
  desenharTracadoDeBala(ctx, round, f, replay, hz, aoCarregarIcone)

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

export default function ReplayViewer({ replay, seek }) {
  const canvasRef = useRef(null)
  const radarRef = useRef(null)
  const rafRef = useRef(0)
  const inicioRef = useRef(0)
  const [roundIdx, setRoundIdx] = useState(0)
  const [tocando, setTocando] = useState(false)
  const [velocidade, setVelocidade] = useState(1)
  const [frameAtual, setFrameAtual] = useState(0)
  const [radarPronto, setRadarPronto] = useState(false)
  const [iconesVersao, setIconesVersao] = useState(0)

  // Deep link (ex.: clicar num Highlight): pula pro round/frame e toca. `seek.key` muda
  // a cada clique (mesmo mirando o mesmo round/frame de novo) pra sempre re-disparar.
  // O frame salvo é o momento exato do highlight (ex.: o último kill do multi-kill) —
  // recua alguns segundos antes de tocar, senão a jogada já teria acabado de acontecer.
  useEffect(() => {
    if (!seek) return
    const idx = replay.rounds.findIndex((r) => r.round === seek.round)
    if (idx === -1) return
    const LOOKBACK_SEGUNDOS = 5
    const frameInicial = Math.max(0, (seek.frame ?? 0) - LOOKBACK_SEGUNDOS * replay.tickRate)
    setRoundIdx(idx)
    setFrameAtual(frameInicial)
    setTocando(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seek?.key])

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

  // Redesenha quando o frame muda, quando o radar termina de carregar, ou quando um
  // ícone de arma usado pela 1ª vez termina de carregar (iconesVersao).
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) desenharFrame(ctx, round, frameAtual, radarRef.current, replay, () => setIconesVersao((v) => v + 1))
  }, [frameAtual, roundIdx, radarPronto, iconesVersao]) // eslint-disable-line react-hooks/exhaustive-deps

  const dur = duracaoSegundos(total, replay.tickRate)

  // Kill feed: kills do round que já aconteceram e ainda estão dentro da janela de ~6s.
  const janela = replay.tickRate * 6
  const feed = (round?.kills ?? [])
    .filter((k) => k.t <= frameAtual && frameAtual - k.t <= janela)
    .slice(-5)

  return (
    <div className="space-y-3">
      {!replay.calibrated && (
        <p className="font-mono text-xs uppercase tracking-wide text-amber-400">
          Mapa sem calibração de radar — posições em coordenadas cruas (adicione a calibração no Coletor).
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={roundIdx}
          onChange={(e) => { setRoundIdx(Number(e.target.value)); setFrameAtual(0); setTocando(false) }}
        >
          {replay.rounds.map((r, i) => (
            <option key={r.round} value={i}>Round {r.round}</option>
          ))}
        </Select>
        <button
          onClick={() => setTocando((t) => !t)}
          className="panel-cut-sm flex min-h-10 items-center justify-center border border-destaque bg-destaque px-4 py-1 font-display text-sm font-semibold uppercase tracking-wide text-fundo lg:min-h-0"
        >
          {tocando ? 'Pausar' : 'Play'}
        </button>
        <Select value={velocidade} onChange={(e) => setVelocidade(Number(e.target.value))}>
          {[0.5, 1, 2, 4].map((v) => <option key={v} value={v}>{v}x</option>)}
        </Select>
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={frameAtual}
          onChange={(e) => { setFrameAtual(Number(e.target.value)); setTocando(false) }}
          className="min-h-10 min-w-[140px] flex-1 accent-[color:var(--color-destaque)] lg:min-h-0 lg:min-w-0"
        />
        <span className="w-24 text-right font-mono text-xs tabular-nums text-texto-fraco">
          {(frameAtual / replay.tickRate).toFixed(1)}s / {dur.toFixed(1)}s
        </span>
      </div>
      <div className="relative mx-auto w-full max-w-[640px]">
        <canvas
          ref={canvasRef}
          width={TAM}
          height={TAM}
          className="panel-cut block w-full border border-borda"
          aria-label={`Replay 2D de ${nomeMapa(replay.map)}`}
        />
        <div className="mt-2 flex flex-col gap-1 lg:pointer-events-none lg:absolute lg:right-2 lg:top-2 lg:mt-0 lg:items-end">
          {feed.map((k, i) => (
            <div
              key={`${k.t}-${i}`}
              className="flex flex-wrap items-center gap-1.5 border border-borda/60 bg-black/75 px-2 py-1 font-mono text-xs lg:flex-nowrap"
            >
              {k.killer ? (
                <>
                  <span className="max-w-[8rem] truncate font-semibold" style={{ color: COR_LADO[ladoNoTick(round, k.t, k.killer)] ?? '#e6edf3' }}>
                    {replay.names?.[k.killer] ?? k.killer}
                  </span>
                  <span className="text-texto-fraco">{nomeArma(k.weapon)}</span>
                  {k.headshot && <span className="font-semibold text-perigo">hs</span>}
                </>
              ) : (
                <span className="text-texto-fraco">queda/ambiente</span>
              )}
              <span className="text-texto-fraco">→</span>
              <span className="max-w-[8rem] truncate font-semibold" style={{ color: COR_LADO[ladoNoTick(round, k.t, k.victim)] ?? '#e6edf3' }}>
                {replay.names?.[k.victim] ?? k.victim}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
