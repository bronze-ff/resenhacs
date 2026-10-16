import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SeletorKills from '../components/clipes/SeletorKills.jsx'

const EU = { steamId: 'eu', nick: 'fih' }
const AMIGO = { steamId: 'amigo', nick: 'zé' }
const INIMIGO = { steamId: 'ini', nick: 'rival' }
const INIMIGO2 = { steamId: 'ini2', nick: 'rival2' }
const JOGADORES = [
  { steamId: 'eu', nick: 'fih', isTracked: true },
  { steamId: 'amigo', nick: 'zé', isTracked: true },
]

function kill(extra) {
  return {
    round: 1, tick: 1000, killer: EU, victim: INIMIGO, assister: null, weapon: 'ak47',
    headshot: false, teamKill: false, wallbang: false, thrusmoke: false, attackerblind: false, noscope: false,
    killerX: 0, killerY: 0, victimX: 0, victimY: 0,
    ...extra,
  }
}

const KILLS = [
  kill({ tick: 1000 }),
  kill({ tick: 1200, victim: INIMIGO2, headshot: true, wallbang: true }),
  kill({ round: 2, tick: 3000, weapon: 'hegrenade', victim: AMIGO, teamKill: true }),
  kill({ round: 3, tick: 5000, weapon: 'awp', noscope: true }),
]

function mockFetch(rotas) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
    for (const [padrao, corpo] of rotas) {
      if (typeof padrao === 'string' ? url === padrao : padrao.test(url)) {
        return Promise.resolve({ ok: true, json: async () => corpo })
      }
    }
    return Promise.resolve({ ok: false, json: async () => ({}) })
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SeletorKills', () => {
  async function montar(onMudarSelecao = vi.fn()) {
    mockFetch([[/\/api\/matches\/m1\/kills\?jogador=eu$/, KILLS], [/jogador=amigo$/, []]])
    render(<SeletorKills matchId="m1" jogadores={JOGADORES} viewerSteamId="eu" onMudarSelecao={onMudarSelecao} />)
    await screen.findByText('AWP')
    return onMudarSelecao
  }

  it('busca as kills do viewer e mostra arma, vítima e marcas (TK incluso)', async () => {
    await montar()
    expect(fetch).toHaveBeenCalledWith('/api/matches/m1/kills?jogador=eu')
    expect(screen.getAllByRole('row')).toHaveLength(1 + 4)
    expect(screen.getByText('TK')).toBeInTheDocument()
    expect(screen.getByText('HS')).toBeInTheDocument()
    expect(screen.getByText('Wallbang')).toBeInTheDocument()
    expect(screen.getByText('Noscope')).toBeInTheDocument()
    expect(screen.getByText('granada')).toBeInTheDocument()
  })

  it('checkbox marca a kill e devolve a seleção', async () => {
    const onMudar = await montar()
    await userEvent.click(screen.getByLabelText(/Round 3: rival com AWP/))
    expect(onMudar).toHaveBeenLastCalledWith([KILLS[3]])
    expect(screen.getByText(/kills marcadas/)).toHaveTextContent('1 de 4 kills marcadas')
  })

  it('atalho "1 por round" pega a melhor de cada round; "Todas" marca tudo; "Limpar" zera', async () => {
    const onMudar = await montar()
    await userEvent.click(screen.getByRole('button', { name: '1 por round' }))
    expect(onMudar).toHaveBeenLastCalledWith([KILLS[1], KILLS[2], KILLS[3]])
    await userEvent.click(screen.getByRole('button', { name: 'Todas' }))
    expect(onMudar).toHaveBeenLastCalledWith(KILLS)
    await userEvent.click(screen.getByRole('button', { name: 'Limpar' }))
    expect(onMudar).toHaveBeenLastCalledWith([])
  })

  it('filtro "Só TK/granada" esconde as outras e "Todas" respeita o filtro', async () => {
    const onMudar = await montar()
    await userEvent.click(screen.getByLabelText('Só TK/granada'))
    const linhas = screen.getAllByRole('row')
    expect(linhas).toHaveLength(2)
    expect(within(linhas[1]).getByText('zé')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Todas' }))
    expect(onMudar).toHaveBeenLastCalledWith([KILLS[2]])
  })

  it('trocar de jogador busca de novo e mostra estado vazio', async () => {
    await montar()
    await userEvent.click(screen.getByRole('button', { name: /fih/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'zé' }))
    expect(await screen.findByText('Nenhuma kill nessa Partida.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/matches/m1/kills?jogador=amigo')
  })
})
