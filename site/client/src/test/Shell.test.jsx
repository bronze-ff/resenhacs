// site/client/src/test/Shell.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthContext.jsx'
import Shell from '../components/Shell.jsx'

function mockFetch({ temAtiva = false } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/api/auth/me')) {
        return Promise.resolve({ ok: true, json: async () => ({ steamId: '765', nick: 'bronze', avatarUrl: null, isSuperAdmin: false }) })
      }
      if (typeof url === 'string' && url.includes('/api/competicoes/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ temAtiva }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }),
  )
}

afterEach(() => { vi.unstubAllGlobals() })

function renderShell(opts) {
  mockFetch(opts)
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/']}>
        <Shell>conteudo</Shell>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('Shell — barra inferior mobile', () => {
  it('base sem competicao ativa: Partidas, Ranking, Clipes, Comparar', async () => {
    renderShell({ temAtiva: false })
    await waitFor(() => expect(screen.getByText('bronze')).toBeInTheDocument())
    const barra = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(within(barra).getByRole('link', { name: /^partidas$/i })).toBeInTheDocument()
    expect(within(barra).getByRole('link', { name: /^ranking$/i })).toBeInTheDocument()
    expect(within(barra).getByRole('link', { name: /^clipes$/i })).toBeInTheDocument()
    expect(within(barra).getByRole('link', { name: /comparar/i })).toBeInTheDocument()
  })
})

describe('Shell — indicador de competicao ativa (sidebar)', () => {
  it('sem competicao ativa: sem indicador na sidebar', async () => {
    renderShell({ temAtiva: false })
    await waitFor(() => expect(screen.getByText('bronze')).toBeInTheDocument())
    expect(screen.queryByText(/competi[çc][ãa]o ativa/i)).not.toBeInTheDocument()
  })

  it('com competicao ativa: mostra o indicador (texto acessivel) perto de Competicoes', async () => {
    renderShell({ temAtiva: true })
    await waitFor(() => expect(screen.getByText(/competi[çc][ãa]o ativa/i)).toBeInTheDocument())
  })
})
