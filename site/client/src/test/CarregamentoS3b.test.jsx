// site/client/src/test/CarregamentoS3b.test.jsx
// Onda 1, S3b: carregamento do Replay 2D por round (R15, R98), resposta antiga ignorada
// (R99), "Carregar mais" destravado ao trocar filtro (R100) e estados do ReplayDemo (R101).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'
import { SecaoReplay } from '../pages/Partida.jsx'
import Partida from '../pages/Partida.jsx'
import Comparar from '../pages/Comparar.jsx'
import Feed from '../pages/Feed.jsx'
import ReplayDemo from '../pages/ReplayDemo.jsx'
import CardTaticaReplay from '../components/taticas/CardTaticaReplay.jsx'

afterEach(() => { vi.unstubAllGlobals() })

const ok = (corpo) => Promise.resolve({ ok: true, status: 200, json: async () => corpo })
const falha = (status = 500) => Promise.resolve({ ok: false, status, json: async () => ({}) })

// Promessa que o teste resolve na hora que quiser (resposta atrasada).
function adiada() {
  let resolver
  const promessa = new Promise((r) => { resolver = r })
  return { promessa, resolver }
}

const INDICE = { map: 'de_mirage', calibrated: true, tickRate: 10, names: {}, rounds: [{ round: 1 }, { round: 2 }] }
const ROUND = (n) => ({ round: n, frames: [{ t: 0, players: [] }, { t: 1, players: [] }], kills: [], hits: [] })

describe('R98 — erro por round no Replay 2D', () => {
  it('round que falhou mostra "Tentar de novo" só nele e recupera', async () => {
    let round2Falha = true
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      const u = String(url)
      if (u === '/r') return ok(INDICE)
      if (u === '/r/round/1') return ok(ROUND(1))
      if (u === '/r/round/2') return round2Falha ? falha() : ok(ROUND(2))
      return ok({})
    }))
    render(<MemoryRouter><SecaoReplay replayUrl="/r" seek={null} onSelecionarPonto={() => {}} /></MemoryRouter>)
    const grupo = await screen.findByRole('group', { name: /replay 2d/i })
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/r/round/2'))
    expect(screen.queryByText(/não deu para carregar o round/i)).not.toBeInTheDocument()
    fireEvent.keyDown(grupo, { key: '.' })
    expect(await screen.findByText('Não deu para carregar o round 2.')).toBeInTheDocument()
    round2Falha = false
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(screen.queryByText('Não deu para carregar o round 2.')).not.toBeInTheDocument())
    fireEvent.keyDown(grupo, { key: ',' })
    expect(screen.queryByText(/não deu para carregar o round/i)).not.toBeInTheDocument()
  })

  it('erro do índice tem "Tentar de novo"', async () => {
    let indiceFalha = true
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      const u = String(url)
      if (u === '/r') return indiceFalha ? falha() : ok(INDICE)
      return ok(ROUND(Number(u.split('/').pop())))
    }))
    render(<MemoryRouter><SecaoReplay replayUrl="/r" seek={null} onSelecionarPonto={() => {}} /></MemoryRouter>)
    expect(await screen.findByText('Não foi possível carregar o replay.')).toBeInTheDocument()
    indiceFalha = false
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('group', { name: /replay 2d/i })).toBeInTheDocument()
  })
})

describe('R15 — CardTaticaReplay usa o carregamento por round', () => {
  it('busca o índice e depois /replay/round/:n', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      const u = String(url)
      if (u === '/api/matches/m9/replay') return ok(INDICE)
      return ok(ROUND(Number(u.split('/').pop())))
    }))
    render(<MemoryRouter><CardTaticaReplay t={{ id: 't1', matchId: 'm9', roundNumber: 2, nome: 'Rush B', descricao: '', criadoPor: 'x' }} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /rush b/i }))
    expect(await screen.findByRole('img', { name: /round 2/i })).toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/matches/m9/replay/round/2'))
  })
})

describe('R99 — resposta antiga é ignorada', () => {
  const partida = (id, mapa) => ({
    id, map: mapa, playedAt: '2026-07-20T22:00:00.000Z', scoreA: 13, scoreB: 9, source: 'valve_mm', temDemo: true,
    plataformaManual: null, status: 'parsed', demoUrl: null, replayUrl: null, endedEarly: false, abandonedBy: null,
    demoUpload: null, players: [], rounds: [], highlights: [], clips: [], economia: [], mvp: null,
  })

  it('Partida: trocar de :id com a resposta antiga chegando depois mostra a Partida nova', async () => {
    const antiga = adiada()
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      const u = String(url)
      if (u === '/api/matches/p1') return antiga.promessa
      if (u === '/api/matches/p2') return ok(partida('p2', 'de_nuke'))
      return ok({ ativa: null })
    }))
    render(
      <MemoryRouter initialEntries={['/partida/p1']}>
        <Link to="/partida/p2">ir p2</Link>
        <Routes><Route path="/partida/:id" element={<Partida />} /></Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('link', { name: 'ir p2' }))
    expect((await screen.findAllByText(/nuke/i)).length).toBeGreaterThan(0)
    await act(async () => { antiga.resolver({ ok: true, status: 200, json: async () => partida('p1', 'de_ancient') }) })
    expect(screen.queryAllByText(/ancient/i)).toHaveLength(0)
    expect(screen.getAllByText(/nuke/i).length).toBeGreaterThan(0)
  })

  it('Comparar: trocar a seleção descarta a comparação anterior', async () => {
    const antiga = adiada()
    const JOGADORES = [{ steamId: '1', nick: 'aa' }, { steamId: '2', nick: 'bb' }, { steamId: '3', nick: 'cc' }]
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      const u = String(url)
      if (u === '/api/players') return ok(JOGADORES)
      if (u.includes('a=1&b=2')) return antiga.promessa
      if (u.includes('a=1&b=3')) return falha()
      return ok({})
    }))
    render(<MemoryRouter initialEntries={['/comparar?a=1&b=2']}><Comparar /></MemoryRouter>)
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('a=1&b=2')))
    fireEvent.click(await screen.findByRole('button', { name: 'bb' }))
    fireEvent.click(await screen.findByRole('option', { name: 'cc' }))
    expect(await screen.findByText('Não foi possível comparar esses Jogadores.')).toBeInTheDocument()
    await act(async () => { antiga.resolver({ ok: true, status: 200, json: async () => ({ resposta: 'antiga' }) }) })
    expect(screen.getByText('Não foi possível comparar esses Jogadores.')).toBeInTheDocument()
  })
})

describe('R100 — Feed destrava "Carregar mais" ao trocar filtro', () => {
  it('"Carregar mais" pendente + troca de filtro + resposta atrasada', async () => {
    const pagina = (prefixo) => Array.from({ length: 20 }, (_, i) => ({
      id: `${prefixo}${i}`, map: 'de_inferno', playedAt: '2026-10-13T21:05:00Z', scoreA: 13, scoreB: 9, source: 'valve_mm',
      temDemo: true, tracked: [], mvp: null, highlights: 0,
    }))
    const pagina2 = adiada()
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      const u = String(url)
      if (u.startsWith('/api/matches?') && u.includes('offset=20')) return pagina2.promessa
      if (u.startsWith('/api/matches?') && u.includes('source=upload')) return ok(pagina('u'))
      if (u.startsWith('/api/matches?')) return ok(pagina('m'))
      return ok([])
    }))
    render(<MemoryRouter><Feed /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }))
    expect(await screen.findByRole('button', { name: 'Carregando…' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Manual' }))
    expect(await screen.findByRole('button', { name: 'Carregar mais' })).toBeEnabled()
    await act(async () => { pagina2.resolver({ ok: true, status: 200, json: async () => pagina('velha') }) })
    expect(screen.getByRole('button', { name: 'Carregar mais' })).toBeEnabled()
    expect(document.querySelector('a[href="/partida/velha0"]')).toBeNull()
  })
})

describe('R101 — ReplayDemo', () => {
  it('erro mostra "Tentar de novo" e recupera', async () => {
    let falhar = true
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => (falhar ? Promise.reject(new TypeError('offline')) : ok({ ...INDICE, rounds: [ROUND(1)] }))))
    render(<MemoryRouter><ReplayDemo /></MemoryRouter>)
    expect(await screen.findByText('Não deu para carregar o Replay 2D de exemplo.')).toBeInTheDocument()
    falhar = false
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('group', { name: /replay 2d/i })).toBeInTheDocument()
  })

  it('replay sem rounds mostra vazio', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => ok({ ...INDICE, rounds: [] })))
    render(<MemoryRouter><ReplayDemo /></MemoryRouter>)
    expect(await screen.findByText('O replay de exemplo está vazio.')).toBeInTheDocument()
  })
})
