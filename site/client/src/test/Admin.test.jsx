import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Admin from '../pages/Admin.jsx'

// Arquivo falso: um File real de 250 MiB no jsdom seria absurdo em memória e tempo. O código só
// usa .size e .slice(), então isto basta pra exercitar o fatiamento de verdade.
function arquivoFalso(tamanho) {
  return { size: tamanho, slice: (ini, fim) => ({ ini, fim }) }
}

let chamadas
function mockFetch(overrides = {}) {
  chamadas = []
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url, opts) => {
    chamadas.push({ url: String(url), opts })
    if (url === '/api/curso') {
      return Promise.resolve({
        ok: true,
        json: async () => [
          { slug: 'introducao', titulo: 'Introdução', disponivel: true, concluido: false, posicaoSegundos: 0 },
          { slug: 'modulo-1-aimbotz', titulo: 'Módulo 1 — AimBotz', disponivel: false, concluido: false, posicaoSegundos: 0 },
        ],
      })
    }
    if (url === '/api/curso/upload/iniciar') {
      return Promise.resolve({
        ok: overrides.iniciarOk ?? true,
        json: async () => ({ uploadId: 'up-1', urls: ['https://r2/p1', 'https://r2/p2', 'https://r2/p3'] }),
      })
    }
    if (String(url).startsWith('https://r2/')) {
      return Promise.resolve({ ok: overrides.parteOk ?? true })
    }
    return Promise.resolve({ ok: true, json: async () => [] })
  }))
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('Admin — curso de mira', () => {
  it('mostra os vídeos vindos do servidor, com "Enviado" pro que já existe no R2', async () => {
    mockFetch()
    render(<Admin />)
    expect(await screen.findByText('Introdução')).toBeInTheDocument()
    expect(screen.getByText('Módulo 1 — AimBotz')).toBeInTheDocument()
    expect(screen.getByText(/enviado/i)).toBeInTheDocument()
    expect(screen.getByText('Escolher arquivo')).toBeInTheDocument()
  })

  it('sobe em partes de 100 MiB e conclui', async () => {
    mockFetch()
    const { container } = render(<Admin />)
    expect(await screen.findByText('Introdução')).toBeInTheDocument()
    const inputs = container.querySelectorAll('input[type="file"]')
    // 250 MiB / 100 MiB = 2.5 → 3 partes
    fireEvent.change(inputs[0], { target: { files: [arquivoFalso(250 * 1024 * 1024)] } })

    await waitFor(() => {
      expect(chamadas.some((c) => c.url === '/api/curso/upload/concluir')).toBe(true)
    })
    const iniciar = chamadas.find((c) => c.url === '/api/curso/upload/iniciar')
    expect(JSON.parse(iniciar.opts.body)).toEqual({ slug: 'introducao', partes: 3 })
    expect(chamadas.filter((c) => c.url.startsWith('https://r2/'))).toHaveLength(3)
    const concluir = chamadas.find((c) => c.url === '/api/curso/upload/concluir')
    expect(JSON.parse(concluir.opts.body)).toEqual({ slug: 'introducao', uploadId: 'up-1' })
  })

  it('parte falhando: tenta 3x, aborta o multipart e marca erro', async () => {
    mockFetch({ parteOk: false })
    const { container } = render(<Admin />)
    expect(await screen.findByText('Introdução')).toBeInTheDocument()
    const inputs = container.querySelectorAll('input[type="file"]')
    fireEvent.change(inputs[0], { target: { files: [arquivoFalso(150 * 1024 * 1024)] } })

    await waitFor(() => {
      expect(chamadas.some((c) => c.url === '/api/curso/upload/abortar')).toBe(true)
    })
    // 3 tentativas na primeira parte, e desiste sem tentar a segunda
    expect(chamadas.filter((c) => c.url === 'https://r2/p1')).toHaveLength(3)
    expect(chamadas.filter((c) => c.url === 'https://r2/p2')).toHaveLength(0)
    expect(chamadas.some((c) => c.url === '/api/curso/upload/concluir')).toBe(false)
    expect(await screen.findByText(/erro, tentar de novo/i)).toBeInTheDocument()
  })
})

function mockFetchComCompeticoes(competicoesResposta) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
    if (url === '/api/taticas?status=sugerida') return Promise.resolve({ ok: true, json: async () => [] })
    if (url === '/api/curso') return Promise.resolve({ ok: true, json: async () => [] })
    if (url === '/api/competicoes') return Promise.resolve({ ok: true, json: async () => competicoesResposta })
    return Promise.resolve({ ok: true, json: async () => [] })
  }))
}

describe('Admin — confirmação de vencedor', () => {
  it('mostra o card de confirmação com os clipes do vencedor, destacando os de upload manual', async () => {
    mockFetchComCompeticoes({
      ativa: null, agendadas: [],
      encerradas: [{
        id: 'comp1', nome: 'Semana 1', dataInicio: '2026-07-01T00:00:00Z', dataFim: '2026-07-08T00:00:00Z',
        vencedorSteamId: '999', vencedorConfirmado: false,
        leaderboard: [{ steamId: '999', nick: 'troya', avatarUrl: null, total: 300, qualificado: true }],
        vencedorSubmissoes: [
          { id: 'clip1', clipUrl: 'https://x/clip1', pontuacao: { total: 300 }, origemNaoVerificada: true, plataformaManual: 'gamers_club' },
        ],
      }],
    })
    render(<Admin />)
    expect(await screen.findByText(/vencedor: troya/i)).toBeInTheDocument()
    expect(screen.getByText(/upload manual/i)).toBeInTheDocument()
    expect(screen.getByText(/gamers_club/i)).toBeInTheDocument()
  })

  it('sem vencedor pendente: nao mostra nenhum card de confirmacao', async () => {
    mockFetchComCompeticoes({
      ativa: null, agendadas: [],
      encerradas: [{
        id: 'comp1', nome: 'Semana 1', dataInicio: '2026-07-01T00:00:00Z', dataFim: '2026-07-08T00:00:00Z',
        vencedorSteamId: null, vencedorConfirmado: false,
        leaderboard: [],
      }],
    })
    render(<Admin />)
    expect(await screen.findByText('Semana 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /confirmar vencedor/i })).not.toBeInTheDocument()
  })

  it('confirma o vencedor e o card some depois de recarregar', async () => {
    let confirmado = false
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url, opts) => {
      if (url === '/api/taticas?status=sugerida') return Promise.resolve({ ok: true, json: async () => [] })
      if (url === '/api/curso') return Promise.resolve({ ok: true, json: async () => [] })
      if (url === '/api/competicoes') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ativa: null, agendadas: [],
            encerradas: [{
              id: 'comp1', nome: 'Semana 1', dataInicio: '2026-07-01T00:00:00Z', dataFim: '2026-07-08T00:00:00Z',
              vencedorSteamId: '999', vencedorConfirmado: confirmado,
              leaderboard: [{ steamId: '999', nick: 'troya', avatarUrl: null, total: 300, qualificado: true }],
              ...(confirmado ? {} : { vencedorSubmissoes: [] }),
            }],
          }),
        })
      }
      if (url === '/api/competicoes/comp1/confirmar-vencedor' && opts?.method === 'PUT') {
        confirmado = true
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    }))
    render(<Admin />)
    const botao = await screen.findByRole('button', { name: /confirmar vencedor/i })
    fireEvent.click(botao)
    await waitFor(() => expect(screen.queryByRole('button', { name: /confirmar vencedor/i })).not.toBeInTheDocument())
  })
})
