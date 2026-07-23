// site/client/src/test/EnviarDemo.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EnviarDemo from '../pages/EnviarDemo.jsx'

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
