import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AuthProvider } from '../auth/AuthContext.jsx'
import Tour from '../pages/Tour.jsx'

// jogador autenticado, com grupo (a rota /tour exige grupoAtivoId), tour ainda não
// concluído — é o estado em que a página Tour normalmente é montada.
const JOGADOR = {
  steamId: '765',
  nick: 'fih',
  avatarUrl: null,
  isSuperAdmin: false,
  grupoAtivoId: 'g1',
  tourConcluido: false,
  faceitNick: null,
}

// concluir() troca window.location.href por uma navegação real (não usa react-router),
// então window.location precisa ser substituível pra o teste conseguir observar o
// destino sem navegar de verdade (o que quebraria o jsdom).
function stubLocation() {
  const original = window.location
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...original, href: '' },
  })
  return () => Object.defineProperty(window, 'location', { writable: true, value: original })
}

// `tourConcluidoResult` é uma factory (não uma Promise pronta): criar a Promise
// rejeitada só na hora do fetch, já encadeada com o .catch() do Tour.jsx, evita um
// "unhandled promise rejection" no console entre o render e o clique que a consome
// (o que quebraria a exigência de saída limpa nos testes).
function mockFetch(tourConcluidoResult) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url, options) => {
      if (typeof url === 'string' && url.includes('/api/auth/me')) {
        return Promise.resolve({ ok: true, json: async () => JOGADOR })
      }
      if (typeof url === 'string' && url.includes('/api/players/me/tour-concluido') && options?.method === 'PUT') {
        return tourConcluidoResult()
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }),
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('Tour', () => {
  it('concluir com sucesso: navega pro passo final e redireciona pra "/" ao clicar em Concluir', async () => {
    mockFetch(() => Promise.resolve({ ok: true }))
    const restoreLocation = stubLocation()

    render(
      <AuthProvider>
        <Tour />
      </AuthProvider>,
    )

    expect(await screen.findByText('Bem-vindo ao Resenha')).toBeInTheDocument()

    // Passo 0 -> 3 via "Próximo" (o mesmo caminho que um usuário real percorre).
    fireEvent.click(await screen.findByRole('button', { name: 'Próximo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Próximo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Próximo' }))

    expect(await screen.findByText('Onde achar cada coisa')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))

    await vi.waitFor(() => expect(window.location.href).toBe('/'))
    expect(screen.queryByText(/erro ao concluir o tour/i)).not.toBeInTheDocument()

    restoreLocation()
  })

  it('concluir com falha: mostra mensagem de erro e não redireciona (via "Pular tour")', async () => {
    mockFetch(() => Promise.resolve({ ok: false }))
    const restoreLocation = stubLocation()

    render(
      <AuthProvider>
        <Tour />
      </AuthProvider>,
    )

    expect(await screen.findByText('Bem-vindo ao Resenha')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /pular tour/i }))

    expect(await screen.findByText('Erro ao concluir o tour. Tente novamente.')).toBeInTheDocument()
    expect(window.location.href).toBe('')

    restoreLocation()
  })

  it('concluir com falha de rede (fetch rejeita): mostra a mesma mensagem de erro', async () => {
    mockFetch(() => Promise.reject(new Error('network down')))
    const restoreLocation = stubLocation()

    render(
      <AuthProvider>
        <Tour />
      </AuthProvider>,
    )

    expect(await screen.findByText('Bem-vindo ao Resenha')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /pular tour/i }))

    expect(await screen.findByText('Erro ao concluir o tour. Tente novamente.')).toBeInTheDocument()
    expect(window.location.href).toBe('')

    restoreLocation()
  })
})
