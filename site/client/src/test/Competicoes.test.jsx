// site/client/src/test/Competicoes.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
})
