// site/client/src/test/Feed.test.jsx
// Escopo mínimo: o filtro por jogador (era "MVP", virou participação — a semântica e o
// rótulo confundiam quem escolhia o próprio nick esperando ver as partidas em que jogou).
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
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

function chamadasSync() {
  return fetch.mock.calls.filter(([u]) => String(u).includes('sync-status')).length
}

describe('Feed — sync-status', () => {
  afterEach(() => {
    cleanup()
    delete document.hidden
    vi.useRealTimers()
  })

  function mockSync(pendingDe) {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      if (String(url).includes('sync-status')) {
        const pending = typeof pendingDe === 'function' ? pendingDe() : pendingDe
        return Promise.resolve({ ok: true, json: async () => ({ pending, failed: 0, parsed: 1 }) })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    }))
  }

  it('não repete quando pending é 0', async () => {
    mockSync(0)
    render(<MemoryRouter><Feed /></MemoryRouter>)
    await waitFor(() => expect(chamadasSync()).toBe(1))
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(chamadasSync()).toBe(1)
  })

  it('repete a cada 2 min enquanto pending > 0 e para quando zera', async () => {
    let pending = 2
    mockSync(() => pending)
    render(<MemoryRouter><Feed /></MemoryRouter>)
    expect(await screen.findByText(/pra sincronizar/i)).toBeInTheDocument()
    expect(chamadasSync()).toBe(1)
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    await waitFor(() => expect(chamadasSync()).toBe(2))
    pending = 0
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    await waitFor(() => expect(screen.queryByText(/pra sincronizar/i)).not.toBeInTheDocument())
    const parou = chamadasSync()
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(chamadasSync()).toBe(parou)
  })

  it('não consulta com a aba escondida e consulta na hora ao voltar', async () => {
    let hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    mockSync(3)
    render(<MemoryRouter><Feed /></MemoryRouter>)
    await screen.findByText(/pra sincronizar/i)
    expect(chamadasSync()).toBe(1)
    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(chamadasSync()).toBe(1)
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(chamadasSync()).toBe(2))
  })

  it('StrictMode mostra a fila do segundo mount', async () => {
    const resolver = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      if (String(url).includes('sync-status')) {
        return new Promise((resolve) => {
          resolver.push(() => resolve({ ok: true, json: async () => ({ pending: 2, failed: 0, parsed: 1 }) }))
        })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    }))
    render(
      <StrictMode>
        <MemoryRouter><Feed /></MemoryRouter>
      </StrictMode>,
    )
    await waitFor(() => expect(resolver.length).toBeGreaterThanOrEqual(2))
    await act(async () => { resolver.forEach((concluir) => concluir()) })
    expect(await screen.findByText(/pra sincronizar/i)).toBeInTheDocument()
  })
})
