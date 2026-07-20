import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SecaoReplay } from '../pages/Partida.jsx'

// Índice "streaming" (formato novo — FIL-54b): rounds só com metadados, sem `frames`.
const INDICE_STREAMING = {
  map: 'de_mirage', calibrated: true, tickRate: 8, names: { s1: 'fih' }, teams: { s1: 'A' },
  rounds: [
    { round: 1, frameCount: 2, clutch: null },
    { round: 2, frameCount: 1, clutch: null },
  ],
}
const ROUND_1 = { round: 1, frames: [{ t: 0, players: [] }, { t: 1, players: [] }], kills: [], hits: [] }
const ROUND_2 = { round: 2, frames: [{ t: 0, players: [] }], kills: [], hits: [] }

// Índice "antigo" (replay arquivado antes do streaming): já vem com frames completos.
const INDICE_ANTIGO = {
  map: 'de_dust2', calibrated: true, tickRate: 8, names: {}, teams: {},
  rounds: [{ round: 1, frames: [{ t: 0, players: [] }], kills: [], hits: [] }],
}

function mockFetch(handlers) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
    for (const [padrao, corpo] of handlers) {
      if (typeof padrao === 'string' ? url === padrao : padrao.test(url)) {
        return Promise.resolve({ ok: true, json: async () => corpo })
      }
    }
    return Promise.resolve({ ok: false })
  }))
}

describe('SecaoReplay — streaming por round', () => {
  it('formato novo: busca o índice, depois o round 1, depois os demais em paralelo', async () => {
    mockFetch([
      ['/api/matches/m1/replay', INDICE_STREAMING],
      ['/api/matches/m1/replay/round/1', ROUND_1],
      ['/api/matches/m1/replay/round/2', ROUND_2],
    ])
    render(<SecaoReplay replayUrl="/api/matches/m1/replay" seek={null} onSelecionarPonto={() => {}} />)

    // O seletor de round (componente custom, fechado por padrão) já mostra "Round 1"
    // assim que o índice chega, mesmo antes dos frames terem carregado (placeholder
    // vazio, ver roundVazio em Partida.jsx).
    expect(await screen.findByText('Round 1')).toBeInTheDocument()

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/matches/m1/replay/round/1')
      expect(fetch).toHaveBeenCalledWith('/api/matches/m1/replay/round/2')
    })
  })

  it('formato antigo: não busca round nenhum, o índice já é o replay completo', async () => {
    mockFetch([['/api/matches/m1/replay', INDICE_ANTIGO]])
    render(<SecaoReplay replayUrl="/api/matches/m1/replay" seek={null} onSelecionarPonto={() => {}} />)

    expect(await screen.findByText('Round 1')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1) // só o índice — nenhum /round/N
  })
})
