// site/server/test/clipesScore.test.js
import { describe, it, expect } from 'vitest'
import { calcularPontuacao } from '../src/clipesScore.js'

describe('calcularPontuacao', () => {
  it('kills: curva nao-linear de 1 a 5', () => {
    expect(calcularPontuacao({ kills: 1, headshots: 0, clutchKind: null, armasDistintas: 1 }).pontosKills).toBe(10)
    expect(calcularPontuacao({ kills: 2, headshots: 0, clutchKind: null, armasDistintas: 1 }).pontosKills).toBe(25)
    expect(calcularPontuacao({ kills: 3, headshots: 0, clutchKind: null, armasDistintas: 1 }).pontosKills).toBe(50)
    expect(calcularPontuacao({ kills: 4, headshots: 0, clutchKind: null, armasDistintas: 1 }).pontosKills).toBe(80)
    expect(calcularPontuacao({ kills: 5, headshots: 0, clutchKind: null, armasDistintas: 1 }).pontosKills).toBe(120)
  })

  it('kills acima de 5 (nao deveria acontecer num round, mas nao quebra) usa o valor de 5', () => {
    expect(calcularPontuacao({ kills: 7, headshots: 0, clutchKind: null, armasDistintas: 1 }).pontosKills).toBe(120)
  })

  it('kills 0 ou ausente nao gera pontos negativos nem NaN', () => {
    expect(calcularPontuacao({ kills: 0, headshots: 0, clutchKind: null, armasDistintas: 0 }).pontosKills).toBe(0)
  })

  it('headshots: +8 por kill que foi headshot', () => {
    const r = calcularPontuacao({ kills: 4, headshots: 3, clutchKind: null, armasDistintas: 1 })
    expect(r.pontosHeadshots).toBe(24)
  })

  it('clutch: bonus por dificuldade 1v1 a 1v5', () => {
    expect(calcularPontuacao({ kills: 1, headshots: 0, clutchKind: '1v1', armasDistintas: 1 }).pontosClutch).toBe(10)
    expect(calcularPontuacao({ kills: 2, headshots: 0, clutchKind: '1v2', armasDistintas: 1 }).pontosClutch).toBe(20)
    expect(calcularPontuacao({ kills: 3, headshots: 0, clutchKind: '1v3', armasDistintas: 1 }).pontosClutch).toBe(35)
    expect(calcularPontuacao({ kills: 4, headshots: 0, clutchKind: '1v4', armasDistintas: 1 }).pontosClutch).toBe(55)
    expect(calcularPontuacao({ kills: 5, headshots: 0, clutchKind: '1v5', armasDistintas: 1 }).pontosClutch).toBe(80)
  })

  it('sem clutch (null): pontosClutch é 0, nao é erro', () => {
    const r = calcularPontuacao({ kills: 3, headshots: 0, clutchKind: null, armasDistintas: 1 })
    expect(r.clutch).toBeNull()
    expect(r.pontosClutch).toBe(0)
  })

  it('kind de clutch desconhecido (defensivo): pontosClutch 0, nao lanca excecao', () => {
    const r = calcularPontuacao({ kills: 1, headshots: 0, clutchKind: '1v9', armasDistintas: 1 })
    expect(r.pontosClutch).toBe(0)
  })

  it('variedade de armas: +5 por arma distinta', () => {
    expect(calcularPontuacao({ kills: 2, headshots: 0, clutchKind: null, armasDistintas: 1 }).pontosArmas).toBe(5)
    expect(calcularPontuacao({ kills: 2, headshots: 0, clutchKind: null, armasDistintas: 2 }).pontosArmas).toBe(10)
  })

  it('total soma todos os componentes, breakdown completo no retorno', () => {
    const r = calcularPontuacao({ kills: 4, headshots: 3, clutchKind: '1v2', armasDistintas: 2 })
    expect(r).toEqual({
      kills: 4, pontosKills: 80,
      headshots: 3, pontosHeadshots: 24,
      clutch: '1v2', pontosClutch: 20,
      armas: 2, pontosArmas: 10,
      total: 134,
    })
  })
})
