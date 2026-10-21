import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import DuelosAbertura from '../components/perfil/DuelosAbertura.jsx'

function base(extra = {}) {
  return {
    aberturas: 10, aberturasGanhas: 6, aberturasPerdidas: 4, aberturasPct: 60,
    porLado: { CT: { aberturas: 4, aberturasGanhas: 3, pct: 75 }, T: { aberturas: 6, aberturasGanhas: 3, pct: 50 } },
    mortes: 8, mortesTrocadas: 2, mortesSemTroca: 6, mortesTrocadasPct: 25, trocasFeitas: 3,
    ...extra,
  }
}

function mockFetch(payload, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({ ok, json: async () => payload })
}

beforeEach(() => vi.restoreAllMocks())

describe('DuelosAbertura (perfil)', () => {
  it('mostra % de abertura, por lado e mortes trocadas', async () => {
    mockFetch({ partidas: 30, ...base() })
    render(<DuelosAbertura steamId="765" />)
    expect(await screen.findByText('Duelos de abertura e trocas')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('/api/profile/765/duelos')
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByText('2 de 8 mortes')).toBeInTheDocument()
  })

  it('sem partidas não renderiza nada', async () => {
    mockFetch({ partidas: 0, ...base({ aberturas: 0, mortes: 0 }) })
    const { container } = render(<DuelosAbertura steamId="765" />)
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Carregando duelos"]')).toBeNull())
    expect(container).toBeEmptyDOMElement()
  })
})

// A aba Duelos da Partida virou a lente "Duelos" do Frente a frente (Espelho.test.jsx).
