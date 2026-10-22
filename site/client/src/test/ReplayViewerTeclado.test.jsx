// site/client/src/test/ReplayViewerTeclado.test.jsx
// Onda 1, S3b: atalhos e rótulos do Replay 2D (R24), nick só do Jogador em foco (R22),
// frames que chegam depois retomam o play (R96) e pulo com play ativo (R97).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ReplayViewer, { mostraNick, jogadorMaisProximo, textoTempo, TAM } from '../components/ReplayViewer.jsx'

const HZ = 10
const frames = (n) => Array.from({ length: n }, (_, t) => ({ t, players: [] }))
const replayCom = (rounds) => ({ map: 'de_mirage', calibrated: true, tickRate: HZ, names: {}, rounds })
const REPLAY = replayCom([
  { round: 1, frames: frames(200), kills: [], hits: [] },
  { round: 2, frames: frames(200), kills: [], hits: [] },
])

// requestAnimationFrame e performance.now controlados: cada `avancar(ms)` roda um passo do loop.
let filaRaf
let agora
function avancar(ms) {
  agora += ms
  const fila = filaRaf
  filaRaf = []
  act(() => { fila.forEach((cb) => cb(agora)) })
}

beforeEach(() => {
  filaRaf = []
  agora = 1000
  vi.stubGlobal('requestAnimationFrame', (cb) => { filaRaf.push(cb); return filaRaf.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(performance, 'now').mockImplementation(() => agora)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function montar(replay = REPLAY, seek = null) {
  const utils = render(<MemoryRouter><ReplayViewer replay={replay} seek={seek} /></MemoryRouter>)
  const grupo = screen.getByRole('group', { name: /replay 2d de/i })
  const tempo = () => screen.getByRole('slider', { name: 'Tempo do round' }).getAttribute('aria-valuetext')
  return { ...utils, grupo, tempo }
}

describe('Replay 2D — rótulos', () => {
  it('range, Selects e canvas têm nome acessível', () => {
    montar()
    expect(screen.getByRole('slider', { name: 'Tempo do round' })).toHaveAttribute('aria-valuetext', '0 s de 20 s')
    expect(screen.getByRole('button', { name: 'Round' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Velocidade' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /mapa .*round 1/i })).toBeInTheDocument()
  })

  it('textoTempo usa vírgula decimal', () => {
    expect(textoTempo(12.34, 95)).toBe('12,3 s de 95 s')
  })
})

describe('Replay 2D — atalhos de teclado', () => {
  it('Espaço alterna play/pausa', () => {
    const { grupo } = montar()
    fireEvent.keyDown(grupo, { key: ' ' })
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeInTheDocument()
    fireEvent.keyDown(grupo, { key: ' ' })
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeInTheDocument()
  })

  it('setas andam 5 s, sem passar das pontas', () => {
    const { grupo, tempo } = montar()
    fireEvent.keyDown(grupo, { key: 'ArrowRight' })
    expect(tempo()).toBe('5 s de 20 s')
    fireEvent.keyDown(grupo, { key: 'ArrowLeft' })
    fireEvent.keyDown(grupo, { key: 'ArrowLeft' })
    expect(tempo()).toBe('0 s de 20 s')
  })

  it('ponto e vírgula trocam de round', () => {
    const { grupo } = montar()
    fireEvent.keyDown(grupo, { key: '.' })
    expect(screen.getByRole('img', { name: /round 2/i })).toBeInTheDocument()
    fireEvent.keyDown(grupo, { key: '.' })
    expect(screen.getByRole('img', { name: /round 2/i })).toBeInTheDocument()
    fireEvent.keyDown(grupo, { key: ',' })
    expect(screen.getByRole('img', { name: /round 1/i })).toBeInTheDocument()
  })

  it('Espaço num botão não dispara o atalho (o botão trata a própria tecla)', () => {
    montar()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reproduzir' }), { key: ' ' })
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeInTheDocument()
  })
})

describe('Replay 2D — nick só em foco', () => {
  it('mostraNick: só o focado e o clutcher', () => {
    expect(mostraNick('a', 'a', null)).toBe(true)
    expect(mostraNick('b', 'a', null)).toBe(false)
    expect(mostraNick('c', null, 'c')).toBe(true)
    expect(mostraNick('d', null, null)).toBe(false)
  })

  it('jogadorMaisProximo: pega o vivo mais perto dentro do raio', () => {
    const players = [
      { id: 'longe', alive: true, x: 0.9, y: 0.9 },
      { id: 'morto', alive: false, x: 0.5, y: 0.5 },
      { id: 'perto', alive: true, x: 0.51, y: 0.5 },
    ]
    expect(jogadorMaisProximo(players, 0.5 * TAM, 0.5 * TAM)).toBe('perto')
    expect(jogadorMaisProximo(players, 0.1 * TAM, 0.1 * TAM)).toBe(null)
  })
})

describe('Replay 2D — reprodução', () => {
  it('R97: pulo no mesmo round com play ativo segue do ponto novo', () => {
    const { grupo, tempo, rerender } = montar()
    fireEvent.keyDown(grupo, { key: ' ' })
    avancar(100)
    expect(tempo()).toBe('0,1 s de 20 s')
    // Highlight no frame 150: o viewer recua 5 s e toca a partir do frame 100.
    rerender(<MemoryRouter><ReplayViewer replay={REPLAY} seek={{ round: 1, frame: 150, key: 'h1' }} /></MemoryRouter>)
    avancar(100)
    expect(tempo()).toBe('10,1 s de 20 s')
  })

  it('R96: play antes dos frames chegarem espera e retoma quando chegam', () => {
    const vazio = replayCom([{ round: 1, frames: [], kills: [], hits: [] }])
    const { grupo, tempo, rerender } = montar(vazio)
    fireEvent.keyDown(grupo, { key: ' ' })
    avancar(100)
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeInTheDocument()
    const cheio = replayCom([{ round: 1, frames: frames(200), kills: [], hits: [] }])
    rerender(<MemoryRouter><ReplayViewer replay={cheio} seek={null} /></MemoryRouter>)
    avancar(0)
    avancar(300)
    expect(tempo()).toBe('0,3 s de 20 s')
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeInTheDocument()
  })
})

describe('Replay 2D — pulo para a morte (Lições)', () => {
  const VITIMA = '765'
  const comKills = (kills, n = 400) => replayCom([
    { round: 1, frames: frames(n), kills: [], hits: [] },
    { round: 2, frames: frames(n), kills, hits: [] },
  ])

  it('pula 5 s antes da primeira morte da vítima no round', () => {
    const replay = comKills([
      { t: 50, victim: 'outro' },
      { t: null, victim: VITIMA },
      { t: 300, victim: VITIMA },
      { t: 350, victim: VITIMA },
    ])
    const { tempo } = montar(replay, { round: 2, frame: null, vitima: VITIMA, key: 'l1' })
    expect(screen.getByRole('img', { name: /round 2/i })).toBeInTheDocument()
    expect(tempo()).toBe('25 s de 40 s')
  })

  it('vítima sem kill no round começa no frame 0', () => {
    const { tempo } = montar(comKills([{ t: 300, victim: 'outro' }]), { round: 2, frame: null, vitima: VITIMA, key: 'l2' })
    expect(screen.getByRole('img', { name: /round 2/i })).toBeInTheDocument()
    expect(tempo()).toBe('0 s de 40 s')
  })

  it('round em streaming: aplica depois de carregar, uma vez por key', () => {
    const vazio = replayCom([
      { round: 1, frames: frames(400), kills: [], hits: [] },
      { round: 2, frames: [], kills: [], hits: [] },
    ])
    const seek = { round: 2, frame: null, vitima: VITIMA, key: 'l3' }
    const { tempo, grupo, rerender } = montar(vazio, seek)
    // O round alvo já fica selecionado enquanto carrega.
    expect(screen.getByRole('img', { name: /round 2/i })).toBeInTheDocument()
    const cheio = comKills([{ t: 300, victim: VITIMA }])
    rerender(<MemoryRouter><ReplayViewer replay={cheio} seek={seek} /></MemoryRouter>)
    expect(screen.getByRole('img', { name: /round 2/i })).toBeInTheDocument()
    expect(tempo()).toBe('25 s de 40 s')
    // Pausa e anda; um novo objeto de replay (outro round chegando) não reaplica o pulo.
    fireEvent.keyDown(grupo, { key: ' ' })
    fireEvent.keyDown(grupo, { key: 'ArrowRight' })
    const depois = tempo()
    rerender(<MemoryRouter><ReplayViewer replay={{ ...cheio, rounds: [...cheio.rounds] }} seek={seek} /></MemoryRouter>)
    expect(tempo()).toBe(depois)
  })
})

