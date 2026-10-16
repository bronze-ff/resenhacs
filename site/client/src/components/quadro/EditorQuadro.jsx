import { useEffect, useRef, useState } from 'react'
import { Button, Card, Input } from '../ui'
import { CORES } from '../../lib/colors.js'
import { nomeMapa } from '../../lib/format.js'
import { interpolarPassos, simplificarTraco, LIMITES, TIPOS_PECA } from '../../lib/quadroEditor.js'

const S = 1000 // lado do viewBox do SVG (coords 0..1 × S)
const DURACAO_PASSO_MS = 1200
const NUDGE = 0.01

const COR_SMOKE = 'rgba(237,237,239,0.22)'
const COR_TRACO = '#ededef'
const COR_HE = '#f2555a'
const COR_MOLOTOV = '#ff8a3d'

function IconeFerramenta({ id }) {
  const p = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', className: 'h-5 w-5', 'aria-hidden': true }
  switch (id) {
    case 'mover': return <svg {...p}><path d="M5 3l12 8-5 1.5L9.5 18z" /></svg>
    case 'ct': return <svg {...p}><circle cx="12" cy="12" r="6" fill={CORES.timeB} stroke="none" /></svg>
    case 't': return <svg {...p}><circle cx="12" cy="12" r="6" fill={CORES.timeA} stroke="none" /></svg>
    case 'smoke': return <svg {...p}><circle cx="12" cy="12" r="8" strokeDasharray="3 2" /></svg>
    case 'flash': return <svg {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" /></svg>
    case 'molotov': return <svg {...p}><path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z" /></svg>
    case 'he': return <svg {...p}><circle cx="12" cy="13" r="7" /><path d="M12 6V3M10 3h4" /></svg>
    case 'seta': return <svg {...p}><path d="M4 20L20 4M11 4h9v9" /></svg>
    case 'traco': return <svg {...p}><path d="M3 17c3-6 5 2 8-3s4-8 10-6" /></svg>
    case 'apagar': return <svg {...p}><path d="M20 20H9L4 15l9-9 7 7-6 6M8 11l6 6" /></svg>
    default: return null
  }
}

export const FERRAMENTAS = [
  { id: 'mover', rotulo: 'Mover', tecla: 'V' },
  { id: 'ct', rotulo: 'Jogador CT', tecla: 'C' },
  { id: 't', rotulo: 'Jogador T', tecla: 'T' },
  { id: 'smoke', rotulo: 'Smoke', tecla: 'S' },
  { id: 'flash', rotulo: 'Flash', tecla: 'F' },
  { id: 'molotov', rotulo: 'Molotov', tecla: 'M' },
  { id: 'he', rotulo: 'HE', tecla: 'H' },
  { id: 'seta', rotulo: 'Seta', tecla: 'A' },
  { id: 'traco', rotulo: 'Desenho livre', tecla: 'D' },
  { id: 'apagar', rotulo: 'Apagar', tecla: 'E' },
]

const NOME_TIPO = { ct: 'Jogador CT', t: 'Jogador T', smoke: 'Smoke', flash: 'Flash', molotov: 'Molotov', he: 'HE', seta: 'Seta', traco: 'Desenho' }

function emCampoDeTexto(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable || el.getAttribute?.('role') === 'listbox'
}

function Objeto({ o, selecionado }) {
  const x = o.x * S
  const y = o.y * S
  const anel = selecionado ? <circle cx={x} cy={y} r={o.tipo === 'smoke' ? 52 : o.tipo === 'molotov' ? 44 : 26} fill="none" stroke="var(--color-destaque)" strokeWidth="4" /> : null
  switch (o.tipo) {
    case 'ct':
    case 't':
      return (
        <>
          {anel}
          <circle cx={x} cy={y} r="15" fill={o.tipo === 'ct' ? CORES.timeB : CORES.timeA} stroke={CORES.fundo} strokeWidth="4" />
          {o.rotulo && (
            <text x={x} y={y - 24} textAnchor="middle" fontSize="22" fontWeight="600" fill="#fff" stroke="rgba(0,0,0,0.85)" strokeWidth="5" paintOrder="stroke">
              {o.rotulo}
            </text>
          )}
        </>
      )
    case 'smoke':
      return <>{anel}<circle cx={x} cy={y} r="45" fill={COR_SMOKE} stroke="rgba(237,237,239,0.6)" strokeWidth="2" strokeDasharray="8 6" /></>
    case 'flash':
      return (
        <>
          {anel}
          <circle cx={x} cy={y} r="14" fill="rgba(255,255,255,0.9)" />
          <path d={`M${x} ${y - 26}V${y - 18}M${x} ${y + 18}V${y + 26}M${x - 26} ${y}H${x - 18}M${x + 18} ${y}H${x + 26}`} stroke="#fff" strokeWidth="4" strokeLinecap="round" />
        </>
      )
    case 'molotov':
      return <>{anel}<circle cx={x} cy={y} r="36" fill="rgba(255,106,26,0.28)" stroke={COR_MOLOTOV} strokeWidth="3" /></>
    case 'he':
      return <>{anel}<circle cx={x} cy={y} r="18" fill="rgba(242,85,90,0.25)" stroke={COR_HE} strokeWidth="4" /><circle cx={x} cy={y} r="4" fill={COR_HE} /></>
    case 'seta':
      return (
        <>
          <line x1={x} y1={y} x2={o.x2 * S} y2={o.y2 * S} stroke="transparent" strokeWidth="28" />
          <line x1={x} y1={y} x2={o.x2 * S} y2={o.y2 * S} stroke={selecionado ? 'var(--color-destaque)' : COR_TRACO} strokeWidth="6" strokeLinecap="round" markerEnd="url(#quadro-ponta)" />
        </>
      )
    case 'traco': {
      const d = o.pontos.map(([px, py], i) => `${i ? 'L' : 'M'}${px * S} ${py * S}`).join('')
      return (
        <>
          <path d={d} fill="none" stroke="transparent" strokeWidth="24" />
          <path d={d} fill="none" stroke={selecionado ? 'var(--color-destaque)' : COR_TRACO} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )
    }
    default:
      return null
  }
}

// Editor visual: barra de ferramentas, quadro (SVG sobre o radar) e faixa de passos.
// O estado mora no reducer (lib/quadroEditor.js); aqui só eventos de ponteiro/teclado.
export default function EditorQuadro({ estado, dispatch }) {
  const svgRef = useRef(null)
  const arrasteRef = useRef(null)
  const ferramentasRef = useRef([])
  const [ferramenta, setFerramenta] = useState('mover')
  const [rascunho, setRascunho] = useState(null) // seta/traço sendo desenhado
  const [radarFalhou, setRadarFalhou] = useState(false)
  const [renomeando, setRenomeando] = useState(null) // índice do passo
  const [animacao, setAnimacao] = useState(null) // { t } em ms desde o início
  const { passos, passoAtivo, selecionado, meta } = estado
  const passo = passos[passoAtivo]

  useEffect(() => { setRadarFalhou(false) }, [meta.map])

  // Atalhos globais: ferramentas por letra, ctrl+z, delete, setas.
  useEffect(() => {
    function aoTeclar(e) {
      if (emCampoDeTexto(e.target) || document.querySelector('[role="dialog"]')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ tipo: 'desfazer' })
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (selecionado && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        dispatch({ tipo: 'apagarObjeto', id: selecionado })
        return
      }
      if (selecionado && e.key.startsWith('Arrow') && e.target === svgRef.current) {
        e.preventDefault()
        const o = passo.objetos.find((ob) => ob.id === selecionado)
        if (!o) return
        const d = e.shiftKey ? NUDGE * 5 : NUDGE
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
        dispatch({ tipo: 'moverObjeto', id: o.id, x: o.x + dx, y: o.y + dy, registrar: true })
        return
      }
      if (e.key === 'Escape') { dispatch({ tipo: 'selecionar', id: null }); return }
      const f = FERRAMENTAS.find((fe) => fe.tecla === e.key.toUpperCase())
      if (f && e.key.length === 1) setFerramenta(f.id)
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [dispatch, selecionado, passo])

  // Animação: percorre os passos em sequência interpolando posições.
  useEffect(() => {
    if (!animacao) return
    const reduzir = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const inicio = performance.now() - animacao.t
    let raf = 0
    function quadro(agora) {
      const t = agora - inicio
      if (t >= (passos.length - 1) * DURACAO_PASSO_MS) {
        setAnimacao(null)
        dispatch({ tipo: 'selecionarPasso', indice: passos.length - 1 })
        return
      }
      setAnimacao({ t, reduzir })
      raf = requestAnimationFrame(quadro)
    }
    raf = requestAnimationFrame(quadro)
    return () => cancelAnimationFrame(raf)
    // Só reinicia quando liga/desliga; o `t` interno avança dentro do loop.
  }, [Boolean(animacao)]) // eslint-disable-line react-hooks/exhaustive-deps

  let objetosVisiveis = passo.objetos
  let rotuloAnimacao = null
  if (animacao) {
    const seg = Math.min(passos.length - 2, Math.floor(animacao.t / DURACAO_PASSO_MS))
    let k = (animacao.t - seg * DURACAO_PASSO_MS) / DURACAO_PASSO_MS
    if (animacao.reduzir) k = k < 0.5 ? 0 : 1
    objetosVisiveis = interpolarPassos(passos[seg], passos[seg + 1], k)
    rotuloAnimacao = `${passos[seg].nome || `Passo ${seg + 1}`} → ${passos[seg + 1].nome || `Passo ${seg + 2}`}`
  }

  function pontoDoEvento(e) {
    const r = svgRef.current.getBoundingClientRect()
    if (!r.width || !r.height) return { x: 0.5, y: 0.5 }
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }

  function aoPressionar(e) {
    if (animacao || e.button > 0) return
    const p = pontoDoEvento(e)
    const alvoId = e.target.closest?.('[data-objeto]')?.getAttribute('data-objeto') ?? null
    svgRef.current.setPointerCapture?.(e.pointerId)
    if (ferramenta === 'mover') {
      if (!alvoId) { dispatch({ tipo: 'selecionar', id: null }); return }
      const o = passo.objetos.find((ob) => ob.id === alvoId)
      arrasteRef.current = { id: alvoId, dx: p.x - o.x, dy: p.y - o.y, moveu: false }
      dispatch({ tipo: 'selecionar', id: alvoId })
      return
    }
    if (ferramenta === 'apagar') {
      if (alvoId) dispatch({ tipo: 'apagarObjeto', id: alvoId })
      return
    }
    if (TIPOS_PECA.includes(ferramenta)) {
      dispatch({ tipo: 'adicionarObjeto', objeto: { tipo: ferramenta, x: p.x, y: p.y } })
      return
    }
    if (ferramenta === 'seta') setRascunho({ tipo: 'seta', x: p.x, y: p.y, x2: p.x, y2: p.y })
    if (ferramenta === 'traco') setRascunho({ tipo: 'traco', x: p.x, y: p.y, pontos: [[p.x, p.y]] })
  }

  function aoMover(e) {
    const a = arrasteRef.current
    if (a) {
      const p = pontoDoEvento(e)
      if (!a.moveu) { dispatch({ tipo: 'iniciarArraste', id: a.id }); a.moveu = true }
      dispatch({ tipo: 'moverObjeto', id: a.id, x: p.x - a.dx, y: p.y - a.dy })
      return
    }
    if (!rascunho) return
    const p = pontoDoEvento(e)
    if (rascunho.tipo === 'seta') setRascunho({ ...rascunho, x2: p.x, y2: p.y })
    else {
      const [ux, uy] = rascunho.pontos[rascunho.pontos.length - 1]
      if (Math.hypot(p.x - ux, p.y - uy) >= 0.004) setRascunho({ ...rascunho, pontos: [...rascunho.pontos, [p.x, p.y]] })
    }
  }

  function aoSoltar() {
    arrasteRef.current = null
    if (!rascunho) return
    if (rascunho.tipo === 'seta' && Math.hypot(rascunho.x2 - rascunho.x, rascunho.y2 - rascunho.y) > 0.015) {
      dispatch({ tipo: 'adicionarObjeto', objeto: rascunho })
    }
    if (rascunho.tipo === 'traco' && rascunho.pontos.length >= 2) {
      dispatch({ tipo: 'adicionarObjeto', objeto: { ...rascunho, pontos: simplificarTraco(rascunho.pontos) } })
    }
    setRascunho(null)
  }

  // Teclado no quadro: Enter coloca a peça da ferramenta ativa no centro (depois as
  // setas movem); com Mover, Enter seleciona o próximo objeto.
  function aoTeclarQuadro(e) {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.target !== svgRef.current || animacao) return
    if (TIPOS_PECA.includes(ferramenta)) {
      e.preventDefault()
      dispatch({ tipo: 'adicionarObjeto', objeto: { tipo: ferramenta, x: 0.5, y: 0.5 } })
    } else if (ferramenta === 'mover' && passo.objetos.length > 0) {
      // Enter percorre os objetos do passo (seleção por teclado).
      e.preventDefault()
      const i = passo.objetos.findIndex((o) => o.id === selecionado)
      dispatch({ tipo: 'selecionar', id: passo.objetos[(i + 1) % passo.objetos.length].id })
    }
  }

  function aoTeclarFerramentas(e) {
    const i = FERRAMENTAS.findIndex((f) => f.id === ferramenta)
    let novo = null
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') novo = (i + 1) % FERRAMENTAS.length
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') novo = (i - 1 + FERRAMENTAS.length) % FERRAMENTAS.length
    if (e.key === 'Home') novo = 0
    if (e.key === 'End') novo = FERRAMENTAS.length - 1
    if (novo == null) return
    e.preventDefault()
    e.stopPropagation()
    setFerramenta(FERRAMENTAS[novo].id)
    ferramentasRef.current[novo]?.focus()
  }

  const qtdGranadas = passo.objetos.filter((o) => ['smoke', 'flash', 'molotov', 'he'].includes(o.tipo)).length
  const qtdJogadores = passo.objetos.filter((o) => o.tipo === 'ct' || o.tipo === 't').length

  return (
    <div className="grid gap-4 lg:grid-cols-[56px_minmax(0,1fr)]">
      <Card
        className="flex flex-row flex-wrap items-center gap-1 p-2 lg:flex-col lg:self-start"
        role="toolbar"
        aria-label="Ferramentas"
        aria-orientation="vertical"
        onKeyDown={aoTeclarFerramentas}
      >
        {FERRAMENTAS.map((f, i) => (
          <button
            key={f.id}
            ref={(el) => { ferramentasRef.current[i] = el }}
            type="button"
            tabIndex={ferramenta === f.id ? 0 : -1}
            aria-pressed={ferramenta === f.id}
            aria-label={`${f.rotulo} (${f.tecla})`}
            title={`${f.rotulo} (${f.tecla})`}
            onClick={() => setFerramenta(f.id)}
            className={`flex h-10 w-10 items-center justify-center rounded-[var(--radius-pequeno)] border transition-colors lg:h-9 lg:w-9 ${
              ferramenta === f.id ? 'border-destaque/60 bg-destaque/10 text-destaque' : 'border-transparent text-texto-fraco hover:bg-superficie-alta hover:text-texto'
            }`}
          >
            <IconeFerramenta id={f.id} />
          </button>
        ))}
      </Card>

      <Card corte={false} className="overflow-hidden lg:panel-cut">
        <div className="flex justify-center bg-[#0d0d0f] p-2">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${S} ${S}`}
            role="application"
            aria-roledescription="quadro tático"
            aria-label={`Quadro de ${nomeMapa(meta.map)}, ${passo.nome || `passo ${passoAtivo + 1}`}: ${qtdJogadores} jogadores, ${qtdGranadas} granadas. Enter coloca a peça da ferramenta ativa no centro ou, com Mover, seleciona o próximo objeto; setas movem o selecionado.`}
            tabIndex={0}
            onPointerDown={aoPressionar}
            onPointerMove={aoMover}
            onPointerUp={aoSoltar}
            onPointerCancel={aoSoltar}
            onKeyDown={aoTeclarQuadro}
            className={`block aspect-square w-full max-w-[min(100%,720px)] touch-none select-none focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-destaque)] ${
              ferramenta === 'mover' ? 'cursor-default' : ferramenta === 'apagar' ? 'cursor-pointer' : 'cursor-crosshair'
            }`}
          >
            <defs>
              <marker id="quadro-ponta" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" fill={COR_TRACO} />
              </marker>
              <pattern id="quadro-grade" width={S / 16} height={S / 16} patternUnits="userSpaceOnUse">
                <path d={`M${S / 16} 0H0V${S / 16}`} fill="none" stroke="#262f3d" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width={S} height={S} fill={radarFalhou ? 'url(#quadro-grade)' : 'transparent'} />
            {!radarFalhou && (
              <image href={`/radars/${meta.map}.png`} width={S} height={S} opacity="0.75" onError={() => setRadarFalhou(true)} />
            )}
            {objetosVisiveis.map((o) => (
              <g
                key={o.id}
                data-objeto={animacao ? undefined : o.id}
                opacity={o.opacidade ?? 1}
                role={animacao ? undefined : 'img'}
                aria-label={animacao ? undefined : `${NOME_TIPO[o.tipo]}${o.rotulo ? ` ${o.rotulo}` : ''}`}
                className={ferramenta === 'mover' && !animacao ? 'cursor-grab' : undefined}
              >
                <Objeto o={o} selecionado={!animacao && o.id === selecionado} />
              </g>
            ))}
            {rascunho && <g opacity="0.7"><Objeto o={rascunho} selecionado={false} /></g>}
          </svg>
        </div>
        {radarFalhou && (
          <p className="border-t border-borda px-4 py-2 font-mono text-xs text-aviso">Sem imagem de radar para {nomeMapa(meta.map)}; desenhando sobre a grade.</p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-borda px-3 py-2.5">
          <span className="rotulo mr-1">Passos</span>
          {passos.map((p, i) =>
            renomeando === i ? (
              <form
                key={p.id}
                onSubmit={(e) => { e.preventDefault(); setRenomeando(null) }}
                className="w-40"
              >
                <Input
                  aria-label={`Nome do passo ${i + 1}`}
                  autoFocus
                  maxLength={60}
                  defaultValue={p.nome}
                  onBlur={(e) => { dispatch({ tipo: 'renomearPasso', indice: i, nome: e.target.value }); setRenomeando(null) }}
                  onKeyDown={(e) => { if (e.key === 'Escape') setRenomeando(null) }}
                />
              </form>
            ) : (
              <Button
                key={p.id}
                tamanho="sm"
                variante={i === passoAtivo ? 'contorno' : 'secundario'}
                aria-pressed={i === passoAtivo}
                disabled={Boolean(animacao)}
                onClick={() => dispatch({ tipo: 'selecionarPasso', indice: i })}
                onDoubleClick={() => setRenomeando(i)}
              >
                <span className="font-mono tabular-nums">{i + 1}</span>
                {p.nome && <span>· {p.nome}</span>}
              </Button>
            ),
          )}
          <Button tamanho="sm" variante="fantasma" disabled={passos.length >= LIMITES.passos || Boolean(animacao)} onClick={() => dispatch({ tipo: 'adicionarPasso' })}>
            + passo
          </Button>
          <span className="flex-1" />
          <Button tamanho="sm" variante="fantasma" disabled={Boolean(animacao)} onClick={() => setRenomeando(passoAtivo)}>
            Renomear
          </Button>
          <Button tamanho="sm" variante="fantasma" disabled={passos.length <= 1 || Boolean(animacao)} onClick={() => dispatch({ tipo: 'removerPasso', indice: passoAtivo })}>
            Remover passo
          </Button>
          <Button
            tamanho="sm"
            disabled={passos.length < 2}
            onClick={() => setAnimacao((a) => (a ? null : { t: 0 }))}
            aria-pressed={Boolean(animacao)}
          >
            {animacao ? 'Parar' : '▶ Animar passos'}
          </Button>
        </div>
        <p className="sr-only" aria-live="polite">{rotuloAnimacao ?? ''}</p>
      </Card>
    </div>
  )
}
