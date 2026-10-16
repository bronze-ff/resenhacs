import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SeletorKills from '../components/clipes/SeletorKills.jsx'
import GravadorClipe from '../components/clipes/GravadorClipe.jsx'
import SecaoClipe2D from '../components/clipes/SecaoClipe2D.jsx'

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

// ---------- Gravador ----------

function roundReplay(numero, killsReplay) {
  return {
    round: numero,
    frames: Array.from({ length: 80 }, (_, t) => ({
      t,
      players: [
        { id: 'eu', x: 0.2, y: 0.5, yaw: 0, alive: true, side: 'T', hp: 100 },
        { id: 'ini', x: 0.4, y: 0.5, yaw: 0, alive: true, side: 'CT', hp: 100 },
      ],
    })),
    kills: killsReplay, hits: [],
  }
}
const REPLAY_ANTIGO = {
  map: 'de_mirage', calibrated: true, tickRate: 8, names: { eu: 'fih', ini: 'rival' }, teams: {},
  rounds: [
    roundReplay(1, [{ t: 40, killer: 'eu', victim: 'ini', weapon: 'ak47', headshot: false }]),
    roundReplay(3, [{ t: 30, killer: 'eu', victim: 'ini', weapon: 'awp', headshot: false }]),
  ],
}

class MediaRecorderFalso {
  static instancias = []
  static isTypeSupported = (m) => m === 'video/webm'
  constructor(stream, opcoes) {
    this.stream = stream
    this.opcoes = opcoes
    this.state = 'inactive'
    MediaRecorderFalso.instancias.push(this)
  }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['quadro']) })
    setTimeout(() => this.onstop?.(), 0)
  }
}

class ImagemFalsa {
  set src(_) { setTimeout(() => this.onerror?.(), 0) }
}

describe('GravadorClipe (MediaRecorder mockado)', () => {
  let parar
  beforeEach(() => {
    MediaRecorderFalso.instancias = []
    parar = vi.fn()
    vi.stubGlobal('MediaRecorder', MediaRecorderFalso)
    vi.stubGlobal('Image', ImagemFalsa)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    HTMLCanvasElement.prototype.captureStream = vi.fn(() => ({ getTracks: () => [{ stop: parar }] }))
    URL.createObjectURL = vi.fn(() => 'blob:clipe')
    URL.revokeObjectURL = vi.fn()
    mockFetch([['/api/matches/m1/replay', REPLAY_ANTIGO]])
  })
  afterEach(() => { delete HTMLCanvasElement.prototype.captureStream })

  function relogio(passoMs) {
    let t = 0
    return () => { const v = t; t += passoMs; return v }
  }

  it('montagem: grava título + cenas, mostra progresso e libera "Baixar vídeo"', async () => {
    const opcoes = { agora: relogio(700), agendar: (fn) => setTimeout(fn, 0) }
    render(<GravadorClipe replayUrl="/api/matches/m1/replay" kills={[KILLS[0], KILLS[3]]} nomeArquivo="teste" opcoesGravacao={opcoes} />)
    await userEvent.click(screen.getByRole('button', { name: 'Gravar montagem 2D (2 kills)' }))

    expect(await screen.findByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    const link = await screen.findByRole('link', { name: 'Baixar vídeo' }, { timeout: 3000 })
    expect(link).toHaveAttribute('href', 'blob:clipe')
    expect(link).toHaveAttribute('download', 'teste.webm')

    const rec = MediaRecorderFalso.instancias[0]
    expect(rec.opcoes.mimeType).toBe('video/webm')
    expect(HTMLCanvasElement.prototype.captureStream).toHaveBeenCalledWith(60)
    expect(parar).toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1) // replay antigo: rounds já vêm no índice
  })

  it('cancelar interrompe a gravação e volta ao início, sem vídeo', async () => {
    const opcoes = { agora: () => 0, agendar: (fn) => setTimeout(fn, 5) }
    render(<GravadorClipe replayUrl="/api/matches/m1/replay" kills={[KILLS[0]]} opcoesGravacao={opcoes} />)
    await userEvent.click(screen.getByRole('button', { name: 'Gravar clipe 2D' }))
    await waitFor(() => expect(MediaRecorderFalso.instancias).toHaveLength(1))
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByRole('button', { name: 'Gravar clipe 2D' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Baixar vídeo' })).not.toBeInTheDocument()
    expect(MediaRecorderFalso.instancias[0].state).toBe('inactive')
  })

  it('kill fora do Replay 2D: erro explicando', async () => {
    render(<GravadorClipe replayUrl="/api/matches/m1/replay" kills={[kill({ round: 7 })]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Gravar clipe 2D' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nenhuma das kills marcadas aparece no Replay 2D.')
  })

  it('sem kill marcada o botão fica desabilitado', () => {
    render(<GravadorClipe replayUrl="/api/matches/m1/replay" kills={[]} />)
    expect(screen.getByRole('button', { name: 'Gravar clipe 2D' })).toBeDisabled()
  })

  it('navegador sem MediaRecorder: avisa em vez de oferecer o botão', () => {
    vi.stubGlobal('MediaRecorder', undefined)
    render(<GravadorClipe replayUrl="/api/matches/m1/replay" kills={[KILLS[0]]} />)
    expect(screen.getByRole('alert')).toHaveTextContent('não grava vídeo')
    expect(screen.queryByRole('button', { name: 'Gravar clipe 2D' })).not.toBeInTheDocument()
  })
})

describe('SecaoClipe2D', () => {
  it('sem Replay 2D: estado vazio explicando', () => {
    render(<SecaoClipe2D matchId="m1" replayUrl={null} mapa="de_mirage" jogadores={JOGADORES} viewerSteamId="eu" />)
    expect(screen.getByText('Clipe 2D (você escolhe as kills)')).toBeInTheDocument()
    expect(screen.getByText('Essa Partida não tem Replay 2D')).toBeInTheDocument()
  })
})
