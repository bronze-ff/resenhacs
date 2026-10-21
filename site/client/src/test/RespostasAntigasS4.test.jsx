import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import Clipes from '../pages/Clipes.jsx'
import JogadorPerfil from '../pages/JogadorPerfil.jsx'

const resposta = (body) => ({ ok: true, json: async () => body })
function pendente() {
  let resolve, reject
  const promise = new Promise((sim, nao) => { resolve = sim; reject = nao })
  return { promise, resolve, reject }
}
const perfil = (nick) => ({
  jogador: { steamId: nick, nick }, stats: {
    partidas: 0, winrate: 0, kills: 0, deaths: 0, assists: 0, rounds: 0,
    entryKills: 0, entryDeaths: 0, entryWins: 0, clutchWins: 0, clutchAttempts: 0,
    accuracy: 0, hsPct: 0, adr: 0, kd: 0,
  },
  evolucao: [], badges: [], estilo: null, armas: [], economia: null,
  destaques: [], porMapa: [], recentes: [], sinergia: [], clipes: [],
})
function TrocarPerfil() {
  const navegar = useNavigate()
  return <button onClick={() => navegar('/jogador/novo')}>Trocar Jogador</button>
}
afterEach(() => vi.unstubAllGlobals())

describe('S4 — respostas de seleções antigas', () => {
  it.each(['sucesso', 'erro'])('Perfil ignora resposta antiga: %s', async (tipo) => {
    const antiga = pendente()
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url === '/api/profile/antigo') return antiga.promise
      if (url === '/api/profile/novo') return Promise.resolve(resposta(perfil('Atual')))
      return Promise.resolve({ ok: false })
    }))
    render(<MemoryRouter initialEntries={['/jogador/antigo']}>
      <TrocarPerfil />
      <Routes><Route path="/jogador/:steamId" element={<JogadorPerfil />} /></Routes>
    </MemoryRouter>)
    fireEvent.click(screen.getByText('Trocar Jogador'))
    expect(await screen.findByRole('heading', { name: 'Atual' })).toBeInTheDocument()
    await act(async () => tipo === 'sucesso'
      ? antiga.resolve(resposta(perfil('Antigo'))) : antiga.reject(new Error('offline')))
    expect(screen.getByRole('heading', { name: 'Atual' })).toBeInTheDocument()
    expect(screen.queryByText('Jogador não encontrado.')).not.toBeInTheDocument()
  }, 15000)

  it.each(['sucesso', 'erro'])('Clipes ignora período antigo: %s', async (tipo) => {
    const antiga = pendente()
    vi.stubGlobal('fetch', vi.fn((url) => url.endsWith('sempre')
      ? antiga.promise : Promise.resolve(resposta({ clipes: [{
        id: 'novo', steamId: '1', nick: 'Atual', pontuacao: { total: 5 },
        map: 'de_mirage', kind: 'ace', clipUrl: 'https://allstar.gg/clip/novo',
      }] }))))
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Semana' }))
    expect(await screen.findByText('Atual')).toBeInTheDocument()
    await act(async () => tipo === 'sucesso'
      ? antiga.resolve(resposta({ clipes: [] })) : antiga.reject(new Error('offline')))
    expect(screen.getByText('Atual')).toBeInTheDocument()
    expect(screen.queryByText('Nenhum clipe nesse período ainda.')).not.toBeInTheDocument()
  })
})
