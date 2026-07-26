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
    expect(screen.getByText('já enviado')).toBeInTheDocument()
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

  const CLIPE_COMPLETO = {
    allstarClipId: 'c1', matchId: 'm1', roundNumber: 18, map: 'de_inferno',
    playedAt: '2026-07-25T03:37:00Z', kind: 'clutch_1v3',
    clipUrl: 'https://allstar/c1?x=1', clipSnapshotUrl: 'https://allstar/c1.jpg',
    pontuacao: { kills: 3, pontosKills: 50, headshots: 2, pontosHeadshots: 16, armas: 2, pontosArmas: 10, clutch: '1v3', pontosClutch: 35, total: 111 },
    jaEnviado: false,
  }

  it('mostra jogada, contexto da Partida e o breakdown da pontuacao', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respostaElegiveis([CLIPE_COMPLETO]) })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />)
    await waitFor(() => expect(screen.getByText('CLUTCH 1v3')).toBeInTheDocument())
    expect(screen.getByText(/Inferno/)).toBeInTheDocument()
    expect(screen.getByText(/round 18/)).toBeInTheDocument()
    expect(screen.getByText('111')).toBeInTheDocument()
    expect(screen.getByText(/3 kills 50/)).toBeInTheDocument()
    expect(screen.getByText(/2 hs 16/)).toBeInTheDocument()
    expect(screen.getByText(/clutch 1v3 35/)).toBeInTheDocument()
  })

  it('no breakdown so aparece o que somou', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => respostaElegiveis([{
        ...CLIPE_COMPLETO, kind: null,
        pontuacao: { kills: 2, pontosKills: 25, headshots: 0, pontosHeadshots: 0, armas: 1, pontosArmas: 5, clutch: null, pontosClutch: 0, total: 30 },
      }]),
    })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />)
    await waitFor(() => expect(screen.getByText(/2 kills 25/)).toBeInTheDocument())
    expect(screen.queryByText(/hs/)).toBeNull()
    expect(screen.queryByText(/clutch/)).toBeNull()
    // sem kind, o rótulo cai pro número de kills
    expect(screen.getByText('2 KILLS')).toBeInTheDocument()
  })

  it('abrir o player de um clipe fecha o do outro', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => respostaElegiveis([
        CLIPE_COMPLETO,
        { ...CLIPE_COMPLETO, allstarClipId: 'c2', roundNumber: 2 },
      ]),
    })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /assistir/i })).toHaveLength(2))
    const [play1, play2] = screen.getAllByRole('button', { name: /assistir/i })

    fireEvent.click(play1)
    expect(document.querySelectorAll('iframe')).toHaveLength(1)

    fireEvent.click(play2)
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
  })

  it('limite diario estourado desabilita o envio e diz o motivo', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => respostaElegiveis([CLIPE_COMPLETO], { hoje: 2, limiteDiario: 2 }),
    })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />)
    await waitFor(() => expect(screen.getByText(/limite diário atingido/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /limite diário atingido/i })).toBeDisabled()
  })

  it('mostra o contador de envios no cabecalho', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => respostaElegiveis([], { hoje: 1, limiteDiario: 2, total: 4, limiteTotal: 10, minimoParaRankear: 3 }),
    })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />)
    await waitFor(() => expect(screen.getByText(/1 de 2 enviados hoje/i)).toBeInTheDocument())
    expect(screen.getByText(/4 de 10 no total/i)).toBeInTheDocument()
    expect(screen.getByText(/mínimo 3 pra rankear/i)).toBeInTheDocument()
  })
})
