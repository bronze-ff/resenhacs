import { describe, it, expect, vi, afterEach } from 'vitest'
import { criarClienteDemoSlap, montarClipes, resumirStatusRender, ErroDemoSlap, JANELA } from '../src/demoSlap.js'

afterEach(() => vi.unstubAllGlobals())

describe('montarClipes', () => {
  it('kill sozinha: começa 4 s antes e dura 7 s, na visão pedida', () => {
    expect(montarClipes([{ tick: 10000, pov: '76561198000000001' }], 64)).toEqual([
      { tick: 10000 - 4 * 64, duration: JANELA.sozinha.antes + JANELA.sozinha.depois, povSteamId: '76561198000000001' },
    ])
  })

  it('montagem: trechos curtos (3 s antes, 5 s no total)', () => {
    const clipes = montarClipes([{ tick: 5000, pov: 'a' }, { tick: 9000, pov: 'b' }], 64)
    expect(clipes.map((c) => c.tick)).toEqual([5000 - 192, 9000 - 192])
    expect(clipes.every((c) => c.duration === 5)).toBe(true)
  })

  it('tick nunca negativo; tickRate ausente usa 64', () => {
    expect(montarClipes([{ tick: 10, pov: 'a' }], null)[0].tick).toBe(0)
  })
})

describe('resumirStatusRender', () => {
  it('done só quando todos os ids do clipe terminaram', () => {
    expect(resumirStatusRender({ a: { status: 'done' }, b: { status: 'working' } }, ['a', 'b'])).toEqual({ status: 'working' })
    expect(resumirStatusRender({ a: { status: 'done' }, b: { status: 'done' }, c: { status: 'error' } }, ['a', 'b'])).toEqual({ status: 'done' })
  })

  it('erro de qualquer trecho vira erro com a mensagem da DEMO-SLAP', () => {
    expect(resumirStatusRender({ a: { status: 'error', errorMessage: 'Demo incompatível' } }, ['a']))
      .toEqual({ status: 'error', erro: 'Demo incompatível' })
  })

  it('id ausente no mapa segue em andamento', () => {
    expect(resumirStatusRender({}, ['a'])).toEqual({ status: 'working' })
  })
})

describe('criarClienteDemoSlap', () => {
  it('encaminha o signal para cancelar a análise no fetch', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobId: 'an1' }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await criarClienteDemoSlap('k').analisar('https://x/demo.dem', { signal: controller.signal })).toBe('an1')
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })
  it('manda a chave no header x-api-key e o corpo do render-custom', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobIds: ['v1'] }) })
    vi.stubGlobal('fetch', fetchMock)
    const ids = await criarClienteDemoSlap('k').renderizar('an1', [{ tick: 1, duration: 7, povSteamId: 'p' }])
    expect(ids).toEqual(['v1'])
    const [url, opcoes] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.demo-slap.net/public-api/render-custom/an1')
    expect(opcoes.headers['x-api-key']).toBe('k')
    expect(JSON.parse(opcoes.body)).toEqual({ customClips: [{ tick: 1, duration: 7, povSteamId: 'p' }] })
  })

  it('erro da API vira ErroDemoSlap com a mensagem deles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, text: async () => JSON.stringify({ message: 'Not enough credits' }),
    }))
    const p = criarClienteDemoSlap('k').analisar('https://x/demo.dem')
    await expect(p).rejects.toBeInstanceOf(ErroDemoSlap)
    await expect(p).rejects.toMatchObject({ status: 400, mensagem: 'Not enough credits' })
  })
})
