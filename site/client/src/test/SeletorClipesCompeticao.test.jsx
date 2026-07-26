// site/client/src/test/SeletorClipesCompeticao.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SeletorClipesCompeticao from '../components/SeletorClipesCompeticao.jsx'

afterEach(() => { vi.restoreAllMocks() })

function respostaElegiveis(clipes, limites = {}) {
  return {
    clipes,
    limites: {
      hoje: 0, limiteDiario: 2, total: 0, limiteTotal: 10, minimoParaRankear: 3,
      ...limites,
    },
  }
}

describe('SeletorClipesCompeticao', () => {
  it('lista os clipes elegiveis com pontuacao e marca os ja enviados', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => respostaElegiveis([
        { allstarClipId: 'c1', matchId: 'm1', roundNumber: 9, map: 'de_dust2', playedAt: '2026-07-25T00:37:00Z', kind: 'ace', clipUrl: 'https://a/c1', clipSnapshotUrl: null, pontuacao: { total: 100 }, jaEnviado: false },
        { allstarClipId: 'c2', matchId: 'm2', roundNumber: 4, map: 'de_mirage', playedAt: '2026-07-25T00:37:00Z', kind: null, clipUrl: 'https://a/c2', clipSnapshotUrl: null, pontuacao: { total: 80 }, jaEnviado: true },
      ]),
    })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />)
    await waitFor(() => expect(screen.getByText(/Dust2/)).toBeInTheDocument())
    expect(screen.getByText(/enviado/i)).toBeInTheDocument()
  })

  it('clica em enviar chama o POST de submissao e depois onEnviado', async () => {
    const onEnviado = vi.fn()
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (opts?.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) })
      return Promise.resolve({ ok: true, json: async () => respostaElegiveis([
        { allstarClipId: 'c1', matchId: 'm1', roundNumber: 9, map: 'de_dust2', playedAt: '2026-07-25T00:37:00Z', kind: 'ace', clipUrl: 'https://a/c1', clipSnapshotUrl: null, pontuacao: { total: 100 }, jaEnviado: false },
      ]) })
    })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={onEnviado} />)
    await waitFor(() => screen.getByText(/Dust2/))
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await waitFor(() => expect(onEnviado).toHaveBeenCalled())
  })

  it('renderiza no body, fora do elemento pai (o clip-path do Card recortava o modal)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respostaElegiveis([]) })
    const { container } = render(
      <SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />,
    )
    await waitFor(() => expect(screen.getByText(/Selecionar clipes/i)).toBeInTheDocument())
    // o container do render é o pai; o overlay tem que estar FORA dele
    expect(container).toBeEmptyDOMElement()
    expect(document.body).toContainElement(screen.getByText(/Selecionar clipes/i))
  })

  it('Esc fecha o modal', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respostaElegiveis([]) })
    const onFechar = vi.fn()
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={onFechar} onEnviado={() => {}} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    vi.advanceTimersByTime(250)
    expect(onFechar).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('trava o scroll do fundo enquanto aberto e restaura ao desmontar', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respostaElegiveis([]) })
    const { unmount } = render(
      <SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />,
    )
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
