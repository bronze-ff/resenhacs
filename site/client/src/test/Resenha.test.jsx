// site/client/src/test/Resenha.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Resenha, { manchete, rotuloPeriodo } from '../pages/Resenha.jsx'
import Rivalidades from '../components/perfil/Rivalidades.jsx'

afterEach(() => { vi.unstubAllGlobals() })

const PAYLOAD = {
  periodo: { tipo: 'mes', inicio: '2026-09-01', fim: '2026-10-01', anterior: '2026-08-01', proximo: '2026-10-01' },
  numeros: { partidas: 64, horas: 52.5, vitorias: 30, derrotas: 24, winrate: 55.6, clutches: 9 },
  premios: [
    { id: 'carregou', titulo: 'Carregou', descricao: 'Maior rating médio (mín. 4 partidas)', jogadores: [{ steamId: '1', nick: 'Toguro', avatarUrl: null }], valor: 1.24, formato: 'decimal2', tom: 'bom' },
    { id: 'dupla', titulo: 'Dupla imbatível', descricao: 'Winrate jogando juntos (8/11)', jogadores: [{ steamId: '1', nick: 'Toguro', avatarUrl: null }, { steamId: '2', nick: 'zezinho', avatarUrl: null }], valor: 72.7, formato: 'pct100', tom: 'bom' },
    { id: 'mapa-maldito', titulo: 'Mapa maldito', descricao: 'Pior winrate do grupo (4V 9D)', jogadores: [], mapa: 'de_nuke', valor: 30.8, formato: 'pct100', tom: 'ruim' },
  ],
}

function renderResenha(url = '/resenha?periodo=mes&ref=2026-09-10', payload = PAYLOAD) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/resenha" element={<Resenha />} />
      </Routes>
    </MemoryRouter>,
  )
  return fetchMock
}

describe('Resenha (página)', () => {
  it('mostra manchete, números e prêmios do mês', async () => {
    const fetchMock = renderResenha()
    expect(await screen.findByText('Setembro foi do Toguro. E a Nuke continua maldita.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/premios?periodo=mes&ref=2026-09-10')
    expect(screen.getByText('64')).toBeInTheDocument()
    expect(screen.getByText('52,5h')).toBeInTheDocument()
    expect(screen.getByText('56%')).toBeInTheDocument()
    expect(screen.getByText('1.24')).toBeInTheDocument()
    expect(screen.getByText('Toguro e zezinho')).toBeInTheDocument()
    expect(screen.getByText('31%')).toBeInTheDocument()
    // bom/ruim com texto + seta, não só cor
    expect(screen.getAllByText('vergonha')).toHaveLength(1)
  })

  it('navega pro período anterior', async () => {
    const fetchMock = renderResenha()
    await screen.findByText(/Setembro foi do/)
    fireEvent.click(screen.getByRole('button', { name: /mês anterior/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/premios?periodo=mes&ref=2026-08-01'))
  })

  it('sem prêmios mostra estado vazio', async () => {
    renderResenha('/resenha', { ...PAYLOAD, periodo: { ...PAYLOAD.periodo, tipo: 'semana', inicio: '2026-10-12', fim: '2026-10-19', proximo: null }, premios: [] })
    expect(await screen.findByText('Ninguém jogou o suficiente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /próxima semana/i })).toBeDisabled()
  })

  it('helpers de rótulo', () => {
    expect(rotuloPeriodo({ tipo: 'semana', inicio: '2026-10-12', fim: '2026-10-19' })).toBe('semana de 12/10 a 18/10')
    expect(manchete({ tipo: 'semana', inicio: '2026-10-12' }, [])).toBe('A semana ainda sem resenha.')
  })
})

describe('Rivalidades (Perfil)', () => {
  const jog = (steamId, nick, extra) => ({ steamId, nick, avatarUrl: null, matei: 0, morri: 0, saldo: 0, dominio: null, partidasContra: 0, partidasJuntos: 0, vitoriasJuntos: 0, winrateJuntos: null, ...extra })

  function renderRiv(payload) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }))
    render(<MemoryRouter><Rivalidades steamId="765" proprio /></MemoryRouter>)
  }

  it('mostra carrasco, freguês, duplas e tabela de duelos', async () => {
    const toguro = jog('1', 'Toguro', { matei: 3, morri: 9, saldo: -6, dominio: 25, partidasContra: 4, partidasJuntos: 5, vitoriasJuntos: 1, winrateJuntos: 20 })
    const ze = jog('2', 'zezinho', { matei: 8, morri: 2, saldo: 6, dominio: 80, partidasContra: 3, partidasJuntos: 4, vitoriasJuntos: 3, winrateJuntos: 75 })
    renderRiv({ carrasco: toguro, fregues: ze, melhorDupla: ze, piorDupla: toguro, duelos: [toguro, ze], duplas: [ze, toguro] })
    expect(await screen.findByText('Carrasco')).toBeInTheDocument()
    expect(screen.getByText('Pé-frio')).toBeInTheDocument()
    expect(screen.getByText('quem mais mata você')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByText('+6')).toBeInTheDocument()
    expect(screen.getByText('-6')).toBeInTheDocument()
  })

  it('payload inesperado não quebra (renderiza nada)', async () => {
    renderRiv({ jogador: {} })
    await waitFor(() => expect(screen.queryByText('Carregando rivalidades…')).not.toBeInTheDocument())
    expect(screen.queryByText('Carrasco')).not.toBeInTheDocument()
  })
})
