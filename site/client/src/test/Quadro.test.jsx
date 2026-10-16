import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Quadro from '../pages/Quadro.jsx'

const UUID = '11111111-2222-3333-4444-555555555555'

function renderEm(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/quadro" element={<Quadro />} />
      </Routes>
    </MemoryRouter>,
  )
}

function mockFetch(handlers) {
  const f = vi.fn().mockImplementation((url, opts = {}) => {
    for (const [padrao, corpo, status = 200] of handlers) {
      const casa = typeof padrao === 'function' ? padrao(url, opts) : url === padrao
      if (casa) return Promise.resolve({ ok: status < 400, status, json: async () => corpo })
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
  })
  vi.stubGlobal('fetch', f)
  return f
}

const quadroDoSvg = () => screen.getByRole('application')

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('Quadro tático', () => {
  it('ferramentas: barra acessível, setas trocam a ferramenta e letras são atalhos', () => {
    mockFetch([])
    renderEm('/quadro')
    const barra = screen.getByRole('toolbar', { name: 'Ferramentas' })
    const mover = within(barra).getByRole('button', { name: /Mover/ })
    expect(mover).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(mover, { key: 'ArrowDown' })
    expect(within(barra).getByRole('button', { name: /Jogador CT/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { key: 's' })
    expect(within(barra).getByRole('button', { name: /Smoke/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('Enter no quadro coloca a peça, Delete apaga e Ctrl+Z desfaz', () => {
    mockFetch([])
    renderEm('/quadro')
    fireEvent.keyDown(window, { key: 'c' })
    fireEvent.keyDown(quadroDoSvg(), { key: 'Enter' })
    expect(screen.getAllByRole('img', { name: 'Jogador CT' })).toHaveLength(1)
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(screen.queryAllByRole('img', { name: 'Jogador CT' })).toHaveLength(0)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(screen.getAllByRole('img', { name: 'Jogador CT' })).toHaveLength(1)
  })

  it('passos: adicionar, renomear e remover', () => {
    mockFetch([])
    renderEm('/quadro')
    fireEvent.click(screen.getByRole('button', { name: '+ passo' }))
    expect(screen.getByRole('button', { name: /^2/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Renomear' }))
    const campo = screen.getByLabelText('Nome do passo 2')
    fireEvent.change(campo, { target: { value: 'Execução' } })
    fireEvent.blur(campo)
    expect(screen.getByRole('button', { name: /Execução/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remover passo' }))
    expect(screen.queryByRole('button', { name: /Execução/ })).not.toBeInTheDocument()
  })

  it('salvar sem nome avisa; com nome faz POST', async () => {
    const f = mockFetch([[(url, o) => url === '/api/quadros' && o.method === 'POST', { id: UUID }, 201]])
    renderEm('/quadro')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar estratégia' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Dê um nome')
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Exec A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar estratégia' }))
    await screen.findByText('Estratégia salva.')
    const [, opts] = f.mock.calls.find(([u, o]) => u === '/api/quadros' && o?.method === 'POST')
    expect(JSON.parse(opts.body)).toMatchObject({ nome: 'Exec A', map: 'de_mirage', lado: null })
  })

  it('importa os jogadores vivos de um round pela URL', async () => {
    mockFetch([
      [`/api/matches/${UUID}/replay`, { map: 'de_inferno', calibrated: true, tickRate: 8, names: { a: 'fih' }, rounds: [{ round: 2, frameCount: 2 }] }],
      [`/api/matches/${UUID}/replay/round/2`, {
        round: 2,
        frames: [{ t: 0, players: [] }, { t: 1, players: [
          { id: 'a', side: 'T', x: 0.3, y: 0.3, alive: true },
          { id: 'b', side: 'CT', x: 0.6, y: 0.6, alive: true },
          { id: 'c', side: 'CT', x: 0.6, y: 0.6, alive: false },
        ] }],
      }],
    ])
    renderEm(`/quadro?partida=${UUID}&round=2&tick=1`)
    expect(await screen.findByText(/2 jogadores importados do round 2/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Jogador T fih' })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: /Jogador CT/ })).toHaveLength(1)
    expect(screen.getByLabelText('Nome')).toHaveValue('Round 2 aos 0.1s')
  })

  it('abre um quadro salvo de um amigo e oferece salvar cópia', async () => {
    mockFetch([[`/api/quadros/${UUID}`, {
      id: UUID, nome: 'Retake B', map: 'de_nuke', lado: 'CT', descricao: '', meu: false, criadoPorNick: 'amigo',
      publicoNoGrupo: true, passos: [{ nome: 'Setup', objetos: [{ id: 'x', tipo: 'smoke', x: 0.5, y: 0.5 }] }],
    }]])
    renderEm(`/quadro?id=${UUID}`)
    expect(await screen.findByDisplayValue('Retake B')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar cópia' })).toBeInTheDocument()
    expect(screen.getByText(/Criado por amigo/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir quadro' })).not.toBeInTheDocument()
  })

  it('erro ao importar mostra estado de erro', async () => {
    mockFetch([])
    renderEm(`/quadro?partida=${UUID}&round=2&tick=1`)
    await waitFor(() => expect(screen.getByText(/Não foi possível carregar o Replay 2D/)).toBeInTheDocument())
  })
})
