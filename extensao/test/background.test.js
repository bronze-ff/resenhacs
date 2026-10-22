import { describe, expect, it, vi } from 'vitest'
import { iniciarBackground } from '../src/background.js'
import { API_BASE, SITE_ORIGIN } from '../src/config.js'
import { criarChrome, download, faceitMatchId, hosts, matchId, resposta } from './fakes.js'

function preparar(inicial) {
  const fake = criarChrome(inicial)
  const fetchFn = vi.fn()
    .mockResolvedValueOnce(resposta(200, { token: 'resenha-renovado', expiraEm: '2026-10-23T12:00:00Z' }))
    .mockResolvedValueOnce(resposta(202, { id: matchId, matchId }))
  iniciarBackground(fake.chrome, { fetchFn, hosts, agora: () => '2026-10-22T12:00:00Z' })
  return { ...fake, fetchFn }
}

function mensagem(listener, valor, sender) {
  return new Promise((resolve) => { if (listener(valor, sender, resolve) !== true) resolve(undefined) })
}
const popup = { id: 'extensao-teste', url: 'chrome-extension://extensao-teste/popup/popup.html' }

describe('worker de downloads e I9 mock', () => {
  it('renova antes de enviar só os dois campos I9, sem cookies nem redirects', async () => {
    const { chrome, listeners, fetchFn } = preparar()
    await listeners.created(download)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(fetchFn.mock.calls[0][0]).toBe(`${API_BASE}/renovar`)
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer resenha-ficticio')
    const [url, opcoes] = fetchFn.mock.calls[1]
    expect(url).toBe(`${API_BASE}/envio`)
    expect(opcoes).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { Authorization: 'Bearer resenha-renovado' } })
    expect(JSON.parse(opcoes.body)).toEqual({ faceitMatchId, downloadUrl: download.url })
    expect(chrome.storage.local.dados.historico[0]).toMatchObject({ faceitMatchId, matchId, estado: 'enviado' })
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' })
    expect(chrome.storage.local.dados.token).toBe('resenha-renovado')
  })

  it('downloads alheios não causam fetch, escrita em storage nem log', async () => {
    const { chrome, listeners, fetchFn } = preparar()
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await listeners.created({ ...download, url: 'https://outro.test/privado.dem.gz' })
    chrome.downloads.search.mockResolvedValueOnce([{ ...download, finalUrl: 'https://outro.test/privado.dem.gz' }])
    await listeners.changed({ id: 7, filename: { current: 'privado.dem.gz' } })
    expect(fetchFn).not.toHaveBeenCalled()
    for (const area of [chrome.storage.local, chrome.storage.session]) {
      expect(area.set).not.toHaveBeenCalled()
      expect(area.remove).not.toHaveBeenCalled()
    }
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('eventos concorrentes e reinício do worker tratam cada download id uma vez', async () => {
    const { chrome, listeners, fetchFn } = preparar()
    await Promise.all([listeners.created(download), listeners.created(download), listeners.changed({ id: 7, finalUrl: { current: download.url } })])
    iniciarBackground(chrome, { fetchFn, hosts })
    await listeners.created(download)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(chrome.storage.session.dados.downloadIds).toEqual([7])
  })

  it('onChanged reconhece filename ou finalUrl que chegaram depois', async () => {
    const { chrome, listeners, fetchFn } = preparar()
    await listeners.created({ ...download, url: 'https://demos.faceit.test/arquivo', filename: '' })
    expect(fetchFn).not.toHaveBeenCalled()
    await listeners.changed({ id: 7, filename: { current: 'demo.dem.gz' } })
    expect(chrome.downloads.search).toHaveBeenCalledWith({ id: 7 })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('Demo sem id deixa histórico neutro e nunca envia ou guarda nome/referrer/link', async () => {
    const { chrome, listeners, fetchFn } = preparar()
    await listeners.created({ ...download, referrer: '' })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(chrome.storage.local.dados.historico[0].mensagem).toBe('Não reconheci a Partida desse download.')
    const persistido = JSON.stringify([chrome.storage.local.dados, chrome.storage.session.dados])
    for (const proibido of [download.url, download.filename, download.referrer, 'assinatura']) expect(persistido).not.toContain(proibido)
  })

  it('sem conexão só pede conectar no site', async () => {
    const { chrome, listeners, fetchFn } = preparar({})
    await listeners.created(download)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(chrome.storage.local.dados.historico[0].mensagem).toContain('Conecte')
  })

  it.each(['renovar', 'envio'])('401 em %s apaga token e registra reconexão', async (etapa) => {
    const { chrome, listeners, fetchFn } = preparar()
    fetchFn.mockReset()
    if (etapa === 'envio') fetchFn.mockResolvedValueOnce(resposta(200, { token: 'resenha-renovado' }))
    fetchFn.mockResolvedValueOnce(resposta(401, { erro: 'Não autenticado' }))
    await listeners.created(download)
    expect(chrome.storage.local.dados.token).toBeUndefined()
    expect(chrome.storage.local.dados.historico[0].mensagem).toBe('Conecte a extensão de novo no site.')
    expect(fetchFn).toHaveBeenCalledTimes(etapa === 'envio' ? 2 : 1)
  })

  it('falha de rede na renovação não envia e preserva a conexão', async () => {
    const { chrome, listeners, fetchFn } = preparar()
    fetchFn.mockReset().mockRejectedValueOnce(new Error('erro contendo link privado'))
    await listeners.created(download)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(chrome.storage.local.dados.token).toBe('resenha-ficticio')
    expect(chrome.storage.local.dados.historico[0].mensagem).not.toContain('privado')
  })

  it.each([
    [409, 'Esta partida já tem demo processada', 'já tinha Demo'],
    [409, 'Já existe um envio em andamento pra esta partida', 'envio em andamento'],
    [404, 'Partida não encontrada no ResenhaCS', 'Partida não encontrada'],
    [429, 'Limite de envios da extensão atingido. Tente amanhã.', 'erro'],
  ])('mostra estado I9 %i %s', async (status, erro, estado) => {
    const { chrome, listeners, fetchFn } = preparar()
    fetchFn.mockReset().mockResolvedValueOnce(resposta(200, { token: 'novo' })).mockResolvedValueOnce(resposta(status, { erro }))
    await listeners.created(download)
    expect(chrome.storage.local.dados.historico[0]).toMatchObject({ estado, mensagem: erro })
    expect(chrome.storage.local.dados.novos).toBe(0)
  })

  it('resposta malformada e mensagem não prevista nunca persistem links/tokens', async () => {
    const { chrome, listeners, fetchFn } = preparar()
    fetchFn.mockReset().mockResolvedValueOnce(resposta(200, { token: 'novo' })).mockResolvedValueOnce(resposta(500, { erro: download.url }))
    await listeners.created(download)
    expect(JSON.stringify(chrome.storage.local.dados)).not.toContain(download.url)
    expect(chrome.storage.local.dados.historico[0].estado).toBe('erro')
    expect(chrome.storage.local.dados.historico[0].matchId).toBeUndefined()
  })

  it('202 sem UUID válido registra enviado sem inventar link ou sugerir reenvio', async () => {
    const { chrome, listeners, fetchFn } = preparar()
    fetchFn.mockReset().mockResolvedValueOnce(resposta(200, { token: 'novo' })).mockResolvedValueOnce(resposta(202, { matchId: 'invalido' }))
    await listeners.created(download)
    expect(chrome.storage.local.dados.historico[0]).toMatchObject({ estado: 'enviado', mensagem: 'Demo enviada ao ResenhaCS.' })
    expect(chrome.storage.local.dados.historico[0].matchId).toBeUndefined()
    expect(chrome.storage.local.dados.novos).toBe(1)
  })

  it('mantém só 20 tentativas e conta apenas envios novos no badge', async () => {
    const { chrome, listeners } = preparar({ token: 'antigo', novos: 4, historico: Array.from({ length: 20 }, (_, i) => ({ data: String(i), estado: 'erro' })) })
    await listeners.created(download)
    expect(chrome.storage.local.dados.historico).toHaveLength(20)
    expect(chrome.storage.local.dados.novos).toBe(5)
    const estado = await mensagem(listeners.message, { tipo: 'resenha-historico-lido' }, popup)
    expect(estado).not.toHaveProperty('token')
    expect(chrome.storage.local.dados.novos).toBe(0)
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
  })
})

describe('fronteiras das mensagens', () => {
  it('aceita token só do site e limpa histórico da conexão anterior', async () => {
    const { chrome, listeners } = preparar({ token: 'antigo', historico: [{ estado: 'enviado' }], novos: 2 })
    const ack = await mensagem(listeners.external, { tipo: 'resenha-token', token: 'novo' }, { origin: SITE_ORIGIN })
    expect(ack).toEqual({ ok: true })
    expect(chrome.storage.local.dados).toEqual({ token: 'novo', historico: [], novos: 0 })
    expect(chrome.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' })
  })

  it('ACK positivo só chega depois que storage confirma; falha responde erro neutro', async () => {
    const { chrome, listeners } = preparar()
    const salvar = chrome.storage.local.set.getMockImplementation()
    let liberar
    const bloqueio = new Promise((resolve) => { liberar = resolve })
    chrome.storage.local.set.mockImplementationOnce(async (valor) => { await bloqueio; return salvar(valor) })
    let respondeu = false
    const pendente = mensagem(listeners.external, { tipo: 'resenha-token', token: 'novo' }, { origin: SITE_ORIGIN }).then((ack) => { respondeu = true; return ack })
    await vi.waitFor(() => expect(chrome.storage.local.set).toHaveBeenCalled())
    expect(respondeu).toBe(false)
    liberar()
    expect(await pendente).toEqual({ ok: true })
    chrome.storage.local.set.mockRejectedValueOnce(new Error('dado privado no erro do storage'))
    expect(await mensagem(listeners.external, { tipo: 'resenha-token', token: 'outro' }, { origin: SITE_ORIGIN }))
      .toEqual({ erro: 'Não foi possível atualizar a extensão. Tente novamente.' })
  })

  it.each([
    [{ tipo: 'resenha-token', token: 'novo' }, { origin: 'https://evil.test' }],
    [{ tipo: 'resenha-token', token: 'novo' }, { origin: `${SITE_ORIGIN}.evil.test` }],
    [{ tipo: 'resenha-token', token: 'novo', downloadUrl: download.url }, { origin: SITE_ORIGIN }],
    [{ tipo: 'resenha-token', token: 'x'.repeat(2049) }, { origin: SITE_ORIGIN }],
    [{ tipo: 'resenha-token', token: '' }, { origin: SITE_ORIGIN }],
    [{ tipo: 'resenha-envio', token: 'novo' }, { origin: SITE_ORIGIN }],
  ])('descarta origem ou esquema externo não autorizado', async (valor, sender) => {
    const { chrome, listeners, fetchFn } = preparar()
    expect(await mensagem(listeners.external, valor, sender)).toBeUndefined()
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('mensagens internas só do popup e sem campos extras; desconectar apaga token e histórico', async () => {
    const { chrome, listeners } = preparar({ token: 'antigo', historico: [{ estado: 'enviado' }], novos: 2 })
    for (const sender of [{ id: 'outra-extensao', url: popup.url }, { id: popup.id, url: 'https://www.faceit.com/' }]) {
      expect(await mensagem(listeners.message, { tipo: 'resenha-desconectar' }, sender)).toBeUndefined()
    }
    expect(await mensagem(listeners.message, { tipo: 'resenha-desconectar', extra: true }, popup)).toBeUndefined()
    const estado = await mensagem(listeners.message, { tipo: 'resenha-desconectar' }, popup)
    expect(estado).toEqual({ conectada: false, historico: [], novos: 0 })
    expect(chrome.storage.local.dados).toEqual({})
  })
})
