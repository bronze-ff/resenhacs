import { describe, it, expect, vi, afterEach } from 'vitest'
import { pedirClipe } from '../src/allstarClip.js'

describe('pedirClipe', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('manda o payload certo pro /cs/clip/potg e devolve o requestId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ requestId: 'req-1' }) })
    vi.stubGlobal('fetch', fetchMock)

    const requestId = await pedirClipe({
      apiKey: 'k', steamId: '765', nick: 'bronze',
      demoUrl: 'https://r2/demo', roundNumber: 14, webhookUrl: 'https://site/api/allstar/webhook',
      metadata: [{ key: 'highlightId', value: 'h1' }],
    })
    expect(requestId).toBe('req-1')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://prt.allstar.gg/cs/clip/potg')
    expect(opts.headers['X-Api-Key']).toBe('k')
    expect(JSON.parse(opts.body)).toEqual({
      steamId: '765', demoUrl: 'https://r2/demo', webhookUrl: 'https://site/api/allstar/webhook',
      rounds: [14], username: 'bronze', metadata: [{ key: 'highlightId', value: 'h1' }],
    })
  })

  it('sem nick usa o steamId como username', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ requestId: 'req-1' }) })
    vi.stubGlobal('fetch', fetchMock)
    await pedirClipe({ apiKey: 'k', steamId: '765', demoUrl: 'u', roundNumber: 1, webhookUrl: 'w' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).username).toBe('765')
  })

  it('resposta não-ok: levanta erro com o status e o corpo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'Failed to find use case' }))
    await expect(
      pedirClipe({ apiKey: 'k', steamId: '765', demoUrl: 'u', roundNumber: 1, webhookUrl: 'w' }),
    ).rejects.toThrow('403')
  })

  it('204 (dedupe do Allstar, sem corpo): levanta erro explícito em vez de quebrar no json()', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('no body') } }))
    await expect(
      pedirClipe({ apiKey: 'k', steamId: '765', demoUrl: 'u', roundNumber: 1, webhookUrl: 'w' }),
    ).rejects.toThrow('deduplicou')
  })

  it('sem requestId na resposta: levanta erro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ status: 'ok' }) }))
    await expect(
      pedirClipe({ apiKey: 'k', steamId: '765', demoUrl: 'u', roundNumber: 1, webhookUrl: 'w' }),
    ).rejects.toThrow('sem requestId')
  })
})
