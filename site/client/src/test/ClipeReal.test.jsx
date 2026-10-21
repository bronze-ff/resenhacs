import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
const KILLS = [
  kill({ round: 4, tick: 9000, weapon: 'hegrenade', victim: AMIGO, teamKill: true }),
  kill({ round: 6, tick: 15000 }),
  kill({ round: 8, tick: 20000, killer: INIMIGO, victim: EU }),
]
const ESTIMATIVA = { trechos: 2, creditos: 4, analise: 1, total: 5, reais: 0.95, extraSemMarca: 2, reaisExtraSemMarca: 0.38 }

function resposta(corpo, ok = true) {
  return Promise.resolve({ ok, json: async () => corpo })
}

function mockApi({ lista = { disponivel: true, permitido: true, clipes: [] }, post } = {}) {
  const fetchMock = vi.fn().mockImplementation((url, opcoes) => {
    if (url.includes('/kills?')) return resposta(KILLS)
    if (url.endsWith('/estimativa')) return resposta(ESTIMATIVA)
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

  it('coaching conta a morte uma vez, mesmo com dois trechos', () => {
    const kills = [{ round: 4, tick: 1, pov: 'a' }, { round: 4, tick: 1, pov: 'b' }]
    expect(descreverClipe({ modo: 'coaching', kills })).toBe('Coaching · 1 morte · round 4')
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
    const corpo = JSON.parse(fetchMock.mock.calls.find(([u, o]) => u.endsWith('/clipes-reais') && o?.method === 'POST')[1].body)
    expect(corpo).toEqual({ modo: 'clipe', semMarca: false, kills: [{ tick: 9000, round: 4, pov: 'amigo' }] })
    expect(await screen.findByText('Gravando no CS2…')).toBeInTheDocument()
  })

  it('sem Premium: avisa e não mostra o seletor', async () => {
    mockApi({ lista: { disponivel: true, permitido: false, clipes: [] } })
    render(<SecaoClipeReal matchId="m1" jogadores={JOGADORES} viewerSteamId="eu" />)
    expect(await screen.findByText('Clipe de vídeo é para Jogador Premium')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Gerar/ })).not.toBeInTheDocument()
  })

  it('Fails lista as mortes do Jogador e pede na visão dele', async () => {
    const post = vi.fn().mockReturnValue(resposta({ clipes: [] }))
    const fetchMock = mockApi({ post })
    const user = userEvent.setup()
    render(<SecaoClipeReal matchId="m1" jogadores={JOGADORES} viewerSteamId="eu" />)
    await user.click(await screen.findByText('Fails'))
    await user.click(await screen.findByRole('checkbox', { name: /Round 8: rival/ }))
    expect(screen.queryByText('Visão de quem morreu')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => u.includes('/kills?vitima=eu'))).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Gerar Fails (1 morte)' }))
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(JSON.parse(post.mock.calls[0][0].body)).toEqual({ modo: 'fails', semMarca: false, kills: [{ tick: 20000, round: 8, pov: 'eu' }] })
  })

  it('sem marca d\'água: mostra quanto a mais custa e manda a escolha no pedido', async () => {
    const post = vi.fn().mockReturnValue(resposta({ clipes: [] }))
    mockApi({ post })
    const user = userEvent.setup()
    render(<SecaoClipeReal matchId="m1" jogadores={JOGADORES} viewerSteamId="eu" />)
    await user.click(await screen.findByRole('checkbox', { name: /Round 6/ }))
    expect(await screen.findByText(/\+2 créditos \(\+R\$\s0,38\)/)).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Sem a marca d'água/ }))
    await user.click(screen.getByRole('button', { name: 'Gerar clipe' }))
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(JSON.parse(post.mock.calls[0][0].body)).toMatchObject({ semMarca: true })
  })

  it('montagem esperando a junção mostra o status, sem player', async () => {
    mockApi({ lista: { disponivel: true, permitido: true, clipes: [{ id: 'c1', status: 'juntando', kills: [{ round: 4 }, { round: 6 }], videos: [], pedidoPor: { nick: 'fih' } }] } })
    const { container } = render(<SecaoClipeReal matchId="m1" jogadores={JOGADORES} viewerSteamId="eu" />)
    expect(await screen.findByText('Juntando os trechos…')).toBeInTheDocument()
    expect(container.querySelector('video')).toBeNull()
  })

  it('mostra o custo em créditos e reais enquanto marca as kills', async () => {
    const fetchMock = mockApi()
    const user = userEvent.setup()
    render(<SecaoClipeReal matchId="m1" jogadores={JOGADORES} viewerSteamId="eu" />)
    await user.click(await screen.findByRole('checkbox', { name: /Round 6/ }))
    expect(await screen.findByText('5 créditos')).toBeInTheDocument()
    expect(screen.getByText(/inclui 1 da leitura da Demo/)).toBeInTheDocument()
    expect(screen.getByText(/R\$\s0,95/)).toBeInTheDocument()
    // Estimar não pede o clipe.
    expect(fetchMock.mock.calls.some(([u, o]) => u.endsWith('/clipes-reais') && o?.method === 'POST')).toBe(false)
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
          { id: 'c1', status: 'pronto', kills: [{ round: 4 }], videos: ['https://cdn.demo-slap.net/v1.mp4'], pedidoPor: { nick: 'fih' } },
          { id: 'c2', status: 'erro', erro: 'Not enough credits', kills: [{ round: 6 }], pedidoPor: { nick: 'fih' } },
        ],
      },
    })
    const { container } = render(<SecaoClipeReal matchId="m1" jogadores={JOGADORES} viewerSteamId="eu" />)
    expect(await screen.findByRole('link', { name: 'Baixar vídeo' })).toHaveAttribute('href', 'https://cdn.demo-slap.net/v1.mp4')
    expect(container.querySelector('video')).toHaveAttribute('src', 'https://cdn.demo-slap.net/v1.mp4')
    expect(screen.getByText('Not enough credits')).toBeInTheDocument()
  })

  it('montagem toca os trechos em sequência e deixa escolher o trecho', async () => {
    const videos = ['https://cdn.demo-slap.net/v1.mp4', 'https://cdn.demo-slap.net/v2.mp4']
    mockApi({ lista: { disponivel: true, clipes: [{ id: 'c1', status: 'pronto', kills: [{ round: 4 }, { round: 6 }], videos, pedidoPor: { nick: 'fih' } }] } })
    const user = userEvent.setup()
    const { container } = render(<SecaoClipeReal matchId="m1" jogadores={JOGADORES} viewerSteamId="eu" />)
    expect(await screen.findByRole('link', { name: 'Baixar trecho 1' })).toHaveAttribute('href', videos[0])
    const video = container.querySelector('video')
    fireEvent.ended(video)
    expect(video).toHaveAttribute('src', videos[1])
    expect(screen.getByRole('button', { name: 'Trecho 2' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.ended(video)
    expect(video).toHaveAttribute('src', videos[1])
    await user.click(screen.getByRole('button', { name: 'Trecho 1' }))
    expect(video).toHaveAttribute('src', videos[0])
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
