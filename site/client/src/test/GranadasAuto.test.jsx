import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Granadas from '../pages/Granadas.jsx'
import {
  DICA_TREINO, filtrarClusters, linkReplay, nomeLineup, vetorMira, descreverPitch, enquadrar,
} from '../components/granadas/lineupAuto.js'

vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ jogador: { steamId: '765', isSuperAdmin: false } }) }))

const CLUSTER_SMOKE = {
  id: 'c-l1', map: 'de_mirage', tipo: 'smoke', lado: 'T', total: 5, usosGrupo: 3, usosPro: 2,
  arremessoX: 0.8, arremessoY: 0.7, alvoX: 0.5, alvoY: 0.3, yaw: 135.5, pitch: -20.25,
  jogadores: [{ steamId: '765', nick: 'bronze', usos: 2 }, { steamId: '766', nick: 'amigo', usos: 1 }],
  pros: [{ nick: 'ZywOo', usos: 2 }],
  exemplo: { matchId: 'm-9', roundNumber: 4, tick: 7777, frame: 52, origem: 'grupo' },
  mundo: { x: 1136, y: -255.5, z: -167.97, yaw: 135.5, pitch: -20.25 },
  comando: 'setpos 1136.00 -255.50 -167.97; setang -20.25 135.50 0',
}
const CLUSTER_FLASH = {
  ...CLUSTER_SMOKE, id: 'c-l2', tipo: 'flash', lado: 'CT', total: 1, usosGrupo: 0, usosPro: 1,
  jogadores: [], pros: [{ nick: 's1mple', usos: 1 }],
  exemplo: { matchId: 'pro-1', roundNumber: 2, tick: 10, frame: null, origem: 'pro' },
  mundo: null, comando: null,
}

function montar(url = '/granadas?map=de_mirage', clusters = [CLUSTER_SMOKE, CLUSTER_FLASH]) {
  const fetchMock = vi.fn().mockImplementation((u) => {
    if (String(u).startsWith('/api/granadas/automaticas')) return Promise.resolve({ ok: true, json: async () => clusters })
    return Promise.resolve({ ok: true, json: async () => [] })
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/granadas" element={<Granadas />} />
        <Route path="/partida/:id" element={<p>pagina da partida</p>} />
      </Routes>
    </MemoryRouter>,
  )
  return fetchMock
}

afterEach(() => { vi.unstubAllGlobals() })

describe('lineupAuto helpers', () => {
  it('linkReplay monta round/tick/frame e só abre partida do grupo', () => {
    expect(linkReplay(CLUSTER_SMOKE.exemplo)).toBe('/partida/m-9?round=4&tick=7777&frame=52')
    expect(linkReplay({ ...CLUSTER_SMOKE.exemplo, frame: null })).toBe('/partida/m-9?round=4&tick=7777')
    expect(linkReplay(CLUSTER_FLASH.exemplo)).toBeNull()
  })

  it('vetorMira: yaw 0 = direita, 90 = pra cima no radar', () => {
    const leste = vetorMira(0)
    expect(leste.dx).toBeCloseTo(1)
    expect(leste.dy).toBeCloseTo(0)
    const norte = vetorMira(90)
    expect(norte.dx).toBeCloseTo(0)
    expect(norte.dy).toBeCloseTo(-1)
  })

  it('descreverPitch: negativo é pra cima', () => {
    expect(descreverPitch(-20)).toBe('pra cima')
    expect(descreverPitch(15)).toBe('pra baixo')
    expect(descreverPitch(0.5)).toBe('reto')
  })

  it('nomeLineup usa a chamada mais próxima do alvo e do arremesso', () => {
    const callouts = [{ nome: 'Jungle', x: 0.51, y: 0.31 }, { nome: 'T spawn', x: 0.79, y: 0.71 }]
    expect(nomeLineup(CLUSTER_SMOKE, callouts)).toBe('Smoke em Jungle, de T spawn')
    expect(nomeLineup(CLUSTER_SMOKE, [])).toBe('Smoke')
  })

  it('enquadrar fica dentro do radar', () => {
    const v = enquadrar({ arremessoX: 0.99, arremessoY: 0.99, alvoX: 0.98, alvoY: 0.97 })
    expect(v.x + v.lado).toBeLessThanOrEqual(100)
    expect(v.y + v.lado).toBeLessThanOrEqual(100)
  })

  it('filtrarClusters por tipo, lado e origem', () => {
    const todos = [CLUSTER_SMOKE, CLUSTER_FLASH]
    expect(filtrarClusters(todos, { tipo: 'flash' })).toEqual([CLUSTER_FLASH])
    expect(filtrarClusters(todos, { lado: 'T' })).toEqual([CLUSTER_SMOKE])
    expect(filtrarClusters(todos, { origem: 'grupo' })).toEqual([CLUSTER_SMOKE])
    expect(filtrarClusters(todos, { origem: 'pro' })).toHaveLength(2)
  })
})

describe('Granadas — modo Automático', () => {
  it('é o padrão: busca /automaticas do mapa e lista os lineups', async () => {
    const fetchMock = montar()
    const lista = await screen.findByRole('region', { name: 'Lineups mais usados' })
    expect(within(lista).getAllByRole('button')).toHaveLength(2)
    expect(within(lista).getByText(/mais usa: bronze/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/granadas/automaticas?map=de_mirage')
    expect(screen.getByRole('tab', { name: 'Automático' })).toHaveAttribute('aria-selected', 'true')
  })

  it('filtro de lado esconde o que não bate', async () => {
    montar()
    const lista = await screen.findByRole('region', { name: 'Lineups mais usados' })
    fireEvent.click(screen.getByRole('tab', { name: 'CT' }))
    await waitFor(() => expect(within(lista).getAllByRole('button')).toHaveLength(1))
    expect(within(lista).getByText(/pro: s1mple/)).toBeInTheDocument()
  })

  it('detalhe: copia o comando de treino e linka o Replay 2D', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    montar()
    const lista = await screen.findByRole('region', { name: 'Lineups mais usados' })
    fireEvent.click(within(lista).getByText(/mais usa: bronze/))
    expect(await screen.findByText(CLUSTER_SMOKE.comando)).toBeInTheDocument()
    expect(screen.getByText(DICA_TREINO)).toBeInTheDocument()
    expect(screen.getByText('ZywOo')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar comando de treino' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CLUSTER_SMOKE.comando))
    expect(await screen.findByText('✓ Copiado.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver no Replay 2D/ }))
      .toHaveAttribute('href', '/partida/m-9?round=4&tick=7777&frame=52')
  })

  it('lineup só de pro e sem coordenada de mundo: sem comando nem link', async () => {
    montar()
    const lista = await screen.findByRole('region', { name: 'Lineups mais usados' })
    fireEvent.click(within(lista).getByText(/pro: s1mple/))
    expect(await screen.findByText(/Sem coordenada de altura/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Ver no Replay 2D/ })).toBeNull()
  })

  it('mapa sem lineups: estado vazio explicando que vem das Demos', async () => {
    montar('/granadas?map=de_mirage', [])
    expect(await screen.findByText('Nenhum lineup nesse mapa ainda.')).toBeInTheDocument()
  })

  it('aba Curadas troca pra biblioteca manual', async () => {
    // RadarGranadas (curadas) detecta touch por matchMedia, que o jsdom não tem.
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    const fetchMock = montar()
    await screen.findByRole('region', { name: 'Lineups mais usados' })
    fireEvent.click(screen.getByRole('tab', { name: 'Curadas' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/granadas?map=de_mirage&lado=T'))
    expect(screen.getByRole('tab', { name: 'Curadas' })).toHaveAttribute('aria-selected', 'true')
  })
})
