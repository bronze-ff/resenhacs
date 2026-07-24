// site/client/src/test/Clipes.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Clipes from '../pages/Clipes.jsx'

const RESPOSTA = {
  clipes: [{
    id: 'c1', matchId: 'm1', steamId: '111', nick: 'bronze', avatarUrl: null,
    clipUrl: 'https://allstar.gg/clip/1', clipSnapshotUrl: null,
    kind: 'ace', roundNumber: 5, map: 'de_mirage', playedAt: '2026-07-20T00:00:00Z',
    pontuacao: { kills: 5, pontosKills: 120, headshots: 3, pontosHeadshots: 24, clutch: null, pontosClutch: 0, armas: 2, pontosArmas: 10, total: 154 },
  }],
}

const RESPOSTA_DOIS_JOGADORES = {
  clipes: [
    {
      id: 'c1', matchId: 'm1', steamId: '111', nick: 'bronze', avatarUrl: null,
      clipUrl: 'https://allstar.gg/clip/1', clipSnapshotUrl: null,
      kind: 'ace', roundNumber: 5, map: 'de_mirage', playedAt: '2026-07-20T00:00:00Z',
      pontuacao: { kills: 5, pontosKills: 120, headshots: 3, pontosHeadshots: 24, clutch: null, pontosClutch: 0, armas: 2, pontosArmas: 10, total: 154 },
    },
    {
      id: 'c2', matchId: 'm2', steamId: '222', nick: 'troya', avatarUrl: null,
      clipUrl: 'https://allstar.gg/clip/2', clipSnapshotUrl: null,
      kind: 'quad', roundNumber: 9, map: 'de_inferno', playedAt: '2026-07-21T00:00:00Z',
      pontuacao: { kills: 4, pontosKills: 80, headshots: 1, pontosHeadshots: 8, clutch: null, pontosClutch: 0, armas: 1, pontosArmas: 5, total: 93 },
    },
  ],
}

describe('Clipes', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPOSTA })
  })

  it('mostra o clipe com a pontuacao total', async () => {
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('bronze').length).toBeGreaterThan(0))
    expect(screen.getByText('154')).toBeInTheDocument()
  })

  it('nao mostra nenhuma secao de Leaderboard (saiu pra dentro de Competicoes)', async () => {
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('bronze').length).toBeGreaterThan(0))
    expect(screen.queryByText(/leaderboard/i)).not.toBeInTheDocument()
  })

  it('clipe sem kind (gerado por jogador, sem highlight nosso batendo o round) mostra fallback "MOMENTO" sem quebrar', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        clipes: [{
          id: 'c2', matchId: 'm1', steamId: '222', nick: 'outro', avatarUrl: null,
          clipUrl: 'https://allstar.gg/clip/2', clipSnapshotUrl: null,
          kind: null, roundNumber: 9, map: 'de_dust2', playedAt: '2026-07-21T00:00:00Z',
          pontuacao: { kills: 1, pontosKills: 10, headshots: 0, pontosHeadshots: 0, clutch: null, pontosClutch: 0, armas: 1, pontosArmas: 5, total: 15 },
        }],
      }),
    })
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('MOMENTO')).toBeInTheDocument())
  })

  it('troca de periodo dispara novo fetch com o query param certo', async () => {
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/clipes?periodo=sempre'))
    screen.getByText('Semana').click()
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/clipes?periodo=semana'))
  })

  it('deep link ?jogador= chega com a lista ja filtrada nesse jogador', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPOSTA_DOIS_JOGADORES })
    const { container } = render(
      <MemoryRouter initialEntries={['/clipes?jogador=222']}>
        <Clipes />
      </MemoryRouter>,
    )
    // O Select (design system) mostra o valor selecionado como rotulo do proprio
    // trigger fechado, entao "troya" tambem aparece fora da grade de clipes — escopar
    // em <section> (a grade) evita colidir com esse texto do dropdown.
    let grade
    await waitFor(() => {
      grade = container.querySelector('section')
      expect(grade).toBeTruthy()
      expect(within(grade).getByText('troya')).toBeInTheDocument()
    })
    expect(within(grade).queryByText('bronze')).not.toBeInTheDocument()
  })

  it('filtro "Todos" (default) mostra clipes de todo mundo', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPOSTA_DOIS_JOGADORES })
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('troya')).toBeInTheDocument())
    expect(screen.getByText('bronze')).toBeInTheDocument()
  })

  it('deep link pra jogador sem clipe mostra estado vazio especifico', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPOSTA_DOIS_JOGADORES })
    render(
      <MemoryRouter initialEntries={['/clipes?jogador=999']}>
        <Clipes />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText(/nenhum clipe desse jogador/i)).toBeInTheDocument())
  })

  it('deep link pra jogador sem clipe (id nao aparece nas opcoes) nao deixa o trigger do filtro em branco', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPOSTA_DOIS_JOGADORES })
    render(
      <MemoryRouter initialEntries={['/clipes?jogador=999']}>
        <Clipes />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText(/nenhum clipe desse jogador/i)).toBeInTheDocument())
    // "999" nao aparece em mais nenhum lugar da tela nesse cenario (nenhum clipe
    // carregado desse jogador), entao o rotulo sintetico do trigger do Select
    // ("Jogador 999") e a unica ocorrencia — sem precisar escopar com within().
    expect(screen.getByRole('button', { name: /jogador 999/i })).toBeInTheDocument()
  })

  it('clipe com pontuacao_detalhe nulo (fallback so com total) mostra tooltip sem "undefined"', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        clipes: [{
          id: 'c3', matchId: 'm3', steamId: '333', nick: 'semdetalhe', avatarUrl: null,
          clipUrl: 'https://allstar.gg/clip/3', clipSnapshotUrl: null,
          kind: 'triple', roundNumber: 12, map: 'de_ancient', playedAt: '2026-07-22T00:00:00Z',
          pontuacao: { total: 80 },
        }],
      }),
    })
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('80')).toBeInTheDocument())
    const elementoPontuacao = screen.getByText('80')
    expect(elementoPontuacao).toHaveAttribute('title', '80')
    expect(elementoPontuacao.getAttribute('title')).not.toMatch(/undefined/)
  })

  it('card mostra a partida (mapa + dia/hora) como link pra pagina da partida', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPOSTA })
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('bronze').length).toBeGreaterThan(0))
    const linkPartida = screen.getByRole('link', { name: /ver partida/i })
    expect(linkPartida).toHaveAttribute('href', '/partida/m1')
    // Assertion adjusted to account for timezone (UTC mock converts to Brazil local time).
    // Assert stable parts: href, map name, and presence of date/time format.
    expect(linkPartida.textContent).toContain('Ver partida')
    expect(linkPartida.textContent).toContain('Mirage')
    expect(linkPartida.textContent).toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })
})
