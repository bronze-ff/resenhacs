// site/client/src/test/ConectarExtensao.test.jsx
// X-UI: "Conectar extensão" em /conta e seção #extensao em /privacidade. A I9 (POST
// /api/extensao/token) é mockada: o X-SRV ainda não existe. A entrega do token à extensão
// é chrome.runtime.sendMessage(EXTENSAO_ID, { tipo: 'resenha-token', token }).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { conectarExtensao, EXTENSAO_ID } from '../lib/extensao.js'
import Perfil from '../pages/Perfil.jsx'
import Privacidade from '../pages/Privacidade.jsx'

afterEach(() => {
  vi.unstubAllGlobals()
  delete globalThis.chrome
})

const ok = (corpo) => Promise.resolve({ ok: true, status: 200, json: async () => corpo })
const status = (codigo, corpo = {}) => Promise.resolve({ ok: false, status: codigo, json: async () => corpo })

const ID = 'abcdefghijklmnopabcdefghijklmnop'
const TOKEN = 'tok.de.teste'

// Fake de chrome.runtime: `erro` simula a extensão ausente (lastError no callback);
// `ack` é a resposta da extensão (sendResponse).
// ACK real do X-EXT (Faro): { ok: true } depois de guardar; { erro } se falhar.
function fakeRuntime(opcoes = {}) {
  const { erro = null } = opcoes
  const ack = 'ack' in opcoes ? opcoes.ack : { ok: true }
  const runtime = {
    lastError: undefined,
    sendMessage: vi.fn((id, msg, cb) => {
      runtime.lastError = erro ? { message: erro } : undefined
      cb?.(erro ? undefined : ack)
      runtime.lastError = undefined
    }),
  }
  return runtime
}

function fakeFetch(resposta = () => ok({ token: TOKEN, expiraEm: '2026-10-23T12:00:00.000Z' })) {
  return vi.fn().mockImplementation((url) => (String(url) === '/api/extensao/token' ? resposta() : ok({})))
}

describe('conectarExtensao', () => {
  it('sem ID da extensão (antes da loja) não pede token: falha fechada', async () => {
    expect(EXTENSAO_ID).toBe('')
    const fetchImpl = fakeFetch()
    const runtime = fakeRuntime()
    expect(await conectarExtensao({ fetchImpl, runtime })).toEqual({ ok: false, motivo: 'indisponivel' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('navegador sem chrome.runtime não pede token', async () => {
    const fetchImpl = fakeFetch()
    expect(await conectarExtensao({ extensaoId: ID, fetchImpl, runtime: undefined })).toEqual({ ok: false, motivo: 'sem-extensao' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('pede POST /token e entrega só { tipo, token } à extensão', async () => {
    const fetchImpl = fakeFetch()
    const runtime = fakeRuntime()
    expect(await conectarExtensao({ extensaoId: ID, fetchImpl, runtime })).toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledWith('/api/extensao/token', expect.objectContaining({ method: 'POST' }))
    expect(runtime.sendMessage).toHaveBeenCalledTimes(1)
    const [id, msg] = runtime.sendMessage.mock.calls[0]
    expect(id).toBe(ID)
    expect(msg).toEqual({ tipo: 'resenha-token', token: TOKEN })
  })

  it('extensão não instalada (lastError) vira sem-extensao', async () => {
    const runtime = fakeRuntime({ erro: 'Could not establish connection. Receiving end does not exist.' })
    expect(await conectarExtensao({ extensaoId: ID, fetchImpl: fakeFetch(), runtime })).toEqual({ ok: false, motivo: 'sem-extensao' })
  })

  it('ACK negativo da extensão (falhou ao guardar) não conta como conectado', async () => {
    for (const ack of [{ ok: false, erro: 'storage cheio' }, { erro: 'storage cheio' }, { ok: 'true' }, {}]) {
      const runtime = fakeRuntime({ ack })
      expect(await conectarExtensao({ extensaoId: ID, fetchImpl: fakeFetch(), runtime }), JSON.stringify(ack))
        .toEqual({ ok: false, motivo: 'extensao' })
    }
  })

  it('ACK ausente sem lastError vira sem-extensao', async () => {
    const runtime = fakeRuntime({ ack: undefined })
    expect(await conectarExtensao({ extensaoId: ID, fetchImpl: fakeFetch(), runtime })).toEqual({ ok: false, motivo: 'sem-extensao' })
  })

  it('sendMessage que lança vira sem-extensao', async () => {
    const runtime = { sendMessage: vi.fn(() => { throw new Error('Invalid extension id') }) }
    expect(await conectarExtensao({ extensaoId: ID, fetchImpl: fakeFetch(), runtime })).toEqual({ ok: false, motivo: 'sem-extensao' })
  })

  it('erro do server devolve a mensagem e não chama a extensão', async () => {
    const runtime = fakeRuntime()
    const fetchImpl = fakeFetch(() => status(429, { erro: 'Muitas tentativas. Tente de novo em instantes.' }))
    expect(await conectarExtensao({ extensaoId: ID, fetchImpl, runtime }))
      .toEqual({ ok: false, motivo: 'servidor', mensagem: 'Muitas tentativas. Tente de novo em instantes.' })
    expect(runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('resposta sem token ou falha de rede vira servidor sem mensagem', async () => {
    const runtime = fakeRuntime()
    expect(await conectarExtensao({ extensaoId: ID, fetchImpl: fakeFetch(() => ok({})), runtime })).toEqual({ ok: false, motivo: 'servidor' })
    expect(await conectarExtensao({ extensaoId: ID, fetchImpl: fakeFetch(() => Promise.reject(new TypeError('offline'))), runtime }))
      .toEqual({ ok: false, motivo: 'servidor' })
    expect(runtime.sendMessage).not.toHaveBeenCalled()
  })
})

describe('Minha conta — Extensão FACEIT', () => {
  function renderConta(conectar, extensaoDisponivel = true) {
    vi.stubGlobal('fetch', fakeFetch())
    return render(<MemoryRouter><Perfil conectar={conectar} extensaoDisponivel={extensaoDisponivel} /></MemoryRouter>)
  }
  const secao = () => screen.getByRole('region', { name: 'Extensão FACEIT' })

  it('explica o propósito e linka a privacidade da extensão', () => {
    renderConta(vi.fn())
    expect(within(secao()).getByText(/Watch Demo/)).toBeInTheDocument()
    expect(within(secao()).getByRole('link', { name: /como a extensão usa seus dados/i })).toHaveAttribute('href', '/privacidade#extensao')
  })

  it('conectado troca o texto dentro do status que já estava montado', async () => {
    const conectar = vi.fn().mockResolvedValue({ ok: true })
    renderConta(conectar)
    const status = within(secao()).getByRole('status')
    expect(status).toHaveTextContent('')
    fireEvent.click(within(secao()).getByRole('button', { name: 'Conectar extensão' }))
    expect(await within(secao()).findByText(/Extensão conectada\./)).toBe(status)
    expect(within(secao()).getByRole('status')).toBe(status)
    expect(conectar).toHaveBeenCalledTimes(1)
  })

  it('sem ID da loja: botão desativado com a nota, sem chamar conectar', () => {
    const conectar = vi.fn()
    renderConta(conectar, false)
    const botao = within(secao()).getByRole('button', { name: 'Conectar extensão' })
    expect(botao).toBeDisabled()
    expect(botao).toHaveAccessibleDescription('A extensão ainda não está disponível.')
    fireEvent.click(botao)
    expect(conectar).not.toHaveBeenCalled()
  })

  it('padrão da página segue EXTENSAO_ID (vazio até a loja): botão desativado', () => {
    vi.stubGlobal('fetch', fakeFetch())
    render(<MemoryRouter><Perfil conectar={vi.fn()} /></MemoryRouter>)
    expect(within(secao()).getByRole('button', { name: 'Conectar extensão' })).toBeDisabled()
  })

  it('sem extensão no navegador explica o que fazer', async () => {
    renderConta(vi.fn().mockResolvedValue({ ok: false, motivo: 'sem-extensao' }))
    fireEvent.click(within(secao()).getByRole('button', { name: 'Conectar extensão' }))
    expect(await within(secao()).findByRole('alert')).toHaveTextContent('Não achei a extensão neste navegador.')
  })

  it('extensão que não guardou a conexão mostra mensagem neutra', async () => {
    renderConta(vi.fn().mockResolvedValue({ ok: false, motivo: 'extensao' }))
    fireEvent.click(within(secao()).getByRole('button', { name: 'Conectar extensão' }))
    expect(await within(secao()).findByRole('alert')).toHaveTextContent('A extensão não conseguiu guardar a conexão. Tente de novo.')
    expect(within(secao()).getByRole('status')).toHaveTextContent('')
  })

  it('extensão ainda não publicada', async () => {
    renderConta(vi.fn().mockResolvedValue({ ok: false, motivo: 'indisponivel' }))
    fireEvent.click(within(secao()).getByRole('button', { name: 'Conectar extensão' }))
    expect(await within(secao()).findByRole('alert')).toHaveTextContent('A extensão ainda não está disponível.')
  })

  it('erro do server mostra a mensagem dele', async () => {
    renderConta(vi.fn().mockResolvedValue({ ok: false, motivo: 'servidor', mensagem: 'Não autenticado' }))
    fireEvent.click(within(secao()).getByRole('button', { name: 'Conectar extensão' }))
    expect(await within(secao()).findByRole('alert')).toHaveTextContent('Não autenticado')
  })

  it('botão fica desativado enquanto conecta', async () => {
    let resolver
    renderConta(vi.fn(() => new Promise((r) => { resolver = r })))
    const botao = within(secao()).getByRole('button', { name: 'Conectar extensão' })
    fireEvent.click(botao)
    expect(await within(secao()).findByRole('button', { name: 'Conectando…' })).toBeDisabled()
    resolver({ ok: true })
    expect(await within(secao()).findByText(/Extensão conectada\./)).toBeInTheDocument()
  })
})

describe('Privacidade — #extensao', () => {
  it('tem a seção com o texto de dados da loja', () => {
    render(<MemoryRouter><Privacidade /></MemoryRouter>)
    const s = document.getElementById('extensao')
    expect(s).not.toBeNull()
    expect(within(s).getByRole('heading', { name: 'Extensão FACEIT' })).toBeInTheDocument()
    expect(s).toHaveTextContent('Quando você baixa a Demo de uma Partida FACEIT pelo botão Watch Demo, envia essa Demo ao ResenhaCS.')
    expect(s).toHaveTextContent(/Só downloads de Demo do CDN da FACEIT são considerados; os outros são ignorados na hora, sem guardar nem enviar\./)
    expect(s).toHaveTextContent(/token do ResenhaCS/)
    expect(s).toHaveTextContent(/Não coleta histórico de navegação nem outros downloads\./)
    expect(s).toHaveTextContent(/Não acessa nem automatiza o site da FACEIT\./)
  })
})
