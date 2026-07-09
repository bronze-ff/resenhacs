import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../App.jsx'

function mockMe(response) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: response !== null,
      json: async () => response ?? { erro: 'Não autenticado' },
    }),
  )
}

// jsdom compartilha window.history entre testes do mesmo arquivo, e o <Navigate replace>
// do teste "sem login" deixa a URL em /entrar. Sem resetar, o BrowserRouter do teste
// seguinte renderiza a página errada e o teste falha por engano.
beforeEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('App', () => {
  it('sem login: mostra a tela de entrar com link para a Steam', async () => {
    mockMe(null)
    render(<App />)
    const link = await screen.findByRole('link', { name: /entrar com steam/i })
    expect(link).toHaveAttribute('href', '/api/auth/steam')
  })

  it('logado: mostra o shell com o nick do jogador', async () => {
    mockMe({ steamId: '765', nick: 'fih', avatarUrl: null, isAdmin: false })
    render(<App />)
    expect(await screen.findByText('fih')).toBeInTheDocument()
    expect(screen.getByText(/nenhuma partida/i)).toBeInTheDocument()
  })
})
