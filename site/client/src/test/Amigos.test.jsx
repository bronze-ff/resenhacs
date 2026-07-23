import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Amigos from '../pages/Amigos.jsx'

function mockFetch(map) {
  return vi.fn((url) => {
    for (const [needle, body] of map) if (String(url).includes(needle)) return Promise.resolve({ ok: true, json: async () => body })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

describe('Amigos', () => {
  beforeEach(() => { global.fetch = mockFetch([
    ['/api/amigos', { amigos: [{ steamId: '1', nick: 'AmigoUm', avatarUrl: null }], recebidos: [{ steamId: '2', nick: 'Pediu', avatarUrl: null }], enviados: [] }],
    ['/api/players/bans', []],
  ]) })

  it('mostra amigos e pedidos recebidos', async () => {
    render(<MemoryRouter><Amigos /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('AmigoUm')).toBeInTheDocument())
    expect(screen.getByText('Pediu')).toBeInTheDocument()
  })
})
