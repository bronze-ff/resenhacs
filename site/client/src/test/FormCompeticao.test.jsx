// site/client/src/test/FormCompeticao.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FormCompeticao from '../components/FormCompeticao.jsx'

describe('FormCompeticao', () => {
  it('preenche e salva uma competicao nova', async () => {
    const onSalvo = vi.fn()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'comp1' }) })
    render(<FormCompeticao onSalvo={onSalvo} onCancelar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Semana 1' } })
    fireEvent.change(screen.getByLabelText(/pr[êe]mio/i), { target: { value: 'Skin AK-47' } })
    fireEvent.change(screen.getByLabelText(/in[íi]cio/i), { target: { value: '2026-07-23T00:00' } })
    fireEvent.change(screen.getByLabelText(/fim/i), { target: { value: '2026-07-30T00:00' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
    const [, opts] = global.fetch.mock.calls[0]
    expect(JSON.parse(opts.body).nome).toBe('Semana 1')
  })

  it('erro do servidor aparece na tela', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ erro: 'dataFim precisa ser depois de dataInicio' }) })
    render(<FormCompeticao onSalvo={() => {}} onCancelar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(screen.getByText(/dataFim precisa ser depois/i)).toBeInTheDocument())
  })
})
