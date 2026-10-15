import { describe, it, expect } from 'vitest'
import { pontosFortes } from '../src/pontosFortes.js'

function jogador(steamId, campos = {}) {
  return {
    steam_id64: steamId, partidas: 10, dano: '16000', rounds: '200', kills: '150', hs: '60',
    tiros: '2000', tiros_acertados: '500', kast: '70', util: '1000', entry_kills: '10', entry_deaths: '10',
    clutch: '2', flash_assists: '10', ...campos,
  }
}

describe('pontosFortes', () => {
  it('põe primeiro o stat em que o jogador está acima de todo o grupo', () => {
    const linhas = [
      jogador('eu', { util: '3000' }),
      jogador('a'), jogador('b'), jogador('c', { util: '500' }),
    ]
    const r = pontosFortes(linhas, 'eu')
    expect(r[0]).toMatchObject({ chave: 'utilitaria', percentil: 100, valor: 300 })
    expect(r[0].mediaGrupo).toBeCloseTo(137.5)
    expect(r).toHaveLength(4)
  })

  it('não calcula com menos de 3 jogadores no grupo', () => {
    expect(pontosFortes([jogador('eu'), jogador('a')], 'eu')).toEqual([])
  })

  it('jogador sem partidas na janela não tem pontos fortes', () => {
    expect(pontosFortes([jogador('a'), jogador('b'), jogador('c')], 'eu')).toEqual([])
  })

  it('pula stat que não dá pra calcular (sem tiros, sem duelos de entrada)', () => {
    const linhas = [
      jogador('eu', { tiros: '0', entry_kills: '0', entry_deaths: '0' }),
      jogador('a', { tiros: '0', entry_kills: '0', entry_deaths: '0' }),
      jogador('b', { tiros: '0', entry_kills: '0', entry_deaths: '0' }),
    ]
    const chaves = pontosFortes(linhas, 'eu', { quantos: 10 }).map((p) => p.chave)
    expect(chaves).not.toContain('precisao')
    expect(chaves).not.toContain('entrada')
  })
})
