// site/client/src/test/Feed.test.jsx
// Escopo mínimo: o filtro por jogador (era "MVP", virou participação — a semântica e o
// rótulo confundiam quem escolhia o próprio nick esperando ver as partidas em que jogou).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Feed from '../pages/Feed.jsx'

let urls
function mockFetch() {
  urls = []
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
    urls.push(String(url))
    if (String(url).includes('/api/players')) {
      return Promise.resolve({ ok: true, json: async () => [{ steamId: '76561198000000009', nick: 'bronze' }] })
    }
    // /api/matches, /api/sessions, /api/matches/sync-status — listas vazias bastam
    return Promise.resolve({ ok: true, json: async () => [] })
  }))
}

beforeEach(mockFetch)
afterEach(() => { vi.unstubAllGlobals() })

describe('Feed — filtro por jogador', () => {
  it('dropdown rotulado "Todos os jogadores" (não MVPs) e filtra por participacao via ?jogador=', async () => {
    render(<MemoryRouter><Feed /></MemoryRouter>)
    // Select customizado do design system: trigger é um botão mostrando o label da
    // opção selecionada; escolher = clicar no trigger e depois na role=option.
    const trigger = await screen.findByText('Todos os jogadores')
    expect(screen.queryByText(/todos os mvps/i)).not.toBeInTheDocument()
    fireEvent.click(trigger)
    const opcao = await screen.findByRole('option', { name: /bronze/i })
    fireEvent.click(opcao)
    await waitFor(() => {
      expect(urls.some((u) => u.includes('/api/matches?') && u.includes('jogador=76561198000000009'))).toBe(true)
    })
    // e nunca o param antigo
    expect(urls.some((u) => u.includes('mvp='))).toBe(false)
  })
})

describe('Feed — filtro por plataforma', () => {
  it('dropdown "Todas as plataformas" filtra via ?plataforma= (ex.: Gamers Club)', async () => {
    render(<MemoryRouter><Feed /></MemoryRouter>)
    const trigger = await screen.findByText('Todas as plataformas')
    fireEvent.click(trigger)
    const opcao = await screen.findByRole('option', { name: /gamers club/i })
    fireEvent.click(opcao)
    await waitFor(() => {
      expect(urls.some((u) => u.includes('/api/matches?') && u.includes('plataforma=gamers_club'))).toBe(true)
    })
  })

  it('oferece Premier, FACEIT, Gamers Club e XPLAY.GG', async () => {
    render(<MemoryRouter><Feed /></MemoryRouter>)
    fireEvent.click(await screen.findByText('Todas as plataformas'))
    for (const nome of [/premier/i, /faceit/i, /gamers club/i, /xplay\.gg/i]) {
      expect(await screen.findByRole('option', { name: nome })).toBeInTheDocument()
    }
  })
})
