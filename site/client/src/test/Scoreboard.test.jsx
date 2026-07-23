import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Scoreboard } from '../pages/Partida.jsx'

function renderComRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

const JOGADORES = [
  { steamId: 'A1', nick: 'fih', team: 'A', kills: 20, deaths: 10, assists: 3, headshotKills: 10, damage: 2000, roundsPlayed: 20, kastPct: 80, rating: 1.5, isTracked: true, weapons: [] },
  { steamId: 'A2', nick: 'bronze', team: 'A', kills: 5, deaths: 15, assists: 1, headshotKills: 1, damage: 900, roundsPlayed: 20, kastPct: 50, rating: 0.7, isTracked: true, weapons: [] },
]

describe('Scoreboard — estrela no melhor stat da partida', () => {
  it('marca com estrela quem bate o melhor valor de cada coluna', () => {
    const melhores = { kills: 20, assists: 3, hsPct: 50, adr: 100, kastPct: 80, rating: 1.5 }
    renderComRouter(<Scoreboard time="A" jogadores={JOGADORES} matchId="m1" melhores={melhores} carregando={false} />)
    // fih bate o melhor nas 6 colunas: kills(20)/assists(3)/hs(10/20=50%)/adr(2000/20=100)/kast(80)/rating(1.5).
    const linhaFih = screen.getByText('fih').closest('tr')
    expect(linhaFih.querySelectorAll('[title="Melhor da partida"]')).toHaveLength(6)
    // bronze não bate nenhum melhor -> 0 estrelas.
    const linhaBronze = screen.getByText('bronze').closest('tr')
    expect(linhaBronze.querySelectorAll('[title="Melhor da partida"]')).toHaveLength(0)
  })

  it('sem melhores (filtro all sem estatísticas cross-time carregadas): não quebra, sem estrelas', () => {
    renderComRouter(<Scoreboard time="A" jogadores={JOGADORES} matchId="m1" carregando={false} />)
    expect(screen.queryAllByTitle('Melhor da partida')).toHaveLength(0)
  })

  it('carregando: aplica opacidade reduzida no container', () => {
    const { container } = renderComRouter(<Scoreboard time="A" jogadores={JOGADORES} matchId="m1" carregando />)
    expect(container.querySelector('.opacity-50')).toBeTruthy()
  })
})
