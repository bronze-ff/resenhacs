import { describe, it, expect } from 'vitest'
import { frameIndexAt, duracaoSegundos } from '../lib/replayEngine.js'

describe('frameIndexAt', () => {
  it('mapeia tempo → índice de frame pelo tickRate', () => {
    expect(frameIndexAt(0, 8, 100)).toBe(0)
    expect(frameIndexAt(1, 8, 100)).toBe(8)
    expect(frameIndexAt(2.5, 8, 100)).toBe(20)
  })

  it('clampa nos limites', () => {
    expect(frameIndexAt(-5, 8, 100)).toBe(0)
    expect(frameIndexAt(9999, 8, 100)).toBe(99)
    expect(frameIndexAt(1, 8, 0)).toBe(0)
  })
})

describe('duracaoSegundos', () => {
  it('frames / tickRate', () => {
    expect(duracaoSegundos(80, 8)).toBe(10)
    expect(duracaoSegundos(80, 0)).toBe(0)
  })
})
