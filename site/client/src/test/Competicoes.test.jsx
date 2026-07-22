// site/client/src/test/Competicoes.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AuthProvider } from '../auth/AuthContext.jsx'
import Competicoes from '../pages/Competicoes.jsx'

afterEach(() => { vi.restoreAllMocks() })

describe('Competicoes', () => {
  it('sem competicao ativa: mostra mensagem', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ativa: null, encerradas: [] }) })
    render(<Competicoes />)
    await waitFor(() => expect(screen.getByText(/nenhuma competi/i)).toBeInTheDocument())
  })

  it('com competicao ativa: mostra nome e premio', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ativa: {
          id: 'comp1', nome: 'Semana 1', premioDescricao: 'Skin AK-47',
          dataFim: new Date(Date.now() + 86400000).toISOString(),
          leaderboard: [], limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 3,
        },
        encerradas: [],
      }),
    })
    render(<Competicoes />)
    await waitFor(() => expect(screen.getByText('Semana 1')).toBeInTheDocument())
    expect(screen.getByText('Skin AK-47')).toBeInTheDocument()
  })

  it('mostra leaderboard com qualificados primeiro', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ativa: {
          id: 'comp1', nome: 'Semana 1', premioDescricao: 'Skin', dataFim: new Date(Date.now() + 86400000).toISOString(),
          limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 3,
          leaderboard: [
            { steamId: '999', nick: 'troya', avatarUrl: null, total: 300, qualificado: true },
            { steamId: '765', nick: 'bronze', avatarUrl: null, total: 50, qualificado: false },
          ],
        },
        encerradas: [],
      }),
    })
    render(<Competicoes />)
    await waitFor(() => expect(screen.getByText('troya')).toBeInTheDocument())
    expect(screen.getByText(/ainda n[ãa]o qualificado/i)).toBeInTheDocument()
  })

  it('competicao encerrada com vencedor e tradelink liberado pro proprio vencedor', async () => {
    // AuthProvider real (mesmo padrão de Tour.test.jsx): o componente compara
    // jogador?.steamId (via /api/auth/me) com vencedorSteamId pra decidir se mostra o
    // card de tradelink — sem um jogador autenticado de verdade no teste, souVencedor
    // nunca fica true.
    global.fetch = vi.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/api/auth/me')) {
        return Promise.resolve({ ok: true, json: async () => ({ steamId: '765', nick: 'bronze', isSuperAdmin: false }) })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ativa: null,
          encerradas: [{
            id: 'comp1', nome: 'Semana 1', premioDescricao: 'Skin', dataFim: new Date(Date.now() - 86400000).toISOString(),
            limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 3,
            vencedorSteamId: '765', tradelinkVencedor: null,
            leaderboard: [{ steamId: '765', nick: 'bronze', avatarUrl: null, total: 300, qualificado: true }],
          }],
        }),
      })
    })
    render(<AuthProvider><Competicoes /></AuthProvider>)
    await waitFor(() => expect(screen.getByText(/voc[êe] venceu/i)).toBeInTheDocument())
    expect(screen.getByPlaceholderText(/tradelink/i)).toBeInTheDocument()
  })
})
