import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthContext.jsx'
import Tour, { destinoAposTour } from '../pages/Tour.jsx'

// jogador autenticado, tour ainda não concluído — é o estado em que a página
// Tour normalmente é montada.
const JOGADOR = {
  steamId: '765',
  nick: 'fih',
  avatarUrl: null,
  isSuperAdmin: false,
  tourConcluido: false,
  faceitNick: null,
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

// concluir() navega pelo router; a rota "*" mostra onde o Jogador caiu.
function Destino() {
  const { pathname, search, hash } = useLocation()
  return <p data-testid="destino">{pathname + search + hash}</p>
}

function renderTour(entrada = '/tour') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[entrada]}>
        <Routes>
          <Route path="/tour" element={<Tour />} />
          <Route path="*" element={<Destino />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('Tour', () => {
  it('concluir com sucesso: navega pro passo final e redireciona pra "/" ao clicar em Concluir', async () => {
    mockFetch(() => Promise.resolve({ ok: true }))
    renderTour()

    expect(await screen.findByText('Bem-vindo ao Resenha')).toBeInTheDocument()

    // Passo 0 -> 3 via "Próximo" (o mesmo caminho que um usuário real percorre).
    fireEvent.click(await screen.findByRole('button', { name: 'Próximo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Próximo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Próximo' }))

    expect(await screen.findByText('Onde achar cada coisa')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))

    expect(await screen.findByTestId('destino')).toHaveTextContent(/^\/$/)
    expect(screen.queryByText(/erro ao concluir o tour/i)).not.toBeInTheDocument()
  })

  it('concluir com falha: mostra mensagem de erro e não redireciona (via "Pular tour")', async () => {
    mockFetch(() => Promise.resolve({ ok: false }))
    renderTour()

    expect(await screen.findByText('Bem-vindo ao Resenha')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /pular tour/i }))

    expect(await screen.findByText('Erro ao concluir o tour. Tente novamente.')).toBeInTheDocument()
    expect(screen.queryByTestId('destino')).not.toBeInTheDocument()
  })

  it('concluir com falha de rede (fetch rejeita): mostra a mesma mensagem de erro', async () => {
    mockFetch(() => Promise.reject(new Error('network down')))
    renderTour()

    expect(await screen.findByText('Bem-vindo ao Resenha')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /pular tour/i }))

    expect(await screen.findByText('Erro ao concluir o tour. Tente novamente.')).toBeInTheDocument()
    expect(screen.queryByTestId('destino')).not.toBeInTheDocument()
  })

  it('concluir volta para o returnTo interno que veio da rota protegida', async () => {
    mockFetch(() => Promise.resolve({ ok: true }))
    renderTour('/tour?returnTo=%2Fpartida%2Fp1%3Faba%3Drounds%23placar')

    fireEvent.click(await screen.findByRole('button', { name: /pular tour/i }))
    expect(await screen.findByTestId('destino')).toHaveTextContent('/partida/p1?aba=rounds#placar')
  })
})

describe('destinoAposTour', () => {
  const ORIGEM = 'http://localhost:3000'
  const destino = (v) => destinoAposTour(v, ORIGEM)

  it('aceita caminho interno com query e hash', () => {
    expect(destino('/partida/p1')).toBe('/partida/p1')
    expect(destino('/comparar?a=1&b=2#topo')).toBe('/comparar?a=1&b=2#topo')
    expect(destino('/tourney')).toBe('/tourney')
  })

  it('recusa tudo que sai da origem ou volta ao tour', () => {
    // Valor como chega de searchParams.get('returnTo'), já sem o percent-encoding da query.
    const daQuery = (cru) => new URLSearchParams(`r=${cru}`).get('r')
    const ruins = [
      null, undefined, '', 'partida', 'https://evil.test', 'javascript:alert(1)',
      '//evil.test', '/\\evil.test',
      daQuery('%2F%09%2Fevil.test'), '/\n/evil.test', '/\r/evil.test',
      daQuery('%2F.%2F%2Fevil.test'), '/.//evil.test', '/a/..//evil.test', '/%2e//evil.test',
      '/tour', '/tour/', '/tour/x', '/Tour', '/TOUR/x', '/%74our', '/./tour',
      '/%E0%A4%A',
    ]
    for (const ruim of ruins) {
      expect(destino(ruim), JSON.stringify(ruim)).toBe('/')
    }
  })
})
