import { describe, it, expect } from 'vitest'
import { montarPassos } from '../components/inicio/PrimeirosPassos.jsx'
import { filtrarResultados } from '../components/BuscaRapida.jsx'

describe('montarPassos', () => {
  it('marca o que já está feito e deixa a FACEIT como opcional', () => {
    const passos = montarPassos({ amigos: 0, codigoHistorico: true, faceit: false, partidas: 0 })
    expect(passos.map((p) => [p.id, p.feito])).toEqual([
      ['steam', true], ['amigos', false], ['codigo', true], ['faceit', false],
    ])
    expect(passos.find((p) => p.id === 'faceit').obrigatorio).toBe(false)
  })
})

describe('filtrarResultados', () => {
  const base = {
    telas: [{ to: '/mapas', label: 'Mapas', grupo: 'Eu' }, { to: '/ranking', label: 'Ranking', grupo: 'Grupo' }],
    jogadores: [{ steamId: '1', nick: 'Toguro' }, { steamId: '2', nick: 'Paçoca' }],
    partidas: [{ id: 'm1', map: 'de_mirage', playedAt: null }],
  }

  it('sem termo mostra só as telas', () => {
    expect(filtrarResultados(base, '').map((r) => r.tipo)).toEqual(['Telas', 'Telas'])
  })

  it('acha jogador ignorando acento e caixa, e partida pelo nome do mapa', () => {
    expect(filtrarResultados(base, 'pacoca').map((r) => r.para)).toEqual(['/jogador/2'])
    expect(filtrarResultados(base, 'mirage').map((r) => r.para)).toEqual(['/partida/m1'])
  })
})
