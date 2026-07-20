import { describe, it, expect, vi, afterEach } from 'vitest'
import { useCaseParaKind, pedirClipe } from '../src/allstarClip.js'

describe('useCaseParaKind', () => {
  it('multi-kill/ace usa MH', () => {
    expect(useCaseParaKind('ace')).toBe('MH')
    expect(useCaseParaKind('quad')).toBe('MH')
    expect(useCaseParaKind('triple')).toBe('MH')
  })

  it('resto usa POTG', () => {
    expect(useCaseParaKind('clutch_1v3')).toBe('POTG')
    expect(useCaseParaKind('qualquer_coisa')).toBe('POTG')
  })
})

describe('pedirClipe', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('manda o payload certo pro endpoint unico /api/clip_request e devolve o requestId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ requestId: 'req-1' }) })
    vi.stubGlobal('fetch', fetchMock)

    const requestId = await pedirClipe({
      apiKey: 'k', kind: 'ace', steamId: '765', nick: 'bronze',
      demoUrl: 'https://r2/demo', roundNumber: 14, webhookUrl: 'https://site/api/allstar/webhook',
      metadata: [{ key: 'highlightId', value: 'h1' }],
    })
    expect(requestId).toBe('req-1')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://prt.allstar.gg/api/clip_request')
    expect(opts.headers['X-Api-Key']).toBe('k')
    expect(JSON.parse(opts.body)).toEqual({
      steamId: '765', demoUrl: 'https://r2/demo', webhookUrl: 'https://site/api/allstar/webhook',
      rounds: [14], username: 'bronze', useCase: 'MH', metadata: [{ key: 'highlightId', value: 'h1' }],
    })
  })

  it('sem nick usa o steamId como username', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ requestId: 'req-1' }) })
    vi.stubGlobal('fetch', fetchMock)
    await pedirClipe({ apiKey: 'k', kind: 'potg', steamId: '765', demoUrl: 'u', roundNumber: 1, webhookUrl: 'w' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).username).toBe('765')
  })

  it('resposta não-ok: levanta erro com o status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' }))
    await expect(
      pedirClipe({ apiKey: 'k', kind: 'ace', steamId: '765', demoUrl: 'u', roundNumber: 1, webhookUrl: 'w' }),
    ).rejects.toThrow('429')
  })

  it('sem requestId na resposta: levanta erro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) }))
    await expect(
      pedirClipe({ apiKey: 'k', kind: 'ace', steamId: '765', demoUrl: 'u', roundNumber: 1, webhookUrl: 'w' }),
    ).rejects.toThrow('sem requestId')
  })
})
