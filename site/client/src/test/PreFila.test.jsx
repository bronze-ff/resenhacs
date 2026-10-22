// site/client/src/test/PreFila.test.jsx
// F2-UI: tela /pre-fila sobre a I7 (GET /api/pre-fila). Seleção de 1 a 4 amigos na ordem
// escolhida, fonte do mapa sempre escrita, erro 400 com a mensagem do server e vazios.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PreFila from '../pages/PreFila.jsx'
import { GRUPOS } from '../components/Shell.jsx'
import App from '../App.jsx'

afterEach(() => { vi.unstubAllGlobals() })

const ok = (corpo) => Promise.resolve({ ok: true, status: 200, json: async () => corpo })
const status = (codigo, corpo = {}) => Promise.resolve({ ok: false, status: codigo, json: async () => corpo })

const id = (n) => `7656119800000000${n}`
const AMIGOS = [1, 2, 3, 4, 5].map((n) => ({ steamId: id(n), nick: `amigo${n}`, avatarUrl: null }))

const RESULTADO = {
  jogadores: [
    { steamId: id(9), nick: 'eu', avatarUrl: null },
    { steamId: id(2), nick: 'amigo2', avatarUrl: null },
    { steamId: id(1), nick: 'amigo1', avatarUrl: null },
  ],
  mapas: [
    { map: 'de_mirage', partidas: 12, vitorias: 8, winrate: 66.7, fonte: 'grupo' },
    { map: 'de_nuke', partidas: 5, vitorias: 2, winrate: 40, fonte: 'individual' },
  ],
  melhorDupla: { a: id(1), b: id(9), partidas: 20, vitorias: 13, winrate: 65 },
  piorDupla: { a: id(2), b: id(9), partidas: 9, vitorias: 3, winrate: 33.3 },
}

// /api/amigos devolve `amigos`; /api/pre-fila responde o que o teste mandar.
function mockApi({ amigos = AMIGOS, preFila = () => ok(RESULTADO) } = {}) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
    const u = String(url)
    if (u === '/api/amigos') return typeof amigos === 'function' ? amigos() : ok({ amigos, recebidos: [], enviados: [] })
    if (u.startsWith('/api/pre-fila')) return preFila(u)
    return ok({})
  }))
}

const renderTela = () => render(<MemoryRouter><PreFila /></MemoryRouter>)
// Linha do mapa: o <li> que contém o nome do mapa.
const linhaMapa = async (nome) => (await screen.findByText(nome)).closest('li')
const amigo = (nick) => screen.findByRole('button', { name: new RegExp(`^${nick}\\b`) })

describe('PreFila', () => {
  it('seleção limita a 4 e "Montar Pré-fila" manda os ids na ordem escolhida', async () => {
    mockApi()
    renderTela()
    const montar = await screen.findByRole('button', { name: 'Montar Pré-fila' })
    expect(montar).toBeDisabled()

    for (const nick of ['amigo3', 'amigo1', 'amigo4', 'amigo2']) fireEvent.click(await amigo(nick))
    expect(screen.getByText('4 de 4')).toBeInTheDocument()
    const quinto = await amigo('amigo5')
    expect(quinto).toBeDisabled()
    fireEvent.click(quinto)
    expect(quinto).toHaveAttribute('aria-pressed', 'false')

    // Desmarcar um libera de novo, e a ordem segue a ordem de clique.
    fireEvent.click(await amigo('amigo4'))
    expect(await amigo('amigo4')).toHaveAttribute('aria-pressed', 'false')
    expect(quinto).toBeEnabled()

    fireEvent.click(montar)
    expect(await screen.findByRole('heading', { name: /mapas/i })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(`/api/pre-fila?jogadores=${id(3)},${id(1)},${id(2)}`)
  })

  it('mostra n de Partidas e a fonte de cada mapa, e as duplas pelo nick', async () => {
    mockApi()
    renderTela()
    fireEvent.click(await amigo('amigo2'))
    fireEvent.click(await amigo('amigo1'))
    fireEvent.click(screen.getByRole('button', { name: 'Montar Pré-fila' }))

    const mirage = await linhaMapa('Mirage')
    expect(within(mirage).getByText('67%')).toBeInTheDocument()
    expect(within(mirage).getByText(/12 Partidas/)).toBeInTheDocument()
    expect(within(mirage).getByText('do grupo')).toBeInTheDocument()

    const nuke = await linhaMapa('Nuke')
    expect(within(nuke).getByText(/5 Partidas/)).toBeInTheDocument()
    expect(within(nuke).getByText('média individual')).toBeInTheDocument()

    const melhor = screen.getByRole('region', { name: 'Melhor dupla' })
    expect(within(melhor).getByText(/amigo1/)).toBeInTheDocument()
    expect(within(melhor).getByText(/eu/)).toBeInTheDocument()
    expect(within(melhor).getByText(/20 Partidas/)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Pior dupla' })).getByText(/amigo2/)).toBeInTheDocument()
  })

  it('erro 400 mostra a mensagem do server', async () => {
    mockApi({ preFila: () => status(400, { erro: 'Só amigos entram na Pré-fila.' }) })
    renderTela()
    fireEvent.click(await amigo('amigo1'))
    fireEvent.click(screen.getByRole('button', { name: 'Montar Pré-fila' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Só amigos entram na Pré-fila.')
  })

  it('falha de rede mostra "Tentar de novo" e recupera', async () => {
    let falhar = true
    mockApi({ preFila: () => (falhar ? Promise.reject(new TypeError('offline')) : ok(RESULTADO)) })
    renderTela()
    fireEvent.click(await amigo('amigo1'))
    fireEvent.click(screen.getByRole('button', { name: 'Montar Pré-fila' }))
    expect(await screen.findByText('Não deu para montar a Pré-fila.')).toBeInTheDocument()
    falhar = false
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await linhaMapa('Mirage')).toBeInTheDocument()
  })

  it('sem mapa com amostra mostra vazio próprio', async () => {
    mockApi({ preFila: () => ok({ ...RESULTADO, mapas: [], melhorDupla: null, piorDupla: null }) })
    renderTela()
    fireEvent.click(await amigo('amigo1'))
    fireEvent.click(screen.getByRole('button', { name: 'Montar Pré-fila' }))
    expect(await screen.findByText('Nenhum mapa com 3 Partidas ainda.')).toBeInTheDocument()
  })

  it('sem amigos mostra vazio com link para /jogadores', async () => {
    mockApi({ amigos: [] })
    renderTela()
    expect(await screen.findByText('Você ainda não tem amigos no Resenha.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /adicionar amigos/i })).toHaveAttribute('href', '/jogadores')
  })

  it('erro ao carregar amigos tem "Tentar de novo"', async () => {
    let falhar = true
    mockApi({ amigos: () => (falhar ? status(500) : ok({ amigos: AMIGOS, recebidos: [], enviados: [] })) })
    renderTela()
    expect(await screen.findByText('Não deu para carregar seus amigos.')).toBeInTheDocument()
    falhar = false
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await amigo('amigo1')).toBeInTheDocument()
  })
})

describe('PreFila — duplas', () => {
  it('pior dupla null mostra texto que cobre falta de amostra e empate', async () => {
    mockApi({ preFila: () => ok({ ...RESULTADO, piorDupla: null }) })
    renderTela()
    fireEvent.click(await amigo('amigo1'))
    fireEvent.click(screen.getByRole('button', { name: 'Montar Pré-fila' }))
    const pior = await screen.findByRole('region', { name: 'Pior dupla' })
    expect(pior).toHaveTextContent(/falta amostra/)
    expect(pior).toHaveTextContent(/empatam/)
  })

  it('linha do mapa não esconde winrate, Partidas e fonte do leitor de tela', async () => {
    mockApi()
    renderTela()
    fireEvent.click(await amigo('amigo1'))
    fireEvent.click(screen.getByRole('button', { name: 'Montar Pré-fila' }))
    expect((await linhaMapa('Mirage'))).not.toHaveAttribute('aria-label')
  })
})

describe('Shell', () => {
  it('tem "Pré-fila" no grupo de Mapas', () => {
    const grupo = GRUPOS.find((g) => g.itens.some((i) => i.to === '/mapas'))
    expect(grupo.itens.map((i) => i.to)).toContain('/pre-fila')
  })
})

describe('rota /pre-fila', () => {
  it('logado abre a Pré-fila dentro do Shell', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      const u = String(url)
      if (u.includes('/api/auth/me')) return ok({ steamId: id(9), nick: 'eu', avatarUrl: null, isSuperAdmin: false, tourConcluido: true })
      if (u === '/api/amigos') return ok({ amigos: AMIGOS, recebidos: [], enviados: [] })
      return ok([])
    }))
    window.history.replaceState(null, '', '/pre-fila')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Pré-fila' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /pré-fila/i })[0]).toHaveAttribute('href', '/pre-fila')
    window.history.replaceState(null, '', '/')
  })
})
