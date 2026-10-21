import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CardPartidaFeed from '../components/feed/CardPartidaFeed.jsx'
import SessaoDeHoje, { sessaoDeHoje } from '../components/feed/SessaoDeHoje.jsx'
import AvisoRecorde from '../components/feed/AvisoRecorde.jsx'
import DesempenhoRecente from '../components/perfil/DesempenhoRecente.jsx'
import MapaAtividade, { montarGrade } from '../components/perfil/MapaAtividade.jsx'
import PontosFortes, { formatarValor } from '../components/perfil/PontosFortes.jsx'

const comRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const partida = {
  id: 'm1', map: 'de_inferno', playedAt: '2026-10-13T21:05:00Z', scoreA: 9, scoreB: 13, source: 'valve_mm',
  temDemo: true, tracked: [{ steamId: '1', nick: 'fih', won: false }], mvp: { steamId: '1', nick: 'fih', rating: 1.12 },
  highlights: 2,
}

describe('CardPartidaFeed', () => {
  it('com o viewer em campo mostra o K/D/A e o rating dele, com seta', () => {
    comRouter(<CardPartidaFeed m={{ ...partida, eu: { kills: 18, deaths: 13, assists: 9, rating: 1.12, adr: 77 } }} resultado="derrota" avatares={new Map()} />)
    expect(screen.getByText('Derrota')).toBeInTheDocument()
    expect(screen.getByText('18 / 13 / 9')).toBeInTheDocument()
    expect(screen.getByText(/1\.12/, { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByLabelText('acima de 1.00')).toBeInTheDocument()
    expect(screen.getByText('2 highlights')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/partida/m1')
  })

  it('Partida só de amigos (eu null) mostra o grupo no lugar', () => {
    comRouter(<CardPartidaFeed m={{ ...partida, eu: null }} resultado="derrota" avatares={new Map()} />)
    expect(screen.queryByText('Seu K / D / A')).not.toBeInTheDocument()
    expect(screen.getByText('Do grupo')).toBeInTheDocument()
  })

  it('o "?" do rótulo abre a explicação sem seguir o link do card', () => {
    comRouter(<CardPartidaFeed m={{ ...partida, eu: null }} resultado="derrota" avatares={new Map()} />)
    // fireEvent devolve false quando o clique teve preventDefault: o <Link> não navega.
    expect(fireEvent.click(screen.getByRole('button', { name: 'Placar' }))).toBe(false)
    expect(screen.getByRole('dialog', { name: 'Placar' })).toHaveTextContent('Rounds do seu time')
  })
})

describe('SessaoDeHoje', () => {
  const sessao = {
    inicio: '2026-10-14T19:00:00Z', fim: '2026-10-14T21:00:00Z', partidas: 3, vitorias: 2, derrotas: 1, empates: 0,
    matchIds: ['a', 'b', 'c'], destaque: { steamId: '2', nick: 'Toguro', ratingMedio: 1.28 },
  }

  it('só considera "de hoje" a sessão que terminou há menos de 12h', () => {
    const agora = new Date('2026-10-14T23:00:00Z').getTime()
    expect(sessaoDeHoje([sessao], agora)).toBe(sessao)
    expect(sessaoDeHoje([sessao], agora + 13 * 3600 * 1000)).toBeNull()
    expect(sessaoDeHoje([], agora)).toBeNull()
  })

  it('mostra V/D, quem carregou e filtra as Partidas ao clicar', () => {
    const onVer = vi.fn()
    comRouter(<SessaoDeHoje sessao={sessao} resultados={new Map([['a', 'vitoria']])} onVerSessao={onVer} />)
    expect(screen.getByText('2V')).toBeInTheDocument()
    expect(screen.getByText('1D')).toBeInTheDocument()
    expect(screen.getByText('Toguro')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /partidas de hoje/i }))
    expect(onVer).toHaveBeenCalledWith(sessao)
  })
})

describe('AvisoRecorde', () => {
  const recorde = { metrica: 'adr', nome: 'ADR', valor: 112.4, anterior: 104.9, matchId: 'm9', map: 'de_inferno', playedAt: '2026-10-13T21:05:00Z' }

  it('mostra o recorde e some ao dispensar (lembrando no navegador)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [recorde] }))
    comRouter(<AvisoRecorde />)
    expect(await screen.findByText(/recorde pessoal de ADR/)).toBeInTheDocument()
    expect(screen.getByText('112.4')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar' }))
    await waitFor(() => expect(screen.queryByText(/recorde pessoal/)).not.toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem('resenha_recordes_dispensados'))).toEqual(['m9:adr'])
  })

  it('sem recorde não renderiza nada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    const { container } = comRouter(<AvisoRecorde />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})

describe('DesempenhoRecente', () => {
  it('conta V/D e a média das partidas do gráfico', () => {
    const evolucao = [
      { matchId: '1', playedAt: null, rating: 0.9, won: false },
      { matchId: '2', playedAt: null, rating: 1.1, won: true },
      { matchId: '3', playedAt: null, rating: 1.3, won: true },
    ]
    render(<DesempenhoRecente evolucao={evolucao} />)
    expect(screen.getByText('V 2')).toBeInTheDocument()
    expect(screen.getByText('D 1')).toBeInTheDocument()
    expect(screen.getByText('1.10')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /de 0\.90 até 1\.30/ })).toBeInTheDocument()
  })

  it('com menos de 2 partidas explica que o gráfico vem depois', () => {
    render(<DesempenhoRecente evolucao={[{ matchId: '1', rating: 1, won: true }]} />)
    expect(screen.getByText(/a partir da 2ª partida/)).toBeInTheDocument()
  })
})

describe('MapaAtividade', () => {
  it('monta 13 semanas terminando hoje, com as partidas no dia certo e o futuro vazio', () => {
    const hoje = new Date(2026, 9, 14) // quarta
    const grade = montarGrade([{ dia: '2026-10-13', partidas: 3 }], hoje)
    expect(grade).toHaveLength(13)
    const dias = grade.flat()
    expect(dias.find((d) => d.chave === '2026-10-13').partidas).toBe(3)
    expect(dias.find((d) => d.chave === '2026-10-14').partidas).toBe(0)
    expect(dias.find((d) => d.chave === '2026-10-15').partidas).toBeNull()
    expect(grade[12][0].data.getDay()).toBe(0)
  })
})

describe('MapaAtividade — totais', () => {
  it('não soma dias que ficaram fora da grade', () => {
    const hoje = new Date()
    const dia = (n) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - n)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    // 200 dias atrás nunca cabe nas 13 semanas; ontem sempre cabe.
    render(<MapaAtividade atividade={[{ dia: dia(200), partidas: 9 }, { dia: dia(1), partidas: 2 }]} />)
    expect(screen.getByRole('img', { name: '2 partidas em 1 dias nas últimas 13 semanas' })).toBeInTheDocument()
  })
})

describe('PontosFortes', () => {
  it('formata cada tipo de valor', () => {
    expect(formatarValor(0.583, 'pct')).toBe('58%')
    expect(formatarValor(71.4, 'pct100')).toBe('71%')
    expect(formatarValor(186.2, 'inteiro')).toBe('186')
    expect(formatarValor(0.421, 'decimal2')).toBe('0.42')
  })

  it('mostra percentil e média do grupo; título muda no próprio perfil', () => {
    const pontos = [{ chave: 'utilitaria', nome: 'Dano de utilitária por partida', area: 'Utilitária', formato: 'inteiro', valor: 186, mediaGrupo: 97, percentil: 100 }]
    render(<PontosFortes pontos={pontos} proprio />)
    expect(screen.getByText('Seus pontos fortes')).toBeInTheDocument()
    expect(screen.getByText('186')).toBeInTheDocument()
    // "grupo" virou botão de explicação; o "?" dele fica no textContent.
    expect(screen.getByRole('button', { name: 'grupo' }).parentElement).toHaveTextContent(/^grupo\?: 97$/)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('sem dados não renderiza a seção', () => {
    const { container } = render(<PontosFortes pontos={[]} />)
    expect(container.textContent).toBe('')
  })
})

describe('hrefSeguro', () => {
  it('só deixa passar http(s)', async () => {
    const { hrefSeguro } = await import('../lib/urlSegura.js')
    expect(hrefSeguro('https://allstar.gg/clip?x=1')).toBe('https://allstar.gg/clip?x=1')
    expect(hrefSeguro('javascript:alert(1)')).toBeUndefined()
    expect(hrefSeguro('data:text/html,oi')).toBeUndefined()
    expect(hrefSeguro('nada')).toBeUndefined()
    expect(hrefSeguro(null)).toBeUndefined()
  })
})
