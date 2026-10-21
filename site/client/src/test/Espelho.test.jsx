// site/client/src/test/Espelho.test.jsx
// Escopo: o "Frente a frente" da Partida — os 10 jogadores como colunas, stats como
// linhas com o rótulo no trilho do meio, e as lentes Geral/Duelos/Utilitária/Armas/Contra.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Espelho from '../components/partida/Espelho.jsx'

const jogador = (steamId, nick, team, extra = {}) => ({
  steamId, nick, team, kills: 10, deaths: 10, assists: 2, headshotKills: 5, damage: 1600, roundsPlayed: 20,
  kastPct: 70, rating: 1.0, isTracked: false, weapons: [], utilitaria: {}, ...extra,
})

const TIME_A = [
  jogador('a1', 'fih', 'A', { kills: 25, rating: 1.5, isTracked: true, weapons: [{ weapon: 'deagle', kills: 9, hsKills: 6 }] }),
  jogador('a2', 'bronze', 'A', { kills: 5, rating: 0.6, isTracked: true, utilitaria: { flashesThrown: 7, enemiesFlashed: 4, enemyFlashDuration: 12.4 } }),
]
const TIME_B = [
  jogador('b1', 'kalachi', 'B', { kills: 18, rating: 1.2, weapons: [{ weapon: 'ak47', kills: 12, hsKills: 4 }] }),
]

function montar(props = {}) {
  return render(
    <MemoryRouter>
      <Espelho
        matchId="m1" timeA={TIME_A} timeB={TIME_B} timeDoGrupo="A"
        jogadorLogado={null} lado="all" onLado={() => {}} onDetalhe={() => {}} {...props}
      />
    </MemoryRouter>,
  )
}

function linha(rotulo) {
  return screen.getByRole('rowheader', { name: new RegExp(rotulo) }).closest('tr')
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Espelho — lente Geral', () => {
  it('mostra os 10 como colunas e cada stat uma vez só, no trilho', () => {
    montar()
    expect(screen.getAllByRole('rowheader', { name: /Kills/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /fih/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /kalachi/ })).toBeInTheDocument()
  })

  it('estrela só no melhor valor da Partida inteira', () => {
    montar()
    const kills = linha('Kills')
    expect(within(kills).getAllByTitle('Melhor da partida')).toHaveLength(1)
    expect(within(kills).getByTitle('Melhor da partida').parentElement).toHaveTextContent('25')
  })

  it('resumo de cada time no trilho (soma de kills)', () => {
    montar()
    // Time A: 25 + 5 = 30; Time B: 18
    expect(linha('Kills')).toHaveTextContent('30')
    expect(linha('Kills')).toHaveTextContent('18')
  })
})

describe('Espelho — outras lentes', () => {
  it('Utilitária mostra cegou inimigo com os segundos', () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Utilitária' }))
    expect(linha('Cegou inimigo')).toHaveTextContent('12s')
  })

  it('Armas lista cada arma com kills na Partida', () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Armas' }))
    expect(linha('Desert Eagle')).toHaveTextContent('9')
    expect(linha('AK-47')).toHaveTextContent('12')
  })

  it('Duelos busca /duelos e mostra trocas feitas', async () => {
    const base = {
      aberturas: 2, aberturasGanhas: 1, aberturasPerdidas: 1, aberturasPct: 50,
      porLado: { CT: { pct: 100 }, T: { pct: 0 } }, mortes: 4, mortesTrocadas: 1, mortesSemTroca: 3, mortesTrocadasPct: 25, trocasFeitas: 0,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jogadores: [{ steamId: 'a1', team: 'A', ...base, trocasFeitas: 7 }, { steamId: 'b1', team: 'B', ...base }] }),
    }))
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Duelos' }))
    expect(await screen.findByRole('rowheader', { name: /Trocas feitas/ })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/matches/m1/duelos')
    expect(linha('Trocas feitas')).toHaveTextContent('7')
  })

  it('Duelos com erro mostra estado de erro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => null }))
    montar({ matchId: 'm-erro' })
    fireEvent.click(screen.getByRole('tab', { name: 'Duelos' }))
    expect(await screen.findByText('Não deu pra carregar os duelos dessa partida.')).toBeInTheDocument()
  })

  it('focar num jogador libera a lente Contra, com o duelo dele por adversário', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        oponentes: [{
          steamId: 'b1', nick: 'kalachi', kills: 4, deaths: 2, dano: 520, danoRecebido: 300,
          killsPorCategoria: { Rifles: 3 }, killsPorCategoriaRecebido: { Rifles: 1 },
          flashes: { porMim: { vezes: 1 }, porEle: { vezes: 0 } },
        }],
      }),
    }))
    montar()
    expect(screen.queryByRole('tab', { name: /Contra/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /fih/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Contra fih' }))
    expect(await screen.findByRole('rowheader', { name: /Dano causado/ })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/matches/m1/head-to-head/a1')
    expect(linha('Dano causado')).toHaveTextContent('520')
    expect(linha('Rifles')).toHaveTextContent('3/1')
  })
})
