import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import AvisoPartidaSemDemo from '../components/AvisoPartidaSemDemo.jsx'
import SincronizacaoFaceit from '../components/SincronizacaoFaceit.jsx'

const partida = {
  id: '11111111-1111-1111-1111-111111111111',
  map: 'de_inferno',
  source: 'faceit',
  temDemo: false,
  demoUpload: null,
  players: [{ steamId: '765' }],
}

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('AvisoPartidaSemDemo', () => {
  it('Partida FACEIT sem demo: aviso + CTA de envio pra quem jogou', () => {
    render(<AvisoPartidaSemDemo partida={partida} euSteamId="765" />)
    expect(screen.getByText('Partida da FACEIT sem demo — estatísticas básicas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enviar demo desta partida/i })).toBeInTheDocument()
  })

  it('quem não jogou vê o aviso, mas não o botão', () => {
    render(<AvisoPartidaSemDemo partida={partida} euSteamId="000" />)
    expect(screen.getByText(/sem demo — estatísticas básicas/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enviar demo/i })).not.toBeInTheDocument()
  })

  it('não aparece com demo nem fora da FACEIT', () => {
    const { container, rerender } = render(<AvisoPartidaSemDemo partida={{ ...partida, temDemo: true }} euSteamId="765" />)
    expect(container).toBeEmptyDOMElement()
    rerender(<AvisoPartidaSemDemo partida={{ ...partida, source: 'valve_mm' }} euSteamId="765" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('SincronizacaoFaceit', () => {
  it('mostra última sincronização e partidas importadas', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        vinculada: true, ultimaSincronizacao: '2026-10-16T15:00:00.000Z', partidasImportadas: 42, partidasSemDemo: 40,
      }),
    })
    render(<SincronizacaoFaceit />)
    expect(await screen.findByText('Última sincronização')).toBeInTheDocument()
    expect(screen.getByText('16/10/2026 12:00')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText(/40 só com estatísticas básicas/)).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('/api/faceit-sincronizacao')
  })

  it('nunca sincronizado e sem partidas', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ vinculada: true, ultimaSincronizacao: null, partidasImportadas: 0, partidasSemDemo: 0 }),
    })
    render(<SincronizacaoFaceit />)
    expect(await screen.findByText('ainda não rodou')).toBeInTheDocument()
    expect(screen.queryByText(/só com estatísticas/)).not.toBeInTheDocument()
  })

  it('erro na API não mostra nada', async () => {
    global.fetch.mockResolvedValue({ ok: false })
    const { container } = render(<SincronizacaoFaceit />)
    await Promise.resolve()
    expect(container).toBeEmptyDOMElement()
  })
})
