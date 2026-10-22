import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EnviarDemoDaPartida from '../components/EnviarDemoDaPartida.jsx'

const partidaBase = {
  id: '11111111-1111-1111-1111-111111111111',
  map: 'de_inferno',
  source: 'faceit',
  temDemo: false,
  demoUpload: null,
  players: [{ steamId: '765' }, { steamId: '999' }],
}

function arquivo(nome, conteudo) {
  return new File([conteudo], nome, { type: 'application/octet-stream' })
}

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('EnviarDemoDaPartida', () => {
  it('envia .dem.gz intacto e deixa a validação do conteúdo para o Coletor', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'u1', uploadUrl: 'https://r2/put' }) })
      .mockResolvedValueOnce({ ok: true })
    const comprimido = arquivo('partida.DEM.GZ', 'bytes comprimidos de_mirage')
    render(<EnviarDemoDaPartida partida={partidaBase} euSteamId="765" />)
    await userEvent.click(screen.getByRole('button', { name: /enviar demo desta partida/i }))
    await userEvent.upload(screen.getByLabelText(/arquivo/i), comprimido)
    await waitFor(() => expect(screen.getByRole('button', { name: /^enviar$/i })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: /^enviar$/i }))
    await screen.findByText(/envio recebido/i)
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      filename: comprimido.name, tamanho: comprimido.size, matchId: partidaBase.id,
    })
    expect(global.fetch.mock.calls[1][1].body).toBe(comprimido)
  })

  it('não aparece pra quem não jogou a partida', () => {
    const { container } = render(<EnviarDemoDaPartida partida={partidaBase} euSteamId="000" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('não aparece quando a partida já tem demo', () => {
    const { container } = render(
      <EnviarDemoDaPartida partida={{ ...partidaBase, temDemo: true }} euSteamId="765" />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('mostra o botão pra quem jogou numa partida sem demo', () => {
    render(<EnviarDemoDaPartida partida={partidaBase} euSteamId="765" />)
    expect(screen.getByRole('button', { name: /enviar demo desta partida/i })).toBeInTheDocument()
  })

  it('não aparece numa partida que não é FACEIT (servidor recusaria com 409)', () => {
    const { container } = render(
      <EnviarDemoDaPartida partida={{ ...partidaBase, source: 'valve_mm' }} euSteamId="765" />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('com envio em andamento: mostra o aviso e nenhum botão', () => {
    render(
      <EnviarDemoDaPartida
        partida={{ ...partidaBase, demoUpload: { status: 'processando', erro: null, enviadoPorVoce: false } }}
        euSteamId="765"
      />,
    )
    expect(screen.getByText(/em processamento/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enviar demo desta partida/i })).toBeNull()
  })

  it('falha de quem enviou: mostra o motivo e deixa enviar outra', () => {
    render(
      <EnviarDemoDaPartida
        partida={{
          ...partidaBase,
          demoUpload: { status: 'falhou', erro: 'o mapa da demo não confere', enviadoPorVoce: true },
        }}
        euSteamId="765"
      />,
    )
    expect(screen.getByText(/o mapa da demo não confere/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enviar demo desta partida/i })).toBeInTheDocument()
  })

  it('barra a demo de outro mapa antes de subir o arquivo', async () => {
    render(<EnviarDemoDaPartida partida={partidaBase} euSteamId="765" />)
    await userEvent.click(screen.getByRole('button', { name: /enviar demo desta partida/i }))
    const input = screen.getByLabelText(/arquivo/i)
    await userEvent.upload(input, arquivo('demo.dem', 'PBDEMS2 xxxx de_mirage xxxx'))
    await waitFor(() => expect(screen.getByText(/mirage/i)).toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('cabeçalho sem nome de mapa nenhum deixa o envio seguir', async () => {
    render(<EnviarDemoDaPartida partida={partidaBase} euSteamId="765" />)
    await userEvent.click(screen.getByRole('button', { name: /enviar demo desta partida/i }))
    const input = screen.getByLabelText(/arquivo/i)
    await userEvent.upload(input, arquivo('demo.dem', 'PBDEMS2 sem nome de mapa nenhum aqui'))
    await waitFor(() => expect(screen.getByText(/demo\.dem/i)).toBeInTheDocument())
    expect(screen.queryByText(/mapa desconhecido/i)).toBeNull()
    expect(screen.getByRole('button', { name: /^enviar$/i })).not.toBeDisabled()
  })

  it('partida sem mapa registrado (stats-only) deixa o envio seguir mesmo com mapa no cabeçalho', async () => {
    render(<EnviarDemoDaPartida partida={{ ...partidaBase, map: '' }} euSteamId="765" />)
    await userEvent.click(screen.getByRole('button', { name: /enviar demo desta partida/i }))
    const input = screen.getByLabelText(/arquivo/i)
    await userEvent.upload(input, arquivo('demo.dem', 'PBDEMS2 xxxx de_mirage xxxx'))
    await waitFor(() => expect(screen.getByText(/demo\.dem/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^enviar$/i })).not.toBeDisabled()
  })

  it('caminho feliz: pede a url e faz o PUT no R2', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'u1', uploadUrl: 'https://r2/put' }) })
      .mockResolvedValueOnce({ ok: true })
    const onEnviado = vi.fn()
    render(<EnviarDemoDaPartida partida={partidaBase} euSteamId="765" onEnviado={onEnviado} />)
    await userEvent.click(screen.getByRole('button', { name: /enviar demo desta partida/i }))
    await userEvent.upload(
      screen.getByLabelText(/arquivo/i),
      arquivo('demo.dem', 'PBDEMS2 xxxx de_inferno xxxx'),
    )
    await userEvent.click(screen.getByRole('button', { name: /^enviar$/i }))

    await waitFor(() => expect(onEnviado).toHaveBeenCalled())
    expect(global.fetch.mock.calls[0][0]).toBe('/api/upload/upload-url')
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).matchId).toBe(partidaBase.id)
    expect(global.fetch.mock.calls[1][0]).toBe('https://r2/put')
    expect(global.fetch.mock.calls[1][1].method).toBe('PUT')
    expect(screen.getByText(/envio recebido/i)).toBeInTheDocument()
  })

  it('vazamento de byte no cabeçalho (de_infernor) não barra demo legítima', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'u1', uploadUrl: 'https://r2/put' }) })
      .mockResolvedValueOnce({ ok: true })
    render(<EnviarDemoDaPartida partida={partidaBase} euSteamId="765" />)
    await userEvent.click(screen.getByRole('button', { name: /enviar demo desta partida/i }))
    const input = screen.getByLabelText(/arquivo/i)
    // protobuf não tem strings null-terminated: o byte seguinte a "de_inferno" pode
    // cair na classe de caracteres da regex e virar "de_infernorXX" no match.
    await userEvent.upload(input, arquivo('demo.dem', 'PBDEMS2 xxxx de_infernorXX xxxx'))
    await waitFor(() => expect(screen.getByText(/demo\.dem/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^enviar$/i })).not.toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /^enviar$/i }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(global.fetch.mock.calls[0][0]).toBe('/api/upload/upload-url')
  })

  it('limpa o input ao rejeitar extensão inválida, permitindo escolher o mesmo arquivo de novo', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<EnviarDemoDaPartida partida={partidaBase} euSteamId="765" />)
    await user.click(screen.getByRole('button', { name: /enviar demo desta partida/i }))
    const input = screen.getByLabelText(/arquivo/i)
    await user.upload(input, arquivo('demo.txt', 'não é uma demo'))
    await waitFor(() => expect(screen.getByText(/só arquivos \.dem ou \.dem\.gz são aceitos/i)).toBeInTheDocument())
    expect(input.value).toBe('')
  })

  it('limpa o input ao rejeitar mapa divergente, permitindo escolher o mesmo arquivo de novo', async () => {
    render(<EnviarDemoDaPartida partida={partidaBase} euSteamId="765" />)
    await userEvent.click(screen.getByRole('button', { name: /enviar demo desta partida/i }))
    const input = screen.getByLabelText(/arquivo/i)
    await userEvent.upload(input, arquivo('demo.dem', 'PBDEMS2 xxxx de_mirage xxxx'))
    await waitFor(() => expect(screen.getByText(/mirage/i)).toBeInTheDocument())
    expect(input.value).toBe('')
  })

  it('arquivo rejeitado não deixa o anterior armado', async () => {
    render(<EnviarDemoDaPartida partida={partidaBase} euSteamId="765" />)
    await userEvent.click(screen.getByRole('button', { name: /enviar demo desta partida/i }))
    const input = screen.getByLabelText(/arquivo/i)
    await userEvent.upload(input, arquivo('valido.dem', 'PBDEMS2 xxxx de_inferno xxxx'))
    await waitFor(() => expect(screen.getByText(/valido\.dem/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^enviar$/i })).not.toBeDisabled()

    await userEvent.upload(input, arquivo('errado.dem', 'PBDEMS2 xxxx de_mirage xxxx'))
    await waitFor(() => expect(screen.getByText(/mirage/i)).toBeInTheDocument())

    expect(screen.queryByText(/valido\.dem/i)).toBeNull()
    expect(screen.getByRole('button', { name: /^enviar$/i })).toBeDisabled()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
