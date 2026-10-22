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

  it('serializa PUTs da aula e envia só o estado mais recente, incluindo a conclusão', async () => {
    const antigo = pendente()
    const recente = pendente()
    let envios = 0
    fetch.mockImplementation((url) => {
      if (url === '/api/curso') return Promise.resolve(resposta(videos))
      if (url.endsWith('/url')) return Promise.resolve(resposta({ url: 'https://example.test/a.mp4' }))
      return ++envios === 1 ? antigo.promise : recente.promise
    })
    render(<Curso />)
    fireEvent.click(await screen.findByText('Aula A'))
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull())
    fireEvent.pause(document.querySelector('video'), { target: { currentTime: 10 } })
    fireEvent.pause(document.querySelector('video'), { target: { currentTime: 25 } })
    Object.defineProperty(document.querySelector('video'), 'duration', { configurable: true, value: 60 })
    fireEvent.ended(document.querySelector('video'))
    const puts = () => fetch.mock.calls.filter(([url]) => url.endsWith('/progresso'))
    expect(puts()).toHaveLength(1)
    expect(JSON.parse(puts()[0][1].body)).toEqual({ posicaoSegundos: 10, concluido: false })
    await act(async () => antigo.resolve(resposta({})))
    expect(puts()).toHaveLength(2)
    expect(JSON.parse(puts()[1][1].body)).toEqual({ posicaoSegundos: 60, concluido: true })
    expect(screen.queryByText('✓ concluído')).not.toBeInTheDocument()
    expect(screen.queryByText('continuar de 0:10')).not.toBeInTheDocument()
    await act(async () => recente.resolve(resposta({})))
    expect(screen.getByText('✓ concluído')).toBeInTheDocument()
    expect(puts()).toHaveLength(2)
  })

  it('mantém filas independentes ao trocar e voltar para uma aula', async () => {
    const a = pendente()
    const b = pendente()
    let enviosA = 0
    fetch.mockImplementation((url) => {
      if (url === '/api/curso') return Promise.resolve(resposta(videos))
      if (url.endsWith('/url')) return Promise.resolve(resposta({ url: `https://example.test${url}.mp4` }))
      if (url === '/api/curso/b/progresso') return b.promise
      return ++enviosA === 1 ? a.promise : Promise.resolve(resposta({}))
    })
    render(<Curso />)
    fireEvent.click(await screen.findByText('Aula A'))
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull())
    fireEvent.pause(document.querySelector('video'), { target: { currentTime: 10 } })
    fireEvent.click(screen.getByText('Aula B'))
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull())
    fireEvent.pause(document.querySelector('video'), { target: { currentTime: 30 } })
    fireEvent.click(screen.getByText('Aula A'))
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull())
    fireEvent.pause(document.querySelector('video'), { target: { currentTime: 45 } })
    const puts = () => fetch.mock.calls.filter(([url]) => url.endsWith('/progresso'))
    expect(puts().map(([url]) => url)).toEqual(['/api/curso/a/progresso', '/api/curso/b/progresso'])
    await act(async () => a.resolve(resposta({})))
    expect(puts()).toHaveLength(3)
    expect(puts()[2][0]).toBe('/api/curso/a/progresso')
    expect(JSON.parse(puts()[2][1].body)).toEqual({ posicaoSegundos: 45, concluido: false })
    expect(screen.getByText('continuar de 0:45')).toBeInTheDocument()
    expect(screen.queryByText('continuar de 0:30')).not.toBeInTheDocument()
    await act(async () => b.resolve(resposta({})))
    expect(screen.getByText('continuar de 0:30')).toBeInTheDocument()
  })

  it.each(['http', 'rede'])('drena a fila após falha antiga e permite repetir só o último progresso: %s', async (tipo) => {
    const antigo = pendente()
    const recente = pendente()
    let envios = 0
    fetch.mockImplementation((url) => {
      if (url === '/api/curso') return Promise.resolve(resposta(videos))
      if (url.endsWith('/url')) return Promise.resolve(resposta({ url: 'https://example.test/a.mp4' }))
      envios += 1
      return envios === 1 ? antigo.promise : envios === 2 ? recente.promise : Promise.resolve(resposta({}))
    })
    render(<Curso />)
    fireEvent.click(await screen.findByText('Aula A'))
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull())
    fireEvent.pause(document.querySelector('video'), { target: { currentTime: 10 } })
    fireEvent.pause(document.querySelector('video'), { target: { currentTime: 25 } })
    expect(envios).toBe(1)
    await act(async () => {
      if (tipo === 'rede') antigo.reject(new Error('offline'))
      else antigo.resolve(resposta({}, false))
    })
    expect(envios).toBe(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => recente.resolve(resposta({}, false)))
    expect(await screen.findByRole('alert')).toHaveTextContent(/salvar.*progresso/i)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('continuar de 0:25')).toBeInTheDocument()
    const puts = fetch.mock.calls.filter(([url]) => url.endsWith('/progresso'))
    expect(puts.map(([, options]) => JSON.parse(options.body))).toEqual([
      { posicaoSegundos: 10, concluido: false },
      { posicaoSegundos: 25, concluido: false },
      { posicaoSegundos: 25, concluido: false },
    ])
  })
})
