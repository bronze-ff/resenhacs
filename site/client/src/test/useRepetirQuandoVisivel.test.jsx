import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useRepetirQuandoVisivel } from '../lib/useRepetirQuandoVisivel.js'

let hidden = false

afterEach(() => {
  cleanup()
  hidden = false
  delete document.hidden
  vi.useRealTimers()
})

function esconder(valor) {
  hidden = valor
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
}

describe('useRepetirQuandoVisivel', () => {
  it('chama na hora e de novo a cada intervalo, com a aba visível', () => {
    vi.useFakeTimers()
    esconder(false)
    const consultar = vi.fn()
    renderHook(() => useRepetirQuandoVisivel(consultar, 1000))
    expect(consultar).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(consultar).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1000)
    expect(consultar).toHaveBeenCalledTimes(3)
  })

  it('não chama com a aba escondida e chama na hora ao voltar', () => {
    vi.useFakeTimers()
    esconder(true)
    const consultar = vi.fn()
    renderHook(() => useRepetirQuandoVisivel(consultar, 1000))
    expect(consultar).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(consultar).not.toHaveBeenCalled()

    esconder(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(consultar).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(consultar).toHaveBeenCalledTimes(2)
  })

  it('pausa o timer enquanto escondida e retoma com uma chamada imediata', () => {
    vi.useFakeTimers()
    esconder(false)
    const consultar = vi.fn()
    renderHook(() => useRepetirQuandoVisivel(consultar, 1000))
    expect(consultar).toHaveBeenCalledTimes(1)

    esconder(true)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(5000)
    expect(consultar).toHaveBeenCalledTimes(1)

    esconder(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(consultar).toHaveBeenCalledTimes(2)
  })

  it('com imediato false espera o intervalo, mas a volta da aba chama na hora', () => {
    vi.useFakeTimers()
    esconder(false)
    const consultar = vi.fn()
    renderHook(() => useRepetirQuandoVisivel(consultar, 1000, { imediato: false }))
    expect(consultar).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(consultar).toHaveBeenCalledTimes(1)

    esconder(true)
    document.dispatchEvent(new Event('visibilitychange'))
    esconder(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(consultar).toHaveBeenCalledTimes(2)
  })

  it('desligado não chama, nem ao voltar pra aba', () => {
    vi.useFakeTimers()
    esconder(false)
    const consultar = vi.fn()
    const { rerender } = renderHook(
      ({ ligado }) => useRepetirQuandoVisivel(consultar, 1000, { ligado }),
      { initialProps: { ligado: false } },
    )
    vi.advanceTimersByTime(5000)
    esconder(true)
    document.dispatchEvent(new Event('visibilitychange'))
    esconder(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(consultar).not.toHaveBeenCalled()

    rerender({ ligado: true })
    expect(consultar).toHaveBeenCalledTimes(1)
  })
})
