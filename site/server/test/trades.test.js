import { describe, it, expect } from 'vitest'
import { calcularDuelos, somarDuelos, JANELA_TROCA_TICKS, TICKRATE } from '../src/trades.js'

// Time A: a1, a2. Time B: b1, b2. Round 1: A é CT. Round 2: A é T.
const players = [
  { steamId: 'a1', team: 'A' },
  { steamId: 'a2', team: 'A' },
  { steamId: 'b1', team: 'B' },
  { steamId: 'b2', team: 'B' },
]
const rounds = [
  { roundNumber: 1, sideA: 'CT' },
  { roundNumber: 2, sideA: 'T' },
]
const k = (roundNumber, tick, killer, victim, extra = {}) => ({ roundNumber, tick, killer, victim, ...extra })

describe('calcularDuelos', () => {
  it('janela de troca é 5 s a 64 tick', () => {
    expect(TICKRATE).toBe(64)
    expect(JANELA_TROCA_TICKS).toBe(320)
  })

  it('primeiro duelo do round é a primeira kill por tick, não pela ordem da lista', () => {
    const r = calcularDuelos({
      players,
      rounds,
      kills: [k(1, 900, 'a2', 'b2'), k(1, 100, 'b1', 'a1')],
    })
    expect(r.b1.aberturas).toBe(1)
    expect(r.b1.aberturasGanhas).toBe(1)
    expect(r.a1.aberturasPerdidas).toBe(1)
    expect(r.a2.aberturas).toBe(0)
    // b1 é do time B; no round 1 A é CT, então B é T.
    expect(r.b1.porLado.T).toEqual({ aberturas: 1, aberturasGanhas: 1 })
    expect(r.a1.porLado.CT).toEqual({ aberturas: 1, aberturasGanhas: 0 })
  })

  it('um duelo de abertura por round', () => {
    const r = calcularDuelos({
      players,
      rounds,
      kills: [k(1, 100, 'a1', 'b1'), k(1, 200, 'a1', 'b2'), k(2, 50, 'a1', 'b1')],
    })
    expect(r.a1.aberturas).toBe(2)
    expect(r.a1.aberturasGanhas).toBe(2)
    expect(r.a1.porLado.CT.aberturasGanhas).toBe(1)
    expect(r.a1.porLado.T.aberturasGanhas).toBe(1)
  })

  it('troca dentro da janela: morte trocada para a vítima e troca feita para quem vingou', () => {
    const r = calcularDuelos({
      players,
      rounds,
      kills: [k(1, 1000, 'b1', 'a1'), k(1, 1000 + JANELA_TROCA_TICKS, 'a2', 'b1')],
    })
    expect(r.a1.mortes).toBe(1)
    expect(r.a1.mortesTrocadas).toBe(1)
    expect(r.a1.mortesSemTroca).toBe(0)
    expect(r.a2.trocasFeitas).toBe(1)
    // A morte de b1 ninguém trocou.
    expect(r.b1.mortesSemTroca).toBe(1)
  })

  it('troca fora da janela não conta', () => {
    const r = calcularDuelos({
      players,
      rounds,
      kills: [k(1, 1000, 'b1', 'a1'), k(1, 1000 + JANELA_TROCA_TICKS + 1, 'a2', 'b1')],
    })
    expect(r.a1.mortesTrocadas).toBe(0)
    expect(r.a1.mortesSemTroca).toBe(1)
    expect(r.a2.trocasFeitas).toBe(0)
  })

  it('troca não atravessa round', () => {
    const r = calcularDuelos({
      players,
      rounds,
      kills: [k(1, 1000, 'b1', 'a1'), k(2, 1010, 'a2', 'b1')],
    })
    expect(r.a1.mortesTrocadas).toBe(0)
  })

  it('matar outro inimigo que não o killer não é troca', () => {
    const r = calcularDuelos({
      players,
      rounds,
      kills: [k(1, 1000, 'b1', 'a1'), k(1, 1100, 'a2', 'b2')],
    })
    expect(r.a1.mortesTrocadas).toBe(0)
    expect(r.a2.trocasFeitas).toBe(0)
  })

  it('team-kill é ignorado: não abre round, não é morte e não é troca', () => {
    const r = calcularDuelos({
      players,
      rounds,
      kills: [
        k(1, 50, 'a1', 'a2', { isTeamKill: true }),
        k(1, 60, 'b1', 'b2'), // mesmo time sem flag (partida antes da coluna): ignorado também
        k(1, 100, 'b1', 'a1'),
      ],
    })
    expect(r.a2.mortes).toBe(0)
    expect(r.b2.mortes).toBe(0)
    expect(r.a1.aberturasPerdidas).toBe(1)
    expect(r.b1.aberturasGanhas).toBe(1)
  })

  it('morte sem killer (queda/bomba) não conta', () => {
    const r = calcularDuelos({ players, rounds, kills: [k(1, 10, null, 'a1'), k(1, 20, 'a2', 'b1')] })
    expect(r.a1.mortes).toBe(0)
    expect(r.a2.aberturasGanhas).toBe(1)
  })

  it('round sem side_a conta no total mas não por lado', () => {
    const r = calcularDuelos({ players, rounds: [], kills: [k(5, 10, 'a1', 'b1')] })
    expect(r.a1.aberturasGanhas).toBe(1)
    expect(r.a1.porLado.CT.aberturas + r.a1.porLado.T.aberturas).toBe(0)
  })
})

describe('somarDuelos', () => {
  it('soma partidas e calcula porcentagens; sem amostra vira null', () => {
    const p1 = calcularDuelos({ players, rounds, kills: [k(1, 100, 'a1', 'b1'), k(1, 200, 'b2', 'a1'), k(1, 300, 'a2', 'b2')] })
    const p2 = calcularDuelos({ players, rounds, kills: [k(2, 100, 'b1', 'a1')] })
    const t = somarDuelos([p1.a1, p2.a1, undefined])
    expect(t.aberturas).toBe(2)
    expect(t.aberturasGanhas).toBe(1)
    expect(t.aberturasPct).toBe(50)
    expect(t.mortes).toBe(2)
    expect(t.mortesTrocadas).toBe(1)
    expect(t.mortesTrocadasPct).toBe(50)
    expect(t.porLado.CT.pct).toBe(100)
    expect(t.porLado.T.pct).toBe(0)
    expect(somarDuelos([]).aberturasPct).toBeNull()
  })
})
