// site/client/src/test/EnviarDemo.test.jsx
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EnviarDemo from '../pages/EnviarDemo.jsx'

afterEach(() => vi.useRealTimers())

function arquivoFalso(nome = 'partida.dem') {
  return new File(['conteudo'], nome, { type: 'application/octet-stream' })
}

function paraDatetimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function mockFetchSucesso() {
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url === '/api/upload/upload-url') {
      return Promise.resolve({ ok: true, json: async () => ({ id: 'u1', uploadUrl: 'https://r2.example/put', key: 'uploads-pendentes/x.dem' }) })
    }
    return Promise.resolve({ ok: true })
  })
}

describe('EnviarDemo', () => {
  it('preserva 19h de Brasília como 22h UTC no envio', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-22T00:00:00Z'))
    mockFetchSucesso()
    const { container } = render(<EnviarDemo />)
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [arquivoFalso()] } })
    const instante = new Date('2026-10-21T19:00:00-03:00')
    fireEvent.change(screen.getByLabelText(/quando foi jogada/i), { target: { value: paraDatetimeLocal(instante) } })
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await waitFor(() => expect(screen.getByText(/envio recebido/i)).toBeInTheDocument())
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).playedAt).toBe('2026-10-21T22:00:00.000Z')
  })
  it('envia data ISO com fuso e o mesmo arquivo cujo tamanho foi declarado', async () => {
    mockFetchSucesso()
    const arquivo = arquivoFalso()
    const { container } = render(<EnviarDemo />)
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [arquivo] } })
    const local = paraDatetimeLocal(new Date(Date.now() - 3600000))
    fireEvent.change(screen.getByLabelText(/quando foi jogada/i), { target: { value: local } })
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await waitFor(() => expect(screen.getByText(/envio recebido/i)).toBeInTheDocument())
    const pedido = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(pedido.playedAt).toMatch(/Z$/)
    expect(new Date(pedido.playedAt).getTime()).toBe(new Date(local).getTime())
    expect(pedido.tamanho).toBe(arquivo.size)
    expect(global.fetch.mock.calls[1][1].body).toBe(arquivo)
  })
  it.each(['seleção', 'arrastar'])('aceita .dem.gz por %s e envia o arquivo intacto', async (modo) => {
    mockFetchSucesso()
    const { container } = render(<EnviarDemo />)
    const file = arquivoFalso('partida.dem.gz')
    if (modo === 'seleção') {
      fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } })
    } else {
      fireEvent.drop(container.querySelector('label[for="arquivo"]'), { dataTransfer: { files: [file] } })
    }
    expect(screen.getByRole('button', { name: /^enviar$/i })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /^enviar$/i }))
    await screen.findByText(/envio recebido/i)
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({ filename: file.name, tamanho: file.size })
    expect(global.fetch.mock.calls[1][1].body).toBe(file)
  })

  it('bloqueia envio com data no futuro', async () => {
    global.fetch = vi.fn()
    const { container } = render(<EnviarDemo />)
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [arquivoFalso()] } })
    const futuro = new Date(Date.now() + 24 * 60 * 60 * 1000)
    fireEvent.change(screen.getByLabelText(/quando foi jogada/i), { target: { value: paraDatetimeLocal(futuro) } })
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await waitFor(() => expect(screen.getByText(/precisa estar entre/i)).toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('bloqueia envio com data mais de 3 dias no passado', async () => {
    global.fetch = vi.fn()
    const { container } = render(<EnviarDemo />)
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [arquivoFalso()] } })
    const antigo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
    fireEvent.change(screen.getByLabelText(/quando foi jogada/i), { target: { value: paraDatetimeLocal(antigo) } })
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await waitFor(() => expect(screen.getByText(/precisa estar entre/i)).toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('aceita data dentro da janela de 3 dias', async () => {
    mockFetchSucesso()
    const { container } = render(<EnviarDemo />)
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [arquivoFalso()] } })
    const recente = new Date(Date.now() - 24 * 60 * 60 * 1000)
    fireEvent.change(screen.getByLabelText(/quando foi jogada/i), { target: { value: paraDatetimeLocal(recente) } })
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await waitFor(() => expect(screen.getByText(/envio recebido/i)).toBeInTheDocument())
  })

  it('sem data preenchida (campo opcional): envia normalmente', async () => {
    mockFetchSucesso()
    const { container } = render(<EnviarDemo />)
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [arquivoFalso()] } })
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await waitFor(() => expect(screen.getByText(/envio recebido/i)).toBeInTheDocument())
  })
})
