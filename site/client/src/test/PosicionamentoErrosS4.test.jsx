import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import PosicionamentoAgregado from '../components/PosicionamentoAgregado.jsx'

afterEach(() => vi.unstubAllGlobals())

describe('Posicionamento — estados S4', () => {
  it.each(['http', 'rede'])('separa falha de vazio e permite repetir: %s', async (tipo) => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => tipo === 'rede'
        ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: false }))
      .mockResolvedValue({ ok: true, json: async () => ({ map: null, pontos: [], mapas: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<PosicionamentoAgregado steamId="1" />)
    expect(screen.getByRole('status', { name: 'Carregando posicionamento' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(/carregar.*posicionamento/i)
    expect(screen.queryByRole('status', { name: 'Carregando posicionamento' })).not.toBeInTheDocument()
    expect(screen.queryByText('Sem dados de posicionamento ainda.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('Sem dados de posicionamento ainda.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('ignora erro antigo depois de trocar o Jogador', async () => {
    let rejeitar
    const antiga = new Promise((_, reject) => { rejeitar = reject })
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(antiga)
      .mockResolvedValue({ ok: true, json: async () => ({ map: null, pontos: [], mapas: [] }) }))
    const { rerender } = render(<PosicionamentoAgregado steamId="1" />)
    rerender(<PosicionamentoAgregado steamId="2" />)
    expect(await screen.findByText('Sem dados de posicionamento ainda.')).toBeInTheDocument()
    await act(async () => rejeitar(new Error('offline')))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Sem dados de posicionamento ainda.')).toBeInTheDocument()
  })
})
