import { describe, it, expect, vi } from 'vitest'
import { objetosDoFrame, buscarRoundDoReplay, paramsImportacao } from '../lib/quadroImportar.js'

const ROUND = {
  round: 3,
  frames: [
    { t: 0, players: [] },
    {
      t: 1,
      players: [
        { id: 's1', side: 'T', x: 0.25, y: 0.75, alive: true },
        { id: 's2', side: 'CT', x: 0.6, y: 0.1, alive: true },
        { id: 's3', side: 'CT', x: 0.5, y: 0.5, alive: false },
        { id: 's4', side: 'CT', x: 1.02, y: -0.01, alive: true },
      ],
    },
  ],
}
const REPLAY = { map: 'de_mirage', calibrated: true, tickRate: 8, names: { s1: 'fih', s2: 'x'.repeat(40) }, rounds: [ROUND] }

describe('objetosDoFrame', () => {
  it('converte só os vivos em peças CT/T no radar, com o nick como rótulo', () => {
    const r = objetosDoFrame(REPLAY, 3, 1)
    expect(r.map).toBe('de_mirage')
    expect(r.objetos).toHaveLength(3)
    expect(r.objetos.map((o) => o.tipo)).toEqual(['ct', 'ct', 't'])
    expect(r.objetos.find((o) => o.rotulo === 'fih')).toMatchObject({ tipo: 't', x: 0.25, y: 0.75 })
    expect(r.objetos.find((o) => o.x === 0.6).rotulo).toHaveLength(24)
    // fora do radar por arredondamento: limitado a 0..1
    expect(r.objetos.find((o) => !o.rotulo)).toMatchObject({ x: 1, y: 0 })
    expect(new Set(r.objetos.map((o) => o.id)).size).toBe(3)
  })

  it('tick além do fim usa o último frame', () => {
    expect(objetosDoFrame(REPLAY, 3, 999).frame).toBe(1)
  })

  it('mapa sem calibração ou round sem frames: erro', () => {
    expect(objetosDoFrame({ ...REPLAY, calibrated: false }, 3, 1).erro).toBeTruthy()
    expect(objetosDoFrame(REPLAY, 7, 1).erro).toBeTruthy()
  })
})

describe('buscarRoundDoReplay', () => {
  const resp = (corpo, ok = true) => Promise.resolve({ ok, json: async () => corpo })

  it('formato novo: busca o índice e depois o round', async () => {
    const f = vi.fn((url) => {
      if (url === '/api/matches/m1/replay') return resp({ ...REPLAY, rounds: [{ round: 3, frameCount: 2 }] })
      if (url === '/api/matches/m1/replay/round/3') return resp(ROUND)
      return resp({}, false)
    })
    const r = await buscarRoundDoReplay('m1', 3, f)
    expect(f).toHaveBeenCalledTimes(2)
    expect(r.rounds[0].frames).toHaveLength(2)
  })

  it('formato antigo: o índice já tem frames', async () => {
    const f = vi.fn(() => resp(REPLAY))
    const r = await buscarRoundDoReplay('m1', 3, f)
    expect(f).toHaveBeenCalledTimes(1)
    expect(r.rounds[0]).toBe(ROUND)
  })

  it('replay indisponível: lança', async () => {
    await expect(buscarRoundDoReplay('m1', 3, () => resp({}, false))).rejects.toThrow()
  })
})

describe('paramsImportacao', () => {
  const sp = (q) => new URLSearchParams(q)
  const UUID = '11111111-2222-3333-4444-555555555555'
  it('lê partida/round/tick válidos', () => {
    expect(paramsImportacao(sp(`partida=${UUID}&round=4&tick=120`))).toEqual({ partida: UUID, round: 4, tick: 120 })
  })
  it('rejeita formatos inválidos', () => {
    expect(paramsImportacao(sp('partida=../x&round=1'))).toBeNull()
    expect(paramsImportacao(sp(`partida=${UUID}&round=0`))).toBeNull()
    expect(paramsImportacao(sp(`partida=${UUID}&round=2&tick=-1`))).toBeNull()
    expect(paramsImportacao(sp(''))).toBeNull()
  })
})
