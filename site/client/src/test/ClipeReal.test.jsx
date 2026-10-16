import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SecaoClipeReal, { descreverClipe } from '../components/clipes/SecaoClipeReal.jsx'

const EU = { steamId: 'eu', nick: 'fih' }
const AMIGO = { steamId: 'amigo', nick: 'Jubileu' }
const INIMIGO = { steamId: 'ini', nick: 'rival' }
const JOGADORES = [{ steamId: 'eu', nick: 'fih', isTracked: true }]

function kill(extra) {
  return {
    round: 1, tick: 1000, killer: EU, victim: INIMIGO, assister: null, weapon: 'ak47',
    headshot: false, teamKill: false, wallbang: false, thrusmoke: false, attackerblind: false, noscope: false,
    ...extra,
  }
}
const KILLS = [kill({ round: 4, tick: 9000, weapon: 'hegrenade', victim: AMIGO, teamKill: true }), kill({ round: 6, tick: 15000 })]

function resposta(corpo, ok = true) {
  return Promise.resolve({ ok, json: async () => corpo })
}

function mockApi({ lista = { disponivel: true, clipes: [] }, post } = {}) {
  const fetchMock = vi.fn().mockImplementation((url, opcoes) => {
    if (url.includes('/kills?')) return resposta(KILLS)
    if (url.endsWith('/clipes-reais') && opcoes?.method === 'POST') return post ? post(opcoes) : resposta({ clipes: [] })
    if (url.endsWith('/clipes-reais')) return resposta(lista)
    return resposta({}, false)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('descreverClipe', () => {
  it('kill sozinha e montagem', () => {
    expect(descreverClipe({ kills: [{ round: 4 }] })).toBe('Kill · round 4')
    expect(descreverClipe({ kills: [{ round: 4 }, { round: 6 }] })).toBe('Montagem de 2 kills · rounds 4, 6')
  })
})

describe('SecaoClipeReal', () => {
  it('sem chave da DEMO-SLAP: avisa e não mostra o seletor', async () => {
    mockApi({ lista: { disponivel: false, clipes: [] } })
    render(<SecaoClipeReal matchId="m1" jogadores={JOGADORES} viewerSteamId="eu" />)
    expect(await screen.findByText('Clipe de vídeo ainda não configurado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gerar clipe' })).not.toBeInTheDocument()
  })

  it('lista que não carrega: mostra o erro e não oferece gerar clipe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) =>
      resposta(url.includes('/kills?') ? KILLS : { erro: 'x' }, url.includes('/kills?'))))
    render(<SecaoClipeReal matchId="m1" jogadores={JOGADORES} viewerSteamId="eu" />)
    expect(await screen.findByText('Não foi possível carregar os clipes dessa Partida.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Gerar/ })).not.toBeInTheDocument()
  })

  it('TK de granada na visão de quem morreu: manda tick, round e o pov da vítima', async () => {
    const post = vi.fn().mockReturnValue(resposta({
      clipes: [{ id: 'c1', status: 'renderizando', kills: [{ tick: 9000, round: 4, pov: 'amigo' }], pedidoPor: { nick: 'fih' } }],
    }))
    const fetchMock = mockApi({ post })
    const user = userEvent.setup()
    render(<SecaoClipeReal matchId="m1" jogadores={JOGADORES} viewerSteamId="eu" />)
    await user.click(await screen.findByRole('checkbox', { name: /Round 4: Jubileu/ }))
    await user.click(screen.getByText('Visão de quem morreu'))
    await user.click(screen.getByRole('button', { name: 'Gerar clipe' }))
    await waitFor(() => expect(post).toHaveBeenCalled())
    const corpo = JSON.parse(fetchMock.mock.calls.find(([, o]) => o?.method === 'POST')[1].body)
    expect(corpo).toEqual({ kills: [{ tick: 9000, round: 4, pov: 'amigo' }] })
    expect(await screen.findByText('Gravando no CS2…')).toBeInTheDocument()
  })

  it('várias kills viram montagem', async () => {
    mockApi()
    const user = userEvent.setup()
    render(<SecaoClipeReal matchId="m1" jogadores={JOGADORES} viewerSteamId="eu" />)
    await user.click(await screen.findByRole('button', { name: 'Todas' }))
    expect(screen.getByRole('button', { name: 'Gerar montagem (2 kills)' })).toBeEnabled()
  })

  it('erro do servidor aparece pro Jogador', async () => {
    mockApi({ post: () => resposta({ erro: 'Limite de 10 clipes por dia. Tente amanhã.' }, false) })
    const user = userEvent.setup()
    render(<SecaoClipeReal matchId="m1" jogadores={JOGADORES} viewerSteamId="eu" />)
    await user.click(await screen.findByRole('checkbox', { name: /Round 6/ }))
    await user.click(screen.getByRole('button', { name: 'Gerar clipe' }))
    expect(await screen.findByText('Limite de 10 clipes por dia. Tente amanhã.')).toBeInTheDocument()
  })

  it('clipe pronto mostra o vídeo e o link pra baixar; erro mostra o motivo', async () => {
    mockApi({
      lista: {
        disponivel: true,
        clipes: [
          { id: 'c1', status: 'pronto', kills: [{ round: 4 }], videoUrl: 'https://cdn.demo-slap.net/v1.mp4', pedidoPor: { nick: 'fih' } },
          { id: 'c2', status: 'erro', erro: 'Not enough credits', kills: [{ round: 6 }], pedidoPor: { nick: 'fih' } },
        ],
      },
    })
    const { container } = render(<SecaoClipeReal matchId="m1" jogadores={JOGADORES} viewerSteamId="eu" />)
    expect(await screen.findByRole('link', { name: 'Baixar vídeo' })).toHaveAttribute('href', 'https://cdn.demo-slap.net/v1.mp4')
    expect(container.querySelector('video')).toHaveAttribute('src', 'https://cdn.demo-slap.net/v1.mp4')
    expect(screen.getByText('Not enough credits')).toBeInTheDocument()
  })

  it('consulta de novo enquanto houver clipe em andamento', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = mockApi({ lista: { disponivel: true, clipes: [{ id: 'c1', status: 'renderizando', kills: [{ round: 1 }] }] } })
    render(<SecaoClipeReal matchId="m1" jogadores={JOGADORES} viewerSteamId="eu" />)
    await screen.findByText('Gravando no CS2…')
    const antes = fetchMock.mock.calls.filter(([u]) => u.endsWith('/clipes-reais')).length
    await vi.advanceTimersByTimeAsync(10000)
    const depois = fetchMock.mock.calls.filter(([u]) => u.endsWith('/clipes-reais')).length
    expect(depois).toBeGreaterThan(antes)
  })
})
