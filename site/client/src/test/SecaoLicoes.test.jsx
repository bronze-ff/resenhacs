// site/client/src/test/SecaoLicoes.test.jsx
// F1-UI: Lições da Partida sobre a I8 (GET /api/matches/:id/licoes/:steamId), mockada
// aqui porque o server está na PR #109. Só aparece para quem jogou a Partida; L1 e L2
// linkam o round no Replay 2D; L3 sem link; erro com Tentar de novo; tudo zero.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import SecaoLicoes from '../components/SecaoLicoes.jsx'
import { AuthProvider } from '../auth/AuthContext.jsx'
import Partida from '../pages/Partida.jsx'

afterEach(() => { vi.unstubAllGlobals() })

const ok = (corpo) => Promise.resolve({ ok: true, status: 200, json: async () => corpo })
const falha = (status = 500) => Promise.resolve({ ok: false, status, json: async () => ({}) })

const EU = '76561198000000009'
const OUTRO = '76561198000000001'
const JOGADORES = [{ steamId: EU, team: 'A' }, { steamId: OUTRO, team: 'B' }]

const LICOES = {
  mortesSemTrade: { quantidade: 7, rounds: [{ round: 2, tick: 4100 }, { round: 5, tick: 9800 }] },
  primeirasMortes: { quantidade: 1, rounds: [{ round: 3, tick: 2500 }] },
  flashAliado: { vezes: 4, segundos: 6.5 },
}
const ZERO = {
  mortesSemTrade: { quantidade: 0, rounds: [] },
  primeirasMortes: { quantidade: 0, rounds: [] },
  flashAliado: { vezes: 0, segundos: 0 },
}

function mockI8(resposta) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => resposta()))
}

function renderSecao(props = {}) {
  return render(
    <MemoryRouter>
      <SecaoLicoes matchId="m1" jogadores={JOGADORES} jogadorLogado={{ steamId: EU }} temDemo {...props} />
    </MemoryRouter>,
  )
}

describe('SecaoLicoes', () => {
  it('não renderiza nem chama a I8 se o Jogador logado não jogou a Partida', () => {
    mockI8(() => ok(LICOES))
    const { container } = renderSecao({ jogadorLogado: { steamId: '76561198000000077' } })
    expect(container).toBeEmptyDOMElement()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('Partida sem Demo (temDemo false) não renderiza nem chama a I8', () => {
    mockI8(() => ok(LICOES))
    const { container } = renderSecao({ temDemo: false })
    expect(container).toBeEmptyDOMElement()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('não renderiza sem Jogador logado', () => {
    mockI8(() => ok(LICOES))
    const { container } = renderSecao({ jogadorLogado: null })
    expect(container).toBeEmptyDOMElement()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('chama a I8 com o steamId do Jogador logado e mostra as contagens', async () => {
    mockI8(() => ok(LICOES))
    renderSecao()
    const semTrade = await screen.findByRole('region', { name: /morte sem trade/i })
    expect(fetch).toHaveBeenCalledWith(`/api/matches/m1/licoes/${EU}`)
    expect(within(semTrade).getByText('7')).toBeInTheDocument()
    const flash = screen.getByRole('region', { name: /flash em aliado/i })
    expect(within(flash).getByText('4')).toBeInTheDocument()
    expect(within(flash).getByText(/6,5 s/)).toBeInTheDocument()
    // Só colegas (autoflash fora), sem comparar com o total de teammates_flashed.
    expect(within(flash).getByText(/em colegas 4 vezes/)).toBeInTheDocument()
    expect(flash).not.toHaveTextContent(/ de \d+ (vezes|flashes)|total de/i)
    expect(within(flash).queryByRole('link')).not.toBeInTheDocument()
  })

  it('L1 e L2 linkam o round e a tick certos no Replay 2D', async () => {
    mockI8(() => ok(LICOES))
    renderSecao()
    const semTrade = await screen.findByRole('region', { name: /morte sem trade/i })
    const links = within(semTrade).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/partida/m1?round=2&tick=4100',
      '/partida/m1?round=5&tick=9800',
    ])
    expect(links[0]).toHaveAccessibleName(/round 2.*replay 2d/i)
    // Mostra que há mais mortes do que os 5 rounds listados.
    expect(within(semTrade).getByText(/2 de 7/)).toBeInTheDocument()

    const primeira = screen.getByRole('region', { name: /primeira morte/i })
    expect(within(primeira).getByRole('link')).toHaveAttribute('href', '/partida/m1?round=3&tick=2500')
  })

  it('clique no link chama onVerRound com o round, sem sair da página', async () => {
    mockI8(() => ok(LICOES))
    const onVerRound = vi.fn()
    renderSecao({ onVerRound })
    const semTrade = await screen.findByRole('region', { name: /morte sem trade/i })
    fireEvent.click(within(semTrade).getAllByRole('link')[1])
    expect(onVerRound).toHaveBeenCalledWith(5)
  })

  it('erro tem "Tentar de novo" e recupera', async () => {
    let falhar = true
    mockI8(() => (falhar ? falha() : ok(LICOES)))
    renderSecao()
    expect(await screen.findByText('Não deu para carregar as Lições.')).toBeInTheDocument()
    falhar = false
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('region', { name: /morte sem trade/i })).toBeInTheDocument()
  })

  it('tudo zero mostra "Nada pra rever nessa Partida."', async () => {
    mockI8(() => ok(ZERO))
    renderSecao()
    expect(await screen.findByText('Nada pra rever nessa Partida.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /morte sem trade/i })).not.toBeInTheDocument()
  })

  it('Partida sem Replay 2D lista os rounds sem link', async () => {
    mockI8(() => ok(LICOES))
    renderSecao({ semReplay: true })
    const semTrade = await screen.findByRole('region', { name: /morte sem trade/i })
    expect(within(semTrade).queryByRole('link')).not.toBeInTheDocument()
    expect(within(semTrade).getByText('R2')).toHaveAttribute('aria-hidden', 'true')
    expect(within(semTrade).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['R2Round 2', 'R5Round 5'])
    expect(within(semTrade).getByText('Round 2')).toHaveClass('sr-only')
  })
})

describe('Partida monta as Lições', () => {
  it('Jogador logado que jogou vê a seção, com a I8 chamada pelo steamId dele', async () => {
    const PARTIDA = {
      id: 'm1', map: 'de_mirage', playedAt: '2026-10-20T22:00:00.000Z', scoreA: 13, scoreB: 9, source: 'valve_mm', temDemo: true,
      plataformaManual: null, status: 'parsed', demoUrl: null, replayUrl: null, endedEarly: false, abandonedBy: null,
      demoUpload: null, rounds: [], highlights: [], clips: [], economia: [], mvp: null,
      players: [{ steamId: EU, nick: 'eu', team: 'A', isTracked: true, won: true, kills: 20, deaths: 10, assists: 3 }],
    }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      const u = String(url)
      if (u.includes('/api/auth/me')) return ok({ steamId: EU, nick: 'eu', avatarUrl: null, isSuperAdmin: false, tourConcluido: true })
      if (u === '/api/matches/m1') return ok(PARTIDA)
      if (u === `/api/matches/m1/licoes/${EU}`) return ok(LICOES)
      return ok({})
    }))
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/partida/m1']}>
          <Routes><Route path="/partida/:id" element={<Partida />} /></Routes>
        </MemoryRouter>
      </AuthProvider>,
    )
    expect(await screen.findByRole('region', { name: /morte sem trade/i })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(`/api/matches/m1/licoes/${EU}`)
  })

  it('Partida sem Demo não mostra a seção nem busca /licoes', async () => {
    const PARTIDA = {
      id: 'm2', map: 'de_mirage', playedAt: '2026-10-20T22:00:00.000Z', scoreA: 13, scoreB: 9, source: 'faceit', temDemo: false,
      plataformaManual: null, status: 'pending', demoUrl: null, replayUrl: null, endedEarly: false, abandonedBy: null,
      demoUpload: null, rounds: [], highlights: [], clips: [], economia: [], mvp: null,
      players: [{ steamId: EU, nick: 'eu', team: 'A', isTracked: true, won: true, kills: 20, deaths: 10, assists: 3 }],
    }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      const u = String(url)
      if (u.includes('/api/auth/me')) return ok({ steamId: EU, nick: 'eu', avatarUrl: null, isSuperAdmin: false, tourConcluido: true })
      if (u === '/api/matches/m2') return ok(PARTIDA)
      return ok({})
    }))
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/partida/m2']}>
          <Routes><Route path="/partida/:id" element={<Partida />} /></Routes>
        </MemoryRouter>
      </AuthProvider>,
    )
    expect((await screen.findAllByText(/mirage/i)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { name: 'Lições' })).not.toBeInTheDocument()
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/licoes'))).toBe(false)
  })
})
