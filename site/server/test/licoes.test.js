import { describe, expect, it } from 'vitest'
import { calcularLicoes } from '../src/licoes.js'

const jogadores = [
  { steamId: 'eu', team: 'A' },
  { steamId: 'colega', team: 'A' },
  { steamId: 'outroColega', team: 'A' },
  { steamId: 'inimigo', team: 'B' },
  { steamId: 'outroInimigo', team: 'B' },
]
const kill = (roundNumber, tick, killer, victim, isTeamKill = false) => ({ roundNumber, tick, killer, victim, isTeamKill })
const calcular = (kills = [], flashes = []) => calcularLicoes({ steamId: 'eu', jogadores, kills, flashes })
const vazio = {
  mortesSemTrade: { quantidade: 0, rounds: [] },
  primeirasMortes: { quantidade: 0, rounds: [] },
  flashAliado: { vezes: 0, segundos: 0 },
}

describe('calcularLicoes', () => {
  it('devolve tudo zero quando não há nada para rever', () => {
    expect(calcular()).toEqual(vazio)
  })

  it.each([[0, 0], [320, 0], [321, 1]])('trade de outro colega em %i ticks deixa %i mortes sem trade', (delta, quantidade) => {
    const resultado = calcular([
      kill(1, 1000 + delta, 'outroColega', 'inimigo'),
      kill(1, 1000, 'inimigo', 'eu'),
    ])
    expect(resultado.mortesSemTrade).toEqual({
      quantidade, rounds: quantidade ? [{ round: 1, tick: 1000 }] : [],
    })
  })

  it('a morte fica sem trade se a vingança for antes, em outro round ou por outro time', () => {
    const resultado = calcular([
      kill(1, 1000, 'inimigo', 'eu'),
      kill(1, 900, 'colega', 'inimigo'),
      kill(2, 1100, 'outroColega', 'inimigo'),
      kill(1, 1100, 'outroInimigo', 'inimigo'),
    ])
    expect(resultado.mortesSemTrade).toEqual({ quantidade: 1, rounds: [{ round: 1, tick: 1000 }] })
  })

  it('primeira morte usa a menor tick válida de cada round, incluindo empate de tick', () => {
    const resultado = calcular([
      kill(3, 800, 'outroInimigo', 'colega'), kill(3, 800, 'inimigo', 'eu'),
      kill(2, 900, 'inimigo', 'eu'), kill(2, 100, 'outroInimigo', 'colega'),
      kill(1, 500, 'inimigo', 'eu'),
      kill(1, 1, 'colega', 'outroColega', true), kill(1, 2, null, 'outroInimigo'),
      kill(4, 100, null, 'eu'), kill(5, 100, 'colega', 'eu', true),
    ])
    expect(resultado.primeirasMortes).toEqual({ quantidade: 2, rounds: [{ round: 1, tick: 500 }, { round: 3, tick: 800 }] })
    expect(resultado.mortesSemTrade.quantidade).toBe(3)
  })

  it('limita as amostras a cinco rounds ordenados, preservando a quantidade total e a entrada', () => {
    const kills = [7, 4, 2, 6, 1, 5, 3].map((r) => kill(r, r * 100, 'inimigo', 'eu'))
    const entrada = structuredClone(kills)
    const resultado = calcular(kills)
    const esperado = { quantidade: 7, rounds: [
      { round: 1, tick: 100 }, { round: 2, tick: 200 }, { round: 3, tick: 300 },
      { round: 4, tick: 400 }, { round: 5, tick: 500 },
    ] }
    expect(resultado.mortesSemTrade).toEqual(esperado)
    expect(resultado.primeirasMortes).toEqual(esperado)
    expect(kills).toEqual(entrada)
  })

  it('soma flashes só em colegas e arredonda o total de segundos a uma casa', () => {
    const flashes = [
      { attacker: 'eu', victim: 'colega', count: 2, durationSum: 1.24 },
      { attacker: 'eu', victim: 'outroColega', count: 1, durationSum: 0.12 },
      { attacker: 'eu', victim: 'inimigo', count: 10, durationSum: 10 },
      { attacker: 'eu', victim: 'eu', count: 3, durationSum: 3 },
      { attacker: 'colega', victim: 'eu', count: 4, durationSum: 4 },
      { attacker: 'eu', victim: 'ausente', count: 5, durationSum: 5 },
    ]
    expect(calcular([], flashes).flashAliado).toEqual({ vezes: 3, segundos: 1.4 })
  })

  it('team kill não serve como trade e morte sem killer ou por team kill não conta', () => {
    const resultado = calcular([
      kill(1, 100, 'inimigo', 'eu'), kill(1, 110, 'colega', 'inimigo', true),
      kill(2, 100, null, 'eu'), kill(3, 100, 'colega', 'eu', true),
    ])
    expect(resultado.mortesSemTrade).toEqual({ quantidade: 1, rounds: [{ round: 1, tick: 100 }] })
    expect(resultado.primeirasMortes).toEqual({ quantidade: 1, rounds: [{ round: 1, tick: 100 }] })
  })
})
