import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import Admin from '../pages/Admin.jsx'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
})

describe('Admin', () => {
  it('mostra um botão de upload pra cada um dos 5 vídeos do curso de mira', async () => {
    render(<Admin />)
    expect(await screen.findByText('Introdução')).toBeInTheDocument()
    expect(screen.getByText('Módulo 1 — AimBotz')).toBeInTheDocument()
    expect(screen.getByText('Módulo 2 — Deathmatch')).toBeInTheDocument()
    expect(screen.getByText('Módulo 3 — Mecânicas')).toBeInTheDocument()
    expect(screen.getByText('Considerações finais')).toBeInTheDocument()
  })
})
