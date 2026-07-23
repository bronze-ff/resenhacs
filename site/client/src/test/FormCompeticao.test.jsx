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
    fireEvent.change(screen.getByLabelText(/link da imagem/i), { target: { value: 'https://exemplo.com/ak47.png' } })
    fireEvent.change(screen.getByLabelText(/link no mercado/i), { target: { value: 'https://steamcommunity.com/market/listings/730/AK-47' } })
    fireEvent.change(screen.getByLabelText(/in[íi]cio/i), { target: { value: '2026-07-23T00:00' } })
    fireEvent.change(screen.getByLabelText(/fim/i), { target: { value: '2026-07-30T00:00' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
    const [, opts] = global.fetch.mock.calls[0]
    const corpo = JSON.parse(opts.body)
    expect(corpo.nome).toBe('Semana 1')
    expect(corpo.premioImagemUrl).toBe('https://exemplo.com/ak47.png')
    expect(corpo.premioMercadoUrl).toBe('https://steamcommunity.com/market/listings/730/AK-47')
  })

  it('erro do servidor aparece na tela', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ erro: 'dataFim precisa ser depois de dataInicio' }) })
    render(<FormCompeticao onSalvo={() => {}} onCancelar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText(/link da imagem/i), { target: { value: 'https://exemplo.com/ak47.png' } })
    fireEvent.change(screen.getByLabelText(/link no mercado/i), { target: { value: 'https://steamcommunity.com/market/listings/730/AK-47' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(screen.getByText(/dataFim precisa ser depois/i)).toBeInTheDocument())
  })

  it('bloqueia salvar sem link de imagem/mercado', async () => {
    global.fetch = vi.fn()
    render(<FormCompeticao onSalvo={() => {}} onCancelar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(screen.getByText(/obrigat[óo]rios/i)).toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('bloqueia link de mercado fora do dominio da steam', async () => {
    global.fetch = vi.fn()
    render(<FormCompeticao onSalvo={() => {}} onCancelar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText(/link da imagem/i), { target: { value: 'https://exemplo.com/ak47.png' } })
    fireEvent.change(screen.getByLabelText(/link no mercado/i), { target: { value: 'https://exemplo.com/market' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(screen.getByText(/steamcommunity\.com\/market/i)).toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
