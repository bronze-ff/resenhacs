import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SecaoClipeReal from '../components/clipes/SecaoClipeReal.jsx'

const partida = {
  id: 'm1', source: 'faceit', temDemo: false, demoUrl: null, replayUrl: null,
  map: 'de_mirage', demoUpload: null,
  players: [{ steamId: 'eu', nick: 'Jogador', kills: 21, deaths: 17 }],
}
const resposta = (body) => Promise.resolve({ ok: true, json: async () => body })
afterEach(() => vi.unstubAllGlobals())

describe('Clipe Real — Partida sem Demo', () => {
  it.each(['Clipe', 'Fails', 'Coaching'])('Demo bruta expirada mantém seleção, estimativa e pedido de %s', async (modo) => {
    const evento = {
      tick: 100, round: 2, killer: { steamId: 'eu', nick: 'Jogador' },
      victim: { steamId: 'eu', nick: 'Jogador' }, weapon: 'ak47',
    }
    const fetchMock = vi.fn((url) => {
      if (url.includes('/kills?')) return resposta([evento])
      if (url.endsWith('/estimativa')) return resposta({ trechos: 1, total: 1, analise: 0, reais: 0.19 })
      return resposta({ disponivel: true, permitido: true, clipes: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SecaoClipeReal matchId="m1" jogadores={partida.players} viewerSteamId="eu" partida={{ ...partida, temDemo: true }} />)
    const radio = await screen.findByRole('radio', { name: modo, exact: true })
    if (modo !== 'Clipe') await userEvent.click(radio)
    await userEvent.click(await screen.findByRole('checkbox', { name: /Round 2:/ }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/estimativa'))).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: /Gerar/ }))
    expect(fetchMock.mock.calls.some(([url, opcoes]) => url.endsWith('/clipes-reais') && opcoes?.method === 'POST')).toBe(true)
    expect(screen.queryByText(/Partida FACEIT sem Demo:/)).not.toBeInTheDocument()
  })

  it('informa que faltam eventos, oferece envio e preserva o Clipe pronto sem consultar kills', async () => {
    const fetchMock = vi.fn((url) => url.endsWith('/clipes-reais') ? resposta({
      disponivel: true, permitido: true,
      clipes: [{ id: 'c1', status: 'pronto', kills: [{ round: 2, tick: 100 }], videos: ['https://example.test/clipe.mp4'] }],
    }) : resposta([]))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<SecaoClipeReal matchId="m1" jogadores={partida.players} viewerSteamId="eu" partida={partida} />)
    expect(await screen.findByText('Partida FACEIT sem Demo: kills, mortes por round e clipes precisam do arquivo .dem')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enviar demo desta partida/i })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Clipe' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Gerar/ })).not.toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'https://example.test/clipe.mp4'))
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/kills?') || url.endsWith('/estimativa'))).toBe(false)
    expect(screen.queryByText(/Nenhuma (kill|morte) nessa Partida/)).not.toBeInTheDocument()
  })
})
