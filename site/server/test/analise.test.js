import { describe, it, expect } from 'vitest'
import { calcularEstilos, calcularBadges, melhorSequenciaDeVitorias } from '../src/analise.js'

describe('calcularEstilos', () => {
  it('classifica quem se destaca numa dimensão em relação à média do grupo', () => {
    const jogadores = [
      { steamId: 'entry', partidas: 10, entryRate: 0.5, utilityPerRound: 5, clutchPct: 20, clutchAttempts: 3, accuracy: 20 },
      { steamId: 'suporte', partidas: 10, entryRate: 0.1, utilityPerRound: 20, clutchPct: 20, clutchAttempts: 3, accuracy: 20 },
      { steamId: 'mediano', partidas: 10, entryRate: 0.1, utilityPerRound: 5, clutchPct: 20, clutchAttempts: 3, accuracy: 20 },
    ]
    const out = calcularEstilos(jogadores)
    expect(out.entry).toMatchObject({ tag: 'entry', label: 'Entry Fragger' })
    expect(out.suporte).toMatchObject({ tag: 'suporte', label: 'Suporte' })
  })

  it('menos de 3 partidas: null (sem classificação prematura)', () => {
    const out = calcularEstilos([{ steamId: 'novo', partidas: 1, entryRate: 10, utilityPerRound: 0, clutchPct: 0, clutchAttempts: 0, accuracy: 0 }])
    expect(out.novo).toBeNull()
  })

  it('sem destaque em nada: cai pra Rifler', () => {
    const jogadores = [
      { steamId: 'a', partidas: 5, entryRate: 0.2, utilityPerRound: 5, clutchPct: 10, clutchAttempts: 3, accuracy: 20 },
      { steamId: 'b', partidas: 5, entryRate: 0.2, utilityPerRound: 5, clutchPct: 10, clutchAttempts: 3, accuracy: 20 },
    ]
    const out = calcularEstilos(jogadores)
    expect(out.a).toMatchObject({ tag: 'rifler', label: 'Rifler' })
  })

  it('clutch só conta com 3+ tentativas (evita 1 sorte virar "estilo")', () => {
    const jogadores = [
      { steamId: 'sortudo', partidas: 5, entryRate: 0.2, utilityPerRound: 5, clutchPct: 100, clutchAttempts: 1, accuracy: 20 },
      { steamId: 'b', partidas: 5, entryRate: 0.2, utilityPerRound: 5, clutchPct: 10, clutchAttempts: 3, accuracy: 20 },
    ]
    const out = calcularEstilos(jogadores)
    expect(out.sortudo.tag).not.toBe('clutch')
  })
})

describe('calcularBadges', () => {
  it('devolve só os badges cujo critério bate', () => {
    const badges = calcularBadges({ aces: 2, clutchWins: 1, melhorSequencia: 3, accuracy: 22, entryKills: 5, partidas: 10 })
    const tags = badges.map((b) => b.tag)
    expect(tags).toEqual(['primeiro_ace', 'primeiro_clutch'])
  })

  it('zerado: nenhum badge', () => {
    expect(calcularBadges({ aces: 0, clutchWins: 0, melhorSequencia: 0, accuracy: 0, entryKills: 0, partidas: 0 })).toEqual([])
  })

  it('veterano e centurião empilham (100 partidas também é 50+)', () => {
    const tags = calcularBadges({ aces: 0, clutchWins: 0, melhorSequencia: 0, accuracy: 0, entryKills: 0, partidas: 100 }).map((b) => b.tag)
    expect(tags).toEqual(expect.arrayContaining(['veterano', 'centuriao']))
  })
})

describe('melhorSequenciaDeVitorias', () => {
  it('acha a maior sequência, ignorando quebras por derrota ou empate', () => {
    expect(melhorSequenciaDeVitorias([true, true, false, true, true, true, false, true])).toBe(3)
  })

  it('empate (null) quebra a sequência sem contar como derrota', () => {
    expect(melhorSequenciaDeVitorias([true, true, null, true])).toBe(2)
  })

  it('vazio ou sem vitória nenhuma: 0', () => {
    expect(melhorSequenciaDeVitorias([])).toBe(0)
    expect(melhorSequenciaDeVitorias([false, false, null])).toBe(0)
  })
})
