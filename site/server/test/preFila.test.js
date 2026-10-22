import { describe, it, expect } from 'vitest'
import { montarPreFila } from '../src/preFila.js'

const jogadores = [{ steamId: '76561198000000001', nick: 'A', avatarUrl: null }]
const mapa = (map, partidas, vitorias, decididas = partidas) => ({ map, partidas, vitorias, decididas })
const dupla = (a, b, partidas, vitorias, decididas = partidas) => ({ a, b, partidas, vitorias, decididas })

describe('montarPreFila', () => {
  it('preserva os jogadores e devolve vazio sem amostra', () => {
    expect(montarPreFila({ jogadores, grupo: [], individual: [], duplas: [] })).toEqual({
      jogadores, mapas: [], melhorDupla: null, piorDupla: null,
    })
  })

  it('prefere grupo com três Partidas, incluindo empates na amostra', () => {
    const r = montarPreFila({ jogadores, grupo: [mapa('de_nuke', 3, 1, 2)], individual: [mapa('de_nuke', 9, 8)], duplas: [] })
    expect(r.mapas).toEqual([{ map: 'de_nuke', partidas: 3, vitorias: 1, winrate: 50, fonte: 'grupo' }])
  })

  it('com duas Partidas do grupo usa a soma individual; sem três individuais omite', () => {
    const r = montarPreFila({ jogadores,
      grupo: [mapa('de_nuke', 2, 2), mapa('de_mirage', 1, 1)],
      individual: [mapa('de_nuke', 4, 2, 3), mapa('de_mirage', 2, 1), mapa('de_dust2', 3, 1)], duplas: [],
    })
    expect(r.mapas).toEqual([
      { map: 'de_nuke', partidas: 4, vitorias: 2, winrate: 66.7, fonte: 'individual' },
      { map: 'de_dust2', partidas: 3, vitorias: 1, winrate: 33.3, fonte: 'individual' },
    ])
  })

  it('ordena por winrate, partidas e mapa, colocando winrate nula no fim', () => {
    const r = montarPreFila({ jogadores, grupo: [
      mapa('de_empates', 9, 0, 0), mapa('de_zero', 3, 0), mapa('de_nuke', 3, 2),
      mapa('de_mirage', 3, 2), mapa('de_inferno', 6, 4), mapa('de_dust2', 3, 3),
    ], individual: [], duplas: [] })
    expect(r.mapas.map(m => m.map)).toEqual(['de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_zero', 'de_empates'])
    expect(r.mapas.at(-1).winrate).toBeNull()
  })

  it('dupla exige três decididas, preserva partidas totais e exclui empates da winrate', () => {
    const r = montarPreFila({ jogadores, grupo: [], individual: [], duplas: [
      dupla('a', 'b', 8, 2, 2), dupla('a', 'c', 5, 2, 3),
    ] })
    expect(r.melhorDupla).toEqual({ a: 'a', b: 'c', partidas: 5, vitorias: 2, winrate: 66.7 })
    expect(r.piorDupla).toBeNull()
  })

  it('melhor e pior usam winrate e desempatam por mais partidas', () => {
    const r = montarPreFila({ jogadores, grupo: [], individual: [], duplas: [
      dupla('a', 'b', 3, 3), dupla('a', 'c', 6, 6),
      dupla('a', 'd', 3, 0), dupla('b', 'c', 4, 0),
    ] })
    expect(r.melhorDupla).toEqual({ a: 'a', b: 'c', partidas: 6, vitorias: 6, winrate: 100 })
    expect(r.piorDupla).toEqual({ a: 'b', b: 'c', partidas: 4, vitorias: 0, winrate: 0 })
  })

  it('sem dupla com amostra ambas são nulas', () => {
    const r = montarPreFila({ jogadores, grupo: [], individual: [], duplas: [dupla('a', 'b', 4, 2, 2)] })
    expect(r.melhorDupla).toBeNull()
    expect(r.piorDupla).toBeNull()
  })

  it('empate de winrate entre todos os pares não rotula uma dupla como pior', () => {
    const r = montarPreFila({ jogadores, grupo: [], individual: [], duplas: [
      dupla('b', 'c', 6, 3), dupla('a', 'c', 6, 3), dupla('a', 'b', 6, 3), dupla('a', 'd', 4, 2),
    ] })
    expect(r.melhorDupla).toEqual({ a: 'a', b: 'b', partidas: 6, vitorias: 3, winrate: 50 })
    expect(r.piorDupla).toBeNull()
  })

  it('no empate da pior usa o par canônico por a e depois b', () => {
    const r = montarPreFila({ jogadores, grupo: [], individual: [], duplas: [
      dupla('a', 'b', 3, 3), dupla('b', 'd', 3, 0), dupla('a', 'd', 3, 0), dupla('a', 'c', 3, 0),
    ] })
    expect(r.piorDupla).toEqual({ a: 'a', b: 'c', partidas: 3, vitorias: 0, winrate: 0 })
    expect(r.piorDupla).not.toEqual(r.melhorDupla)
  })
})
