import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Clipes from '../pages/Clipes.jsx'

const RESPOSTA = {
  clipes: [{
    id: 'c1', matchId: 'm1', steamId: '111', nick: 'bronze', avatarUrl: null,
    clipUrl: 'https://allstar.gg/clip/1', clipSnapshotUrl: null,
    kind: 'ace', roundNumber: 5, map: 'de_mirage', playedAt: '2026-07-20T00:00:00Z',
    pontuacao: { base: 100, kind: 'ace', bonusHeadshot: 20, total: 120 },
  }],
  leaderboard: [{ steamId: '111', nick: 'bronze', avatarUrl: null, clipes: 1, melhorPontuacao: 120 }],
}

describe('Clipes', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPOSTA })
  })

  it('mostra o clipe com a pontuação e o leaderboard', async () => {
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('bronze').length).toBeGreaterThan(0))
    // '120' aparece tanto no leaderboard (melhor pontuação) quanto no card do clipe — comportamento esperado.
    expect(screen.getAllByText('120').length).toBeGreaterThan(0)
  })

  it('troca de período dispara novo fetch com o query param certo', async () => {
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/clipes?periodo=sempre'))
    screen.getByText('Semana').click()
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/clipes?periodo=semana'))
  })
})
