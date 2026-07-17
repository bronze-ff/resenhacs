import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Curso from '../pages/Curso.jsx'

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url) => {
      if (url === '/api/curso') {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { slug: 'introducao', titulo: 'Introdução', concluido: false, posicaoSegundos: 0 },
            { slug: 'modulo-1-aimbotz', titulo: 'Módulo 1 — AimBotz', concluido: true, posicaoSegundos: 600 },
            { slug: 'modulo-2-dm', titulo: 'Módulo 2 — Deathmatch', concluido: false, posicaoSegundos: 120 },
          ],
        })
      }
      if (url === '/api/curso/introducao/url') {
        return Promise.resolve({ ok: true, json: async () => ({ url: 'https://r2.example/introducao.mp4' }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }),
  )
}

describe('Curso', () => {
  it('lista os vídeos com progresso e abre o player com a URL assinada ao clicar', async () => {
    mockFetch()
    render(<Curso />)
    expect(await screen.findByText('Introdução')).toBeInTheDocument()
    // modulo-1-aimbotz está concluído E tem posicaoSegundos > 0 (onEnded grava os dois juntos) —
    // só o "✓ concluído" aparece; "continuar de" é exclusivo de vídeos NÃO concluídos.
    expect(screen.getByText('✓ concluído')).toBeInTheDocument()
    expect(screen.queryByText('continuar de 10:00')).not.toBeInTheDocument()
    // modulo-2-dm: não concluído e com posição > 0 — aqui sim mostra "continuar de".
    expect(screen.getByText('continuar de 2:00')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Introdução'))
    await waitFor(() => {
      expect(document.querySelector('video')).toHaveAttribute('src', 'https://r2.example/introducao.mp4')
    })
  })
})
