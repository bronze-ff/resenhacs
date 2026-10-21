import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import JogadoresPremium from '../components/JogadoresPremium.jsx'

const LISTA = [
  { steamId: '76561198000000001', nick: 'troya', avatarUrl: null, premium: true },
  { steamId: '76561198000000002', nick: 'bronze', avatarUrl: null, premium: false },
]

afterEach(() => vi.unstubAllGlobals())

describe('JogadoresPremium', () => {
  it('lista com a badge e marca um Jogador como Premium', async () => {
    const fetchMock = vi.fn().mockImplementation((url, opcoes) =>
      Promise.resolve({ ok: true, json: async () => (opcoes?.method === 'PUT' ? {} : LISTA) }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<JogadoresPremium />)

    const bronze = await screen.findByRole('checkbox', { name: 'Premium: bronze' })
    expect(screen.getByRole('checkbox', { name: 'Premium: troya' })).toBeChecked()
    expect(bronze).not.toBeChecked()
    await user.click(bronze)

    await waitFor(() => expect(bronze).toBeChecked())
    const [url, opcoes] = fetchMock.mock.calls.find(([, o]) => o?.method === 'PUT')
    expect(url).toBe('/api/players/76561198000000002/premium')
    expect(JSON.parse(opcoes.body)).toEqual({ premium: true })
  })

  it('falha ao salvar avisa e não muda o flag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url, opcoes) =>
      Promise.resolve({ ok: opcoes?.method !== 'PUT', json: async () => LISTA })))
    const user = userEvent.setup()
    render(<JogadoresPremium />)
    const bronze = await screen.findByRole('checkbox', { name: 'Premium: bronze' })
    await user.click(bronze)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar bronze')
    expect(bronze).not.toBeChecked()
  })
})
