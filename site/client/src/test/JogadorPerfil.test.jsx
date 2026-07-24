// site/client/src/test/JogadorPerfil.test.jsx
// Escopo deliberadamente mínimo: só a seção de Clipes (a página não tinha teste antes).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import JogadorPerfil from '../pages/JogadorPerfil.jsx'

const PERFIL_BASE = {
  jogador: { steamId: '765', nick: 'bronze', avatarUrl: null, faceitNick: null, faceitElo: null, faceitSkillLevel: null },
  premierAtual: null,
  stats: {
    partidas: 10, vitorias: 5, kills: 100, deaths: 90, assists: 30, hs: 40,
    rating: 1.01, kd: 1.11, adr: 80, hsPct: 40, winrate: 50,
    utilityDamage: 100, accuracy: 20, entryKills: 5, entryDeaths: 3, entryWins: 4,
    tradeKills: 6, tradedDeaths: 2, clutchWins: 1, clutchAttempts: 4, aces: 1,
    flashAssists: 2, enemiesFlashed: 10, teamKills: 0, rounds: 200,
  },
  evolucao: [], badges: [], estilo: null, armas: [], economia: null,
  destaques: [], porMapa: [], recentes: [], sinergia: [],
  clipes: [],
}

function renderPerfil(payload) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload })
  return render(
    <MemoryRouter initialEntries={['/jogador/765']}>
      <Routes>
        <Route path="/jogador/:steamId" element={<JogadorPerfil />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { vi.restoreAllMocks() })

describe('JogadorPerfil — seção Clipes', () => {
  it('mostra a seção com o clipe e o link "Ver todos" filtrado no jogador', async () => {
    renderPerfil({
      ...PERFIL_BASE,
      clipes: [{
        id: 'c1', matchId: 'm1', steamId: '765', nick: 'bronze', avatarUrl: null,
        clipUrl: 'https://allstar.gg/clip/1', clipSnapshotUrl: null,
        kind: 'ace', roundNumber: 5, map: 'de_mirage', playedAt: '2026-07-20T00:00:00Z',
        pontuacao: { kills: 5, pontosKills: 120, headshots: 3, pontosHeadshots: 24, clutch: null, pontosClutch: 0, armas: 2, pontosArmas: 10, total: 154 },
      }],
    })
    await waitFor(() => expect(screen.getByText('154')).toBeInTheDocument())
    expect(screen.getByText('ACE')).toBeInTheDocument()
    const verTodos = screen.getByRole('link', { name: /ver todos/i })
    expect(verTodos).toHaveAttribute('href', '/clipes?jogador=765')
  })

  it('sem clipes: seção não aparece', async () => {
    renderPerfil(PERFIL_BASE)
    await waitFor(() => expect(screen.getAllByText(/bronze/i).length).toBeGreaterThan(0))
    expect(screen.queryByRole('link', { name: /ver todos/i })).not.toBeInTheDocument()
  })
})
