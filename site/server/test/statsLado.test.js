import { describe, it, expect } from 'vitest'
import { calcularStatsPorLado } from '../src/statsLado.js'

// Partida de 4 rounds: A é CT nos rounds 1-2, T nos rounds 3-4 (troca de lado no
// intervalo, side_a inverte pra time B). A1 mata em todos os 4 rounds; A2 só é
// assistido/morre; B1 mata A2 no round 3.
const PLAYERS = [
  { steamId: 'A1', team: 'A' },
  { steamId: 'A2', team: 'A' },
  { steamId: 'B1', team: 'B' },
]
const ROUNDS = [
  { roundNumber: 1, sideA: 'CT' },
  { roundNumber: 2, sideA: 'CT' },
  { roundNumber: 3, sideA: 'T' },
  { roundNumber: 4, sideA: 'T' },
]
const KILLS = [
  { roundNumber: 1, tick: 100, killer: 'A1', victim: 'B1', assister: null, headshot: true },
  { roundNumber: 2, tick: 100, killer: 'A1', victim: 'B1', assister: 'A2', headshot: false },
  { roundNumber: 3, tick: 100, killer: 'B1', victim: 'A2', assister: null, headshot: false },
  { roundNumber: 4, tick: 100, killer: 'A1', victim: 'B1', assister: null, headshot: false },
]
const ROUND_DAMAGE = [
  { roundNumber: 1, steamId: 'A1', damage: 100 },
  { roundNumber: 2, steamId: 'A1', damage: 80 },
  { roundNumber: 3, steamId: 'A1', damage: 50 },
  { roundNumber: 4, steamId: 'A1', damage: 90 },
]

describe('calcularStatsPorLado', () => {
  it('all: usa todos os 4 rounds', () => {
    const r = calcularStatsPorLado({ players: PLAYERS, rounds: ROUNDS, kills: KILLS, roundDamage: ROUND_DAMAGE, filtro: 'all' })
    expect(r.A1.kills).toBe(3)
    expect(r.A1.roundsPlayed).toBe(4)
    expect(r.A1.damage).toBe(320)
    expect(r.A1.adr).toBe(80)
    expect(r.A2.assists).toBe(1)
  })

  it('CT: A jogou CT nos rounds 1-2 (2 kills, sem mortes)', () => {
    const r = calcularStatsPorLado({ players: PLAYERS, rounds: ROUNDS, kills: KILLS, roundDamage: ROUND_DAMAGE, filtro: 'CT' })
    expect(r.A1.kills).toBe(2)
    expect(r.A1.roundsPlayed).toBe(2)
    expect(r.A1.deaths).toBe(0)
    expect(r.A1.damage).toBe(180)
  })

  it('T: A jogou T nos rounds 3-4 (1 kill, A2 morreu no round 3)', () => {
    const r = calcularStatsPorLado({ players: PLAYERS, rounds: ROUNDS, kills: KILLS, roundDamage: ROUND_DAMAGE, filtro: 'T' })
    expect(r.A1.kills).toBe(1)
    expect(r.A1.roundsPlayed).toBe(2)
    expect(r.A2.deaths).toBe(1)
  })

  it('time B tem o lado INVERTIDO do time A: CT do B = rounds 3-4 (onde side_a é T)', () => {
    const r = calcularStatsPorLado({ players: PLAYERS, rounds: ROUNDS, kills: KILLS, roundDamage: ROUND_DAMAGE, filtro: 'CT' })
    // B1 jogando CT = rounds 3-4 (onde A é T) -> B1 matou A2 no round 3.
    expect(r.B1.kills).toBe(1)
    expect(r.B1.roundsPlayed).toBe(2)
  })

  it('rounds sem side_a (partida não reprocessada): filtro T/CT devolve roundsPlayed 0', () => {
    const roundsSemLado = ROUNDS.map((r) => ({ ...r, sideA: null }))
    const r = calcularStatsPorLado({ players: PLAYERS, rounds: roundsSemLado, kills: KILLS, roundDamage: ROUND_DAMAGE, filtro: 'T' })
    expect(r.A1.roundsPlayed).toBe(0)
    expect(r.A1.adr).toBe(0)
    expect(r.A1.rating).toBe(0)
  })

  it('kast conta kill/assist/sobreviveu/traded dentro do subconjunto de rounds', () => {
    const r = calcularStatsPorLado({ players: PLAYERS, rounds: ROUNDS, kills: KILLS, roundDamage: ROUND_DAMAGE, filtro: 'all' })
    // A1: matou em todos os 4 rounds -> KAST 100%.
    expect(r.A1.kastPct).toBe(100)
    // A2: assistiu no round 2, morreu no round 3 (sem kill/assist/trade lá), sobreviveu 1 e 4 -> 3/4 = 75%.
    expect(r.A2.kastPct).toBe(75)
  })
})
