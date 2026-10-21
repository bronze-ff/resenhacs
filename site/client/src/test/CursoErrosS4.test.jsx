import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Curso from '../pages/Curso.jsx'

const videos = [
  { slug: 'a', titulo: 'Aula A', disponivel: true, posicaoSegundos: 0, concluido: false },
  { slug: 'b', titulo: 'Aula B', disponivel: true, posicaoSegundos: 0, concluido: false },
]
const resposta = (body, ok = true) => ({ ok, json: async () => body })
function pendente() {
  let resolve, reject
  const promise = new Promise((sim, nao) => { resolve = sim; reject = nao })
  return { promise, resolve, reject }
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

describe('Curso — erros e concorrência S4', () => {
  it.each(['http', 'rede', 'formato'])('mostra erro de lista sem quebrar o render: %s', async (tipo) => {
    fetch.mockImplementation(() => tipo === 'rede'
      ? Promise.reject(new Error('offline'))
      : Promise.resolve(resposta(tipo === 'formato' ? {} : [], tipo !== 'http')))
    render(<Curso />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/carregar.*vídeos/i)
    expect(screen.queryByRole('status', { name: 'Carregando vídeos' })).not.toBeInTheDocument()
    expect(screen.queryByText('Nenhum vídeo disponível ainda.')).not.toBeInTheDocument()
  })

  it.each(['sucesso', 'erro'])('ignora URL antiga após trocar de aula: %s', async (tipo) => {
    const antiga = pendente()
    fetch.mockImplementation((url) => {
      if (url === '/api/curso') return Promise.resolve(resposta(videos))
      if (url === '/api/curso/a/url') return antiga.promise
      return Promise.resolve(resposta({ url: 'https://example.test/b.mp4' }))
    })
    render(<Curso />)
    fireEvent.click(await screen.findByText('Aula A'))
    fireEvent.click(screen.getByText('Aula B'))
    await waitFor(() => expect(document.querySelector('video')).toHaveAttribute('src', 'https://example.test/b.mp4'))
    await act(async () => antiga.resolve(resposta({ url: 'https://example.test/a.mp4' }, tipo === 'sucesso')))
    expect(document.querySelector('video')).toHaveAttribute('src', 'https://example.test/b.mp4')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('mostra erro se a rede cair ao abrir a aula', async () => {
    fetch.mockImplementation((url) => url === '/api/curso'
      ? Promise.resolve(resposta(videos)) : Promise.reject(new Error('offline')))
    render(<Curso />)
    fireEvent.click(await screen.findByText('Aula A'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/vídeo indisponível/i)
  })

  it.each(['http', 'rede'])('mantém progresso recusado para repetir sem confirmar na lista: %s', async (tipo) => {
    let falhar = true
    fetch.mockImplementation((url) => {
      if (url === '/api/curso') return Promise.resolve(resposta(videos))
      if (url.endsWith('/url')) return Promise.resolve(resposta({ url: 'https://example.test/a.mp4' }))
      if (falhar) return tipo === 'rede' ? Promise.reject(new Error('offline')) : Promise.resolve(resposta({}, false))
      return Promise.resolve(resposta({}))
    })
    render(<Curso />)
    fireEvent.click(await screen.findByText('Aula A'))
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull())
    fireEvent.pause(document.querySelector('video'), { target: { currentTime: 35 } })
    expect(await screen.findByRole('alert')).toHaveTextContent(/salvar.*progresso/i)
    expect(screen.queryByText('continuar de 0:35')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Aula B'))
    fireEvent.click(screen.getByText('Aula A'))
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull())
    fireEvent.loadedMetadata(document.querySelector('video'))
    expect(document.querySelector('video').currentTime).toBe(35)
    falhar = false
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('continuar de 0:35')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(JSON.parse(fetch.mock.calls.filter(([url]) => url.endsWith('/progresso')).at(-1)[1].body))
      .toEqual({ posicaoSegundos: 35, concluido: false })
  })

  it('ignora confirmação de PUT antigo que chega depois do progresso novo', async () => {
    const antigo = pendente()
    let envios = 0
    fetch.mockImplementation((url) => {
      if (url === '/api/curso') return Promise.resolve(resposta(videos))
      if (url.endsWith('/url')) return Promise.resolve(resposta({ url: 'https://example.test/a.mp4' }))
      return ++envios === 1 ? antigo.promise : Promise.resolve(resposta({}))
    })
    render(<Curso />)
    fireEvent.click(await screen.findByText('Aula A'))
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull())
    fireEvent.pause(document.querySelector('video'), { target: { currentTime: 10 } })
    fireEvent.pause(document.querySelector('video'), { target: { currentTime: 25 } })
    expect(await screen.findByText('continuar de 0:25')).toBeInTheDocument()
    await act(async () => antigo.resolve(resposta({})))
    expect(screen.getByText('continuar de 0:25')).toBeInTheDocument()
    expect(screen.queryByText('continuar de 0:10')).not.toBeInTheDocument()
  })
})
