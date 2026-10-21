// site/client/src/test/ErrosNavegacao.test.jsx
// Onda 1, S3a: rota inexistente, returnTo do login, aviso de login falho, erro de rede
// que não vira "sem Partidas", erro da lista de Jogadores no Comparar e FACEIT em uso.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import App from '../App.jsx'
import { AuthProvider } from '../auth/AuthContext.jsx'
import Shell from '../components/Shell.jsx'
import Feed from '../pages/Feed.jsx'
import Partida from '../pages/Partida.jsx'
import Comparar from '../pages/Comparar.jsx'
import { hrefLoginSteam } from '../pages/Entrar.jsx'

const JOGADOR = { steamId: '765', nick: 'fih', avatarUrl: null, isSuperAdmin: false, tourConcluido: true }

// /api/auth/me devolve `me` (null = deslogado); o resto responde lista vazia.
function mockApp(me) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
    if (String(url).includes('/api/auth/me')) {
      return Promise.resolve({ ok: me !== null, json: async () => me ?? { erro: 'Não autenticado' } })
    }
    return Promise.resolve({ ok: true, json: async () => [] })
  }))
}

beforeEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})
afterEach(() => { vi.unstubAllGlobals() })

describe('rota inexistente', () => {
  it('deslogado: mostra a página sozinha com link para o início', async () => {
    mockApp(null)
    window.history.replaceState(null, '', '/nao-existe-xyz')
    render(<App />)
    expect(await screen.findByText('Essa página não existe.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /início/i })).toHaveAttribute('href', '/')
    expect(screen.queryByText('fih')).not.toBeInTheDocument()
  })

  it('logado: mostra a página dentro do Shell', async () => {
    mockApp(JOGADOR)
    window.history.replaceState(null, '', '/nao-existe-xyz')
    render(<App />)
    expect(await screen.findByText('Essa página não existe.')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'fih' })).toBeInTheDocument()
  })
})

describe('returnTo do login', () => {
  it('rota protegida deslogada manda para /entrar com a rota pedida, e o botão leva o returnTo', async () => {
    mockApp(null)
    window.history.replaceState(null, '', '/partida/abc-123')
    render(<App />)
    const botao = await screen.findByRole('link', { name: /entrar com steam/i })
    expect(window.location.pathname).toBe('/entrar')
    expect(new URLSearchParams(window.location.search).get('returnTo')).toBe('/partida/abc-123')
    expect(botao).toHaveAttribute('href', '/api/auth/steam?returnTo=%2Fpartida%2Fabc-123')
  })

  it('rota de admin deslogada também leva o returnTo', async () => {
    mockApp(null)
    window.history.replaceState(null, '', '/admin')
    render(<App />)
    const botao = await screen.findByRole('link', { name: /entrar com steam/i })
    expect(botao).toHaveAttribute('href', '/api/auth/steam?returnTo=%2Fadmin')
  })

  it('hrefLoginSteam só aceita path interno', () => {
    expect(hrefLoginSteam('/jogador/765')).toBe('/api/auth/steam?returnTo=%2Fjogador%2F765')
    expect(hrefLoginSteam(null)).toBe('/api/auth/steam')
    expect(hrefLoginSteam('')).toBe('/api/auth/steam')
    expect(hrefLoginSteam('https://evil.example')).toBe('/api/auth/steam')
    expect(hrefLoginSteam('//evil.example')).toBe('/api/auth/steam')
    expect(hrefLoginSteam('/partida?x=1')).toBe('/api/auth/steam')
    expect(hrefLoginSteam('/a/../b.')).toBe('/api/auth/steam')
  })
})

describe('aviso de login falho na landing', () => {
  it('?erro=login-invalido mostra o alerta e limpa o parâmetro', async () => {
    mockApp(null)
    window.history.replaceState(null, '', '/?erro=login-invalido')
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Login não concluído. Tente de novo.')
    await waitFor(() => expect(window.location.search).toBe(''))
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('sem o parâmetro não há alerta', async () => {
    mockApp(null)
    render(<App />)
    await screen.findAllByRole('link', { name: /entrar com steam/i })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Feed — erro e vazio', () => {
  it('rede caída mostra erro com "Tentar de novo", não "Nenhuma Partida"', async () => {
    let falhar = true
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      if (String(url).startsWith('/api/matches?') && falhar) return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve({ ok: true, json: async () => [] })
    }))
    render(<MemoryRouter><Feed /></MemoryRouter>)
    expect(await screen.findByText(/não deu para carregar as partidas/i)).toBeInTheDocument()
    expect(screen.queryByText('Nenhuma Partida encontrada')).not.toBeInTheDocument()
    falhar = false
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('Nenhuma Partida encontrada')).toBeInTheDocument()
    expect(screen.queryByText(/não deu para carregar as partidas/i)).not.toBeInTheDocument()
  })

  it('500 também é erro, não lista vazia', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      if (String(url).startsWith('/api/matches?')) return Promise.resolve({ ok: false, status: 500, json: async () => ({ erro: 'x' }) })
      return Promise.resolve({ ok: true, json: async () => [] })
    }))
    render(<MemoryRouter><Feed /></MemoryRouter>)
    expect(await screen.findByText(/não deu para carregar as partidas/i)).toBeInTheDocument()
  })

  it('500 na página 2 mantém as Partidas e troca "Carregar mais" por "Tentar de novo"', async () => {
    const pagina1 = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`, map: 'de_inferno', playedAt: '2026-10-13T21:05:00Z', scoreA: 13, scoreB: 9, source: 'valve_mm',
      temDemo: true, tracked: [], mvp: null, highlights: 0,
    }))
    let falharPagina2 = true
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      const u = String(url)
      if (u.startsWith('/api/matches?') && u.includes('offset=20')) {
        if (falharPagina2) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
        return Promise.resolve({ ok: true, json: async () => [] })
      }
      if (u.startsWith('/api/matches?')) return Promise.resolve({ ok: true, json: async () => pagina1 })
      return Promise.resolve({ ok: true, json: async () => [] })
    }))
    const { container } = render(<MemoryRouter><Feed /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }))
    expect(await screen.findByText('Não deu para carregar mais Partidas.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument()
    expect(container.querySelectorAll('a[href^="/partida/m"]').length).toBeGreaterThan(0)
    falharPagina2 = false
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(screen.queryByText('Não deu para carregar mais Partidas.')).not.toBeInTheDocument())
  })

  it('vazio sem filtro leva para Enviar Demo e para o passo a passo do Share Code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    render(<MemoryRouter><Feed /></MemoryRouter>)
    expect(await screen.findByText('Nenhuma Partida encontrada')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Enviar Demo' })).toHaveAttribute('href', '/enviar-demo')
    expect(screen.getByRole('link', { name: /passo a passo do share code/i })).toHaveAttribute('href', '/conta')
  })
})

describe('Partida — 404 x falha', () => {
  function montar(resposta) {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      if (String(url).includes('/api/competicoes')) return Promise.resolve({ ok: true, json: async () => ({ ativa: null }) })
      return resposta()
    }))
    render(
      <MemoryRouter initialEntries={['/partida/m1']}>
        <Routes><Route path="/partida/:id" element={<Partida />} /></Routes>
      </MemoryRouter>,
    )
  }

  it('404 mostra "Partida não encontrada"', async () => {
    montar(() => Promise.resolve({ ok: false, status: 404, json: async () => ({ erro: 'x' }) }))
    expect(await screen.findByText('Partida não encontrada.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
  })

  it('500 ou rede caída mostra erro com "Tentar de novo"', async () => {
    montar(() => Promise.resolve({ ok: false, status: 503, json: async () => ({}) }))
    expect(await screen.findByText(/não deu para carregar a partida/i)).toBeInTheDocument()
    expect(screen.queryByText('Partida não encontrada.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })
})

describe('Comparar — lista de Jogadores', () => {
  it('erro em /api/players mostra aviso e não quebra a tela', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ erro: 'x' }) }))
    render(<MemoryRouter><Comparar /></MemoryRouter>)
    expect(await screen.findByText(/não deu para carregar a lista de jogadores/i)).toBeInTheDocument()
    expect(screen.getByText('Comparar Jogadores')).toBeInTheDocument()
  })
})

describe('ErrorBoundary dentro do Shell', () => {
  function Quebra() {
    throw new Error('dado estranho')
  }

  it('erro de render numa página mantém a navegação do Shell', async () => {
    mockApp(JOGADOR)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <AuthProvider>
        <MemoryRouter><Shell><Quebra /></Shell></MemoryRouter>
      </AuthProvider>,
    )
    expect(await screen.findByText('Essa página quebrou')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'fih' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument()
    console.error.mockRestore()
  })

  it('trocar de rota zera o erro', async () => {
    mockApp(JOGADOR)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/quebrada']}>
          <Shell>
            <Routes>
              <Route path="/quebrada" element={<Quebra />} />
              <Route path="*" element={<p>outra página</p>} />
            </Routes>
          </Shell>
        </MemoryRouter>
      </AuthProvider>,
    )
    expect(await screen.findByText('Essa página quebrou')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    fireEvent.click(within(nav).getAllByRole('link')[1])
    expect(await screen.findByText('outra página')).toBeInTheDocument()
    expect(screen.queryByText('Essa página quebrou')).not.toBeInTheDocument()
    console.error.mockRestore()
  })
})

describe('Perfil — FACEIT já vinculada', () => {
  it('?erro=faceit-em-uso mostra a mensagem', async () => {
    mockApp(JOGADOR)
    window.history.replaceState(null, '', '/conta?erro=faceit-em-uso')
    render(<App />)
    expect(await screen.findByText('Essa conta FACEIT já está vinculada a outro Jogador.')).toBeInTheDocument()
  })
})
