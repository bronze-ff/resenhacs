import { describe, it, expect, vi, afterEach } from 'vitest'
import { pedirMelhorClipeDoJogador } from '../src/allstarClip.js'

describe('pedirMelhorClipeDoJogador', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('manda o payload certo pro /cs/clip/bp (sem round — a Allstar escolhe a melhor jogada do jogador) e devolve o requestId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ requestId: 'req-1' }) })
    vi.stubGlobal('fetch', fetchMock)

    const requestId = await pedirMelhorClipeDoJogador({
      apiKey: 'k', steamId: '765', nick: 'bronze',
      demoUrl: 'https://r2/demo', webhookUrl: 'https://site/api/allstar/webhook',
      metadata: [{ key: 'matchId', value: 'm1' }],
    })
    expect(requestId).toBe('req-1')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://prt.allstar.gg/cs/clip/bp')
    expect(opts.headers['X-Api-Key']).toBe('k')
    expect(JSON.parse(opts.body)).toEqual({
      steamId: '765', demoUrl: 'https://r2/demo', webhookUrl: 'https://site/api/allstar/webhook',
      username: 'bronze', metadata: [{ key: 'matchId', value: 'm1' }],
    })
    expect(JSON.parse(opts.body)).not.toHaveProperty('rounds')
  })

  it('sem nick usa o steamId como username', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ requestId: 'req-1' }) })
    vi.stubGlobal('fetch', fetchMock)
    await pedirMelhorClipeDoJogador({ apiKey: 'k', steamId: '765', demoUrl: 'u', webhookUrl: 'w' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).username).toBe('765')
  })

  it('resposta não-ok: levanta erro com o status e o corpo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'Failed to find use case' }))
    await expect(
      pedirMelhorClipeDoJogador({ apiKey: 'k', steamId: '765', demoUrl: 'u', webhookUrl: 'w' }),
    ).rejects.toThrow('403')
  })

  it('204 (dedupe do Allstar, sem corpo): levanta erro explícito em vez de quebrar no json()', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('no body') } }))
    await expect(
      pedirMelhorClipeDoJogador({ apiKey: 'k', steamId: '765', demoUrl: 'u', webhookUrl: 'w' }),
    ).rejects.toThrow('deduplicou')
  })

  it('sem requestId na resposta: levanta erro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ status: 'ok' }) }))
    await expect(
      pedirMelhorClipeDoJogador({ apiKey: 'k', steamId: '765', demoUrl: 'u', webhookUrl: 'w' }),
    ).rejects.toThrow('sem requestId')
  })
})
