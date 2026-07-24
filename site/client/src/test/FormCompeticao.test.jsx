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

  it('editar e salvar sem mexer nas datas NAO desloca o horario (bug real: +3h por ciclo de edicao)', async () => {
    // O pre-preenchimento antigo fatiava a string ISO UTC crua (slice(0,16)) pro
    // datetime-local, que reinterpretava como horario LOCAL — cada abrir-editar-salvar
    // empurrava as datas +3h (Electrum Week foi criada 00:01 e acabou gravada 06:01).
    const onSalvo = vi.fn()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    const inicial = {
      id: 'comp1', nome: 'Electrum Week', descricao: '', premioDescricao: 'Skin',
      premioImagemUrl: 'https://exemplo.com/a.png',
      premioMercadoUrl: 'https://steamcommunity.com/market/listings/730/X',
      dataInicio: '2026-07-25T03:01:00.000Z', dataFim: '2026-08-01T02:59:00.000Z',
      limiteDiario: 3, limiteTotal: 10, minimoParaRankear: 2,
    }
    render(<FormCompeticao inicial={inicial} onSalvo={onSalvo} onCancelar={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
    const [, opts] = global.fetch.mock.calls[0]
    const corpo = JSON.parse(opts.body)
    // o INSTANTE salvo tem que ser o mesmo que entrou, independente do fuso da máquina
    expect(new Date(corpo.dataInicio).getTime()).toBe(new Date(inicial.dataInicio).getTime())
    expect(new Date(corpo.dataFim).getTime()).toBe(new Date(inicial.dataFim).getTime())
  })
})
