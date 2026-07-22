import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import MapaCalor from '../components/MapaCalor.jsx'

// Uma única morte, bem no canto inferior-direito (0.95, 0.95) — longe o bastante do
// centro (onde o cursor de teclado nasce) pra provar que as setas de fato o deslocam,
// em vez de o teste passar por acaso com o cursor parado no meio.
const REPLAY = {
  map: 'de_mirage',
  calibrated: true,
  names: { v1: 'vitima' },
  rounds: [
    {
      round: 1,
      frames: { 10: { players: [{ id: 'v1', x: 0.95, y: 0.95, side: 'CT' }] } },
      kills: [{ t: 10, victim: 'v1', killer: null }],
    },
  ],
}

// Achado de a11y "Mapa de Calor 100% mouse": antes só dava pra selecionar um ponto
// clicando com o mouse no canvas. Cobre a alternativa por teclado (setas + Enter).
describe('MapaCalor — navegação por teclado', () => {
  it('expõe o canvas como focável e com instrução de teclado no aria-label', () => {
    const { container } = render(<MapaCalor replay={REPLAY} onSelecionarPonto={() => {}} />)
    const canvas = container.querySelector('canvas')
    expect(canvas).toHaveAttribute('tabindex', '0')
    expect(canvas.getAttribute('aria-label')).toMatch(/setas do teclado/i)
  })

  it('Enter sem mover o cursor não seleciona nada (ponto está longe demais do centro)', () => {
    const onSelecionarPonto = vi.fn()
    const { container } = render(<MapaCalor replay={REPLAY} onSelecionarPonto={onSelecionarPonto} />)
    const canvas = container.querySelector('canvas')
    fireEvent.keyDown(canvas, { key: 'Enter' })
    expect(onSelecionarPonto).not.toHaveBeenCalled()
  })

  it('setas movem o cursor até o ponto e Enter confirma a seleção (round/frame do kill)', () => {
    const onSelecionarPonto = vi.fn()
    const { container } = render(<MapaCalor replay={REPLAY} onSelecionarPonto={onSelecionarPonto} />)
    const canvas = container.querySelector('canvas')
    // Do centro (0.5, 0.5) até perto de (0.95, 0.95): ~22 passos de 0.02 em cada eixo
    // pra entrar no raio de clique (14px em 640 ≈ 0.022 normalizado).
    for (let i = 0; i < 22; i++) {
      fireEvent.keyDown(canvas, { key: 'ArrowRight' })
      fireEvent.keyDown(canvas, { key: 'ArrowDown' })
    }
    fireEvent.keyDown(canvas, { key: 'Enter' })
    expect(onSelecionarPonto).toHaveBeenCalledWith({ round: 1, frame: 10 })
  })

  it('Espaço confirma a seleção igual ao Enter', () => {
    const onSelecionarPonto = vi.fn()
    const { container } = render(<MapaCalor replay={REPLAY} onSelecionarPonto={onSelecionarPonto} />)
    const canvas = container.querySelector('canvas')
    for (let i = 0; i < 22; i++) {
      fireEvent.keyDown(canvas, { key: 'ArrowRight' })
      fireEvent.keyDown(canvas, { key: 'ArrowDown' })
    }
    fireEvent.keyDown(canvas, { key: ' ' })
    expect(onSelecionarPonto).toHaveBeenCalledWith({ round: 1, frame: 10 })
  })

  it('Home recentraliza o cursor no meio do canvas', () => {
    const onSelecionarPonto = vi.fn()
    const { container } = render(<MapaCalor replay={REPLAY} onSelecionarPonto={onSelecionarPonto} />)
    const canvas = container.querySelector('canvas')
    for (let i = 0; i < 22; i++) {
      fireEvent.keyDown(canvas, { key: 'ArrowRight' })
      fireEvent.keyDown(canvas, { key: 'ArrowDown' })
    }
    fireEvent.keyDown(canvas, { key: 'Home' })
    fireEvent.keyDown(canvas, { key: 'Enter' })
    // De volta ao centro, longe do ponto (0.95, 0.95) — Enter não deve selecionar nada.
    expect(onSelecionarPonto).not.toHaveBeenCalled()
  })
})
