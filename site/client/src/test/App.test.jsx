import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../App.jsx'

function mockMe(response) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url) => {
      // Feed busca /api/matches e /api/sessions; devolvemos lista vazia pros dois.
      // /api/auth/me devolve o jogador. Sem esses dois casos, cai no fallback abaixo
      // e o componente Resenhas recebe o objeto do jogador como "sessoes" e quebra.
      if (typeof url === 'string' && (url.includes('/api/matches') || url.includes('/api/sessions') || url.includes('/api/groups/meus'))) {
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      return Promise.resolve({
        ok: response !== null,
        json: async () => response ?? { erro: 'Não autenticado' },
      })
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
    mockMe({ steamId: '765', nick: 'fih', avatarUrl: null, isSuperAdmin: false, tourConcluido: true })
    render(<App />)
    expect(await screen.findByText('fih')).toBeInTheDocument()
    // /api/matches é um fetch separado do /api/auth/me (que resolveu findByText acima);
    // precisa de findByText (assíncrono) aqui também, senão às vezes ainda não resolveu.
    expect(await screen.findByText(/nenhuma partida/i)).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /ajuda/i })).toHaveAttribute('href', '/tour')
    expect(await screen.findByRole('link', { name: /apoie/i })).toHaveAttribute('href', '/apoie')
    expect(await screen.findByRole('link', { name: 'fih' })).toHaveAttribute('href', '/jogador/765')
  })

  it('logado com grupo mas tour nao concluido: redireciona pro tour', async () => {
    mockMe({ steamId: '765', nick: 'fih', avatarUrl: null, isSuperAdmin: false, tourConcluido: false })
    render(<App />)
    expect(await screen.findByText('Bem-vindo ao Resenha')).toBeInTheDocument()
    expect(await screen.findByText(/pular tour/i)).toBeInTheDocument()
  })
})
