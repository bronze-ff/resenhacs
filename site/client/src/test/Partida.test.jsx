// site/client/src/test/Partida.test.jsx
// Escopo: o destaque do MVP na página da Partida (FIL-56) — o mesmo MVP que o card
// dessa partida já mostra no Feed, que antes não aparecia em lugar nenhum no detalhe.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Partida from '../pages/Partida.jsx'

const PARTIDA_BASE = {
  id: 'm1',
  map: 'de_mirage',
  playedAt: '2026-07-20T22:00:00.000Z',
  scoreA: 13,
  scoreB: 9,
  source: 'valve_mm',
  temDemo: true,
  plataformaManual: null,
  status: 'parsed',
  demoUrl: null,
  replayUrl: null,
  endedEarly: false,
  abandonedBy: null,
  demoUpload: null,
  players: [
    {
      steamId: '765', nick: 'fih', avatarUrl: null, team: 'A', kills: 25, teamKills: 0, deaths: 10,
      assists: 5, headshotKills: 12, damage: 2500, roundsPlayed: 22, rating: 1.35, kastPct: 72.5,
      won: true, isTracked: true, weapons: [], allstarClip: null, duelWinPct: 71.4,
      utilitaria: {},
    },
  ],
  rounds: [],
  highlights: [],
  clips: [],
  economia: [],
  mvp: null,
}

function montar(partida) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
    if (String(url).includes('/api/competicoes')) {
      return Promise.resolve({ ok: true, json: async () => ({ ativa: null }) })
    }
    return Promise.resolve({ ok: true, json: async () => partida })
  }))
  return render(
    <MemoryRouter initialEntries={['/partida/m1']}>
      <Routes>
        <Route path="/partida/:id" element={<Partida />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Partida — destaque do MVP', () => {
  it('exibe o destaque com avatar, nick e rating do MVP', async () => {
    montar({
      ...PARTIDA_BASE,
      mvp: { steamId: '765', nick: 'fih', rating: 1.35, avatarUrl: 'https://avatars.steamstatic.com/fih.jpg' },
    })
    expect(await screen.findByText('MVP')).toBeInTheDocument()
    const destaque = screen.getByText('MVP').parentElement
    expect(destaque).toHaveTextContent('fih')
    expect(destaque).toHaveTextContent('1.35')
    // Avatar vem do próprio payload (coalesce players/steam_avatares no servidor) —
    // o client não monta URL de avatar por conta própria.
    expect(destaque.querySelector('img')).toHaveAttribute('src', 'https://avatars.steamstatic.com/fih.jpg')
  })

  it('não exibe o destaque quando mvp é null (nenhum jogador do grupo na partida)', async () => {
    montar({ ...PARTIDA_BASE, mvp: null })
    // espera a partida carregar de fato antes de afirmar a ausência
    expect(await screen.findByText(/mirage/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('MVP')).toBeNull())
  })

  it('não exibe o destaque quando o MVP não tem rating (partida antiga, sem o dado)', async () => {
    montar({ ...PARTIDA_BASE, mvp: { steamId: '765', nick: 'fih', rating: null, avatarUrl: null } })
    expect(await screen.findByText(/mirage/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('MVP')).toBeNull())
  })
})

async function abrirClipeDoJogador(partida) {
  montar(partida)
  // Sem abas: os Clipes ficam numa seção própria no fim da página. O nick também aparece
  // no Frente a frente, então a busca fica restrita à região dos Clipes.
  const clipes = await screen.findByRole('region', { name: 'Clipes' })
  const [seletor] = within(clipes).getAllByRole('button', { name: /fih/i })
  fireEvent.click(seletor)
}

describe('Partida — clipe sem demo arquivada', () => {
  it('FACEIT sem Demo integra um único aviso na seção de Clipes sem seletor de eventos', async () => {
    montar({ ...PARTIDA_BASE, source: 'faceit', temDemo: false, faceitMatchId: '1-4a9a2655-8247-4f0b-b532-9b710fc6eb87' })
    const clipes = await screen.findByRole('region', { name: 'Clipes' })
    expect(within(clipes).getByText('Partida FACEIT sem Demo: kills, mortes por round e clipes precisam do arquivo .dem')).toBeInTheDocument()
    expect(screen.getAllByRole('region', { name: 'Partida sem demo' })).toHaveLength(1)
    expect(within(clipes).getByRole('link', { name: /sala da FACEIT/i })).toHaveAttribute('href', 'https://www.faceit.com/en/cs2/room/1-4a9a2655-8247-4f0b-b532-9b710fc6eb87')
    expect(within(clipes).queryByRole('radio', { name: 'Clipe' })).not.toBeInTheDocument()
    expect(fetch.mock.calls.some(([url]) => url.includes('/kills?'))).toBe(false)
  })

  it('esconde gerar clipe quando demoUrl é nulo', async () => {
    await abrirClipeDoJogador({ ...PARTIDA_BASE, demoUrl: null })
    expect(screen.queryByRole('button', { name: /gerar melhor clipe/i })).toBeNull()
    expect(screen.getByText(/demo não arquivada/i)).toBeInTheDocument()
  })

  it('mostra gerar clipe quando a demo ainda está no R2', async () => {
    await abrirClipeDoJogador({ ...PARTIDA_BASE, demoUrl: '/api/matches/m1/demo' })
    expect(screen.getByRole('button', { name: /gerar melhor clipe/i })).toBeEnabled()
  })

  it('não oferece tentar de novo quando a demo já saiu', async () => {
    await abrirClipeDoJogador({
      ...PARTIDA_BASE,
      demoUrl: null,
      players: [{ ...PARTIDA_BASE.players[0], allstarClip: { status: 'Error', clipUrl: null } }],
    })
    expect(screen.queryByRole('button', { name: /tentar de novo/i })).toBeNull()
    expect(screen.getByText(/demo não arquivada/i)).toBeInTheDocument()
  })

  it('clipe já pronto continua assistível sem a demo', async () => {
    await abrirClipeDoJogador({
      ...PARTIDA_BASE,
      demoUrl: null,
      players: [{
        ...PARTIDA_BASE.players[0],
        allstarClip: { status: 'Processed', clipUrl: 'https://allstar.gg/iframe?clip=abc', roundNumber: 3 },
      }],
    })
    expect(screen.getByRole('button', { name: /assistir/i })).toBeInTheDocument()
  })
})

describe('Partida — deep link de round (Granadas: "Ver no Replay 2D")', () => {
  it('?round=&tick=&frame= rola até o Replay 2D', async () => {
    // jsdom não implementa scrollIntoView (a Partida rola até o Replay 2D ao abrir)
    Element.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      if (String(url).includes('/api/competicoes')) {
        return Promise.resolve({ ok: true, json: async () => ({ ativa: null }) })
      }
      return Promise.resolve({ ok: true, json: async () => PARTIDA_BASE })
    }))
    render(
      <MemoryRouter initialEntries={['/partida/m1?round=3&tick=5555&frame=40']}>
        <Routes>
          <Route path="/partida/:id" element={<Partida />} />
        </Routes>
      </MemoryRouter>,
    )
    // replayUrl null -> a seção do Replay 2D mostra o estado de indisponível
    expect(await screen.findByText('Replay 2D indisponível')).toBeInTheDocument()
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
  })
})
