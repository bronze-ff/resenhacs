import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ReplayViewer from '../components/ReplayViewer.jsx'

const REPLAY = {
  map: 'de_mirage', calibrated: true, tickRate: 8, names: {},
  rounds: [{ round: 5, frames: [{ t: 0, players: [] }, { t: 1, players: [] }], kills: [], hits: [] }],
}

describe('ReplayViewer — Levar pro quadro', () => {
  it('com matchId: link pro quadro com partida, round e tick atual', () => {
    render(<MemoryRouter><ReplayViewer replay={REPLAY} seek={null} matchId="m-1" /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Levar pro quadro' })).toHaveAttribute('href', '/quadro?partida=m-1&round=5&tick=0')
  })

  it('sem matchId (demo pública): sem botão', () => {
    render(<MemoryRouter><ReplayViewer replay={REPLAY} seek={null} /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: 'Levar pro quadro' })).not.toBeInTheDocument()
  })
})
