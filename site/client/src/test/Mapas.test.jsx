import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Mapas from '../pages/Mapas.jsx'

const RESPOSTA = {
  jogador: '76561198000000009',
  periodo: {
    modo: 'partidas',
    atual: { de: '2026-09-07', ate: '2026-10-14', partidas: 30 },
    anterior: { de: '2026-08-05', ate: '2026-09-06', partidas: 30 },
  },
  mapas: [
    {
      map: 'de_mirage', partidas: 16, vitorias: 10, derrotas: 6, empates: 0, winrate: 62.5,
      anterior: { partidas: 12, winrate: 50 }, variacao: 12.5,
      lados: { CT: { atual: 55, rounds: 100, anterior: 48, grupo: 52 }, T: { atual: 64, rounds: 90, anterior: 49, grupo: 50 } },
    },
    {
      map: 'de_inferno', partidas: 15, vitorias: 7, derrotas: 7, empates: 1, winrate: 46.7,
      anterior: null, variacao: null,
      lados: { CT: { atual: 57, rounds: 80, anterior: null, grupo: null }, T: { atual: 35, rounds: 80, anterior: null, grupo: 48 } },
    },
  ],
}

function mockFetch(mapas = RESPOSTA) {
  global.fetch = vi.fn(async (url) => {
    if (String(url).startsWith('/api/amigos')) {
      return { ok: true, json: async () => ({ amigos: [{ steamId: '76561198000000001', nick: 'amigo' }] }) }
    }
    return { ok: true, json: async () => mapas }
  })
}

function renderizar() {
  return render(
    <MemoryRouter>
      <Mapas />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('Mapas', () => {
  it('mostra um card por mapa com winrate, variação com seta e links de Granadas/Táticas', async () => {
    mockFetch()
    renderizar()
    expect(await screen.findByText('Mirage')).toBeInTheDocument()
    expect(screen.getByText('Inferno')).toBeInTheDocument()
    expect(screen.getByText('63%')).toBeInTheDocument()
    expect(screen.getByText(/13 pts vs anterior/)).toBeInTheDocument()
    expect(screen.getByText('sem comparação')).toBeInTheDocument()
    expect(screen.getByText('7V · 7D · 1E')).toBeInTheDocument()
    const granadas = screen.getAllByRole('link', { name: 'Granadas' })
    expect(granadas[0]).toHaveAttribute('href', '/granadas?map=de_mirage')
    expect(screen.getAllByRole('link', { name: 'Táticas' })[1]).toHaveAttribute('href', '/taticas?map=de_inferno')
    expect(global.fetch).toHaveBeenCalledWith('/api/mapas')
  })

  it('estado vazio sem partidas', async () => {
    mockFetch({ ...RESPOSTA, mapas: [] })
    renderizar()
    expect(await screen.findByText('Nenhuma partida no período')).toBeInTheDocument()
  })

  it('trocar o jogador refaz a busca com ?jogador=', async () => {
    mockFetch()
    renderizar()
    await screen.findByText('Mirage')
    fireEvent.click(screen.getByRole('button', { name: /^Eu/ }))
    fireEvent.click(await screen.findByRole('option', { name: 'amigo' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/mapas?jogador=76561198000000001'))
  })

  it('erro da API mostra estado de erro', async () => {
    global.fetch = vi.fn(async (url) => (String(url).startsWith('/api/amigos') ? { ok: true, json: async () => ({ amigos: [] }) } : { ok: false }))
    renderizar()
    expect(await screen.findByText('Não deu pra carregar os mapas.')).toBeInTheDocument()
  })
})
