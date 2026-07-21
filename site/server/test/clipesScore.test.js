import { describe, it, expect } from 'vitest'
import { calcularPontuacao } from '../src/clipesScore.js'

describe('calcularPontuacao', () => {
  it('base por tipo de jogada, sem bonus', () => {
    expect(calcularPontuacao({ kind: 'ace', todosHeadshot: false })).toEqual({ base: 100, kind: 'ace', bonusHeadshot: 0, total: 100 })
    expect(calcularPontuacao({ kind: 'clutch_1v5', todosHeadshot: false }).base).toBe(100)
    expect(calcularPontuacao({ kind: 'clutch_1v4', todosHeadshot: false }).base).toBe(85)
    expect(calcularPontuacao({ kind: 'quad', todosHeadshot: false }).base).toBe(80)
    expect(calcularPontuacao({ kind: 'clutch_1v3', todosHeadshot: false }).base).toBe(65)
    expect(calcularPontuacao({ kind: 'triple', todosHeadshot: false }).base).toBe(60)
    expect(calcularPontuacao({ kind: 'clutch_1v2', todosHeadshot: false }).base).toBe(45)
    expect(calcularPontuacao({ kind: 'clutch_1v1', todosHeadshot: false }).base).toBe(25)
  })

  it('kind desconhecido usa o piso de 10 pontos', () => {
    expect(calcularPontuacao({ kind: 'algo_novo', todosHeadshot: false })).toEqual({ base: 10, kind: 'algo_novo', bonusHeadshot: 0, total: 10 })
  })

  it('bonus de +20 quando todosHeadshot é true', () => {
    expect(calcularPontuacao({ kind: 'triple', todosHeadshot: true })).toEqual({ base: 60, kind: 'triple', bonusHeadshot: 20, total: 80 })
  })
})
