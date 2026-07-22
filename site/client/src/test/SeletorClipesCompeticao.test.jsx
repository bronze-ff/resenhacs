// site/client/src/test/SeletorClipesCompeticao.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SeletorClipesCompeticao from '../components/SeletorClipesCompeticao.jsx'

afterEach(() => { vi.restoreAllMocks() })

describe('SeletorClipesCompeticao', () => {
  it('lista os clipes elegiveis com pontuacao e marca os ja enviados', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { allstarClipId: 'c1', matchId: 'm1', roundNumber: 9, map: 'de_dust2', pontuacao: { total: 100 }, jaEnviado: false },
        { allstarClipId: 'c2', matchId: 'm2', roundNumber: 4, map: 'de_mirage', pontuacao: { total: 80 }, jaEnviado: true },
      ]),
    })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />)
    await waitFor(() => expect(screen.getByText('de_dust2')).toBeInTheDocument())
    expect(screen.getByText(/enviado/i)).toBeInTheDocument()
  })

  it('clica em enviar chama o POST de submissao e depois onEnviado', async () => {
    const onEnviado = vi.fn()
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (opts?.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) })
      return Promise.resolve({ ok: true, json: async () => ([
        { allstarClipId: 'c1', matchId: 'm1', roundNumber: 9, map: 'de_dust2', pontuacao: { total: 100 }, jaEnviado: false },
      ]) })
    })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={onEnviado} />)
    await waitFor(() => screen.getByText('de_dust2'))
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await waitFor(() => expect(onEnviado).toHaveBeenCalled())
  })
})
