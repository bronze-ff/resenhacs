import { describe, it, expect } from 'vitest'
import {
  frameDaKill, montarTimeline, posicaoNaTimeline, enquadramento, roundInterpolado,
} from '../lib/timelineClipe2D.js'
import { umaPorRound, filtrarKills, killsDoJogador, chaveKill } from '../lib/selecaoKills.js'
import { escolherMimeType, extensaoDoMime } from '../lib/gravadorClipe2D.js'

const EU = { steamId: 'eu', nick: 'fih' }
const AMIGO = { steamId: 'amigo', nick: 'zé' }
const INIMIGO = { steamId: 'ini', nick: 'rival' }
const INIMIGO2 = { steamId: 'ini2', nick: 'rival2' }

function kill(extra) {
  return {
    round: 1, tick: 1000, killer: EU, victim: INIMIGO, assister: null, weapon: 'ak47',
    headshot: false, teamKill: false, wallbang: false, thrusmoke: false, attackerblind: false, noscope: false,
    ...extra,
  }
}

// Round de 100 frames a 8 Hz; kills do replay em frames 40 e 44.
function round(numero, killsReplay, total = 100) {
  return {
    round: numero,
    frames: Array.from({ length: total }, (_, t) => ({
      t,
      players: [
        { id: 'eu', x: 0.2 + t * 0.001, y: 0.5, yaw: 0, alive: true, side: 'T' },
        { id: 'ini', x: 0.4, y: 0.5, yaw: 0, alive: true, side: 'CT' },
        { id: 'ini2', x: 0.45, y: 0.55, yaw: 0, alive: true, side: 'CT' },
        { id: 'amigo', x: 0.25, y: 0.45, yaw: 0, alive: true, side: 'T' },
      ],
    })),
    kills: killsReplay,
  }
}

describe('frameDaKill', () => {
  it('casa a kill da API com a do replay pela vítima', () => {
    const rd = round(1, [{ t: 40, killer: 'eu', victim: 'ini' }, { t: 60, killer: 'eu', victim: 'amigo' }])
    expect(frameDaKill(kill({ victim: AMIGO, teamKill: true }), rd)).toBe(60)
  })
  it('kill sem killer (queda) também casa', () => {
    const rd = round(1, [{ t: 12, killer: null, victim: 'ini' }])
    expect(frameDaKill(kill({ killer: null }), rd)).toBe(12)
  })
  it('vítima ausente no replay → null', () => {
    expect(frameDaKill(kill(), round(1, []))).toBeNull()
  })
})

describe('montarTimeline', () => {
  const rounds = {
    1: round(1, [{ t: 40, killer: 'eu', victim: 'ini' }, { t: 44, killer: 'eu', victim: 'ini2' }]),
    3: round(3, [{ t: 10, killer: 'eu', victim: 'ini' }]),
  }

  it('kill única: título de 1 s + janela [−3 s, +2 s]', () => {
    const tl = montarTimeline([kill()], { tickRate: 8, rounds })
    expect(tl.itens.map((i) => i.tipo)).toEqual(['titulo', 'cena'])
    const cena = tl.itens[1]
    expect(cena.frameIni).toBe(40 - 24)
    expect(cena.frameFim).toBe(40 + 16)
    expect(cena.inicioMs).toBe(1000)
    expect(cena.duracaoMs).toBeCloseTo(((56 - 16 + 1) / 8) * 1000)
    expect(tl.duracaoMs).toBeCloseTo(1000 + cena.duracaoMs)
    expect(tl.totalKills).toBe(1)
  })

  it('ordena por round/tick, junta kills com janelas encostadas e corta na borda do round', () => {
    const tl = montarTimeline(
      [kill({ round: 3, tick: 50, victim: INIMIGO }), kill({ tick: 1300, victim: INIMIGO2 }), kill()],
      { tickRate: 8, rounds },
    )
    const cenas = tl.itens.filter((i) => i.tipo === 'cena')
    expect(cenas).toHaveLength(2)
    expect(cenas[0].round).toBe(1)
    expect(cenas[0].kills).toHaveLength(2)
    expect(cenas[0].frameFim).toBe(44 + 16)
    expect([cenas[0].primeiraKill, cenas[0].ultimaKill]).toEqual([1, 2])
    expect(cenas[1].round).toBe(3)
    expect(cenas[1].frameIni).toBe(0) // 10 − 24 < 0
    expect(cenas[1].primeiraKill).toBe(3)
  })

  it('kill de round sem replay ou ausente fica de fora com motivo', () => {
    const tl = montarTimeline([kill({ round: 9 }), kill({ round: 3, victim: AMIGO })], { tickRate: 8, rounds })
    expect(tl.itens).toHaveLength(0)
    expect(tl.ignoradas.map((i) => i.motivo)).toEqual(['kill não encontrada no Replay 2D', 'round sem Replay 2D'])
  })
})

describe('posicaoNaTimeline', () => {
  const rounds = { 1: round(1, [{ t: 40, killer: 'eu', victim: 'ini' }]) }
  const tl = montarTimeline([kill()], { tickRate: 8, rounds })

  it('começa no cartão de título', () => {
    const p = posicaoNaTimeline(tl, 500)
    expect(p.item.tipo).toBe('titulo')
    expect(p.fim).toBe(false)
  })
  it('na cena, o frame avança com o tempo (fracionário)', () => {
    const p = posicaoNaTimeline(tl, 1000 + 1500)
    expect(p.item.tipo).toBe('cena')
    expect(p.frame).toBeCloseTo(16 + 12)
  })
  it('depois do fim marca fim e progresso 1', () => {
    const p = posicaoNaTimeline(tl, tl.duracaoMs + 10)
    expect(p.fim).toBe(true)
    expect(p.progresso).toBe(1)
    expect(p.item.tipo).toBe('cena')
  })
})

describe('enquadramento e interpolação', () => {
  const rd = round(1, [{ t: 40, killer: 'eu', victim: 'ini' }])
  it('enquadra killer e vítima dentro do mapa', () => {
    const tl = montarTimeline([kill()], { tickRate: 8, rounds: { 1: rd } })
    const r = enquadramento(rd, tl.itens[1])
    expect(r.lado).toBeGreaterThanOrEqual(0.4)
    expect(r.x).toBeLessThanOrEqual(0.24)
    expect(r.x + r.lado).toBeGreaterThanOrEqual(0.4)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.y + r.lado).toBeLessThanOrEqual(1)
  })
  it('interpola posição entre dois frames', () => {
    const r = roundInterpolado(rd, 10.5)
    expect(r.frames[10].players[0].x).toBeCloseTo(0.2105)
    expect(rd.frames[10].players[0].x).toBeCloseTo(0.21) // original intacto
  })
})

describe('selecaoKills', () => {
  const lista = [
    kill({ tick: 100 }),
    kill({ tick: 200, victim: INIMIGO2, headshot: true }),
    kill({ round: 2, tick: 300, weapon: 'hegrenade', victim: AMIGO, teamKill: true }),
    kill({ round: 2, tick: 250, killer: INIMIGO, victim: EU }),
  ]
  it('killsDoJogador mantém só quem matou, em ordem', () => {
    expect(killsDoJogador(lista, 'eu').map((k) => k.tick)).toEqual([100, 200, 300])
  })
  it('1 por round escolhe a kill mais bonita de cada round', () => {
    expect(umaPorRound(killsDoJogador(lista, 'eu'))).toEqual([chaveKill(lista[1]), chaveKill(lista[2])])
  })
  it('filtro só TK/granada', () => {
    expect(filtrarKills(lista, { soTkGranada: true })).toEqual([lista[2]])
  })
})

describe('mime', () => {
  it('prefere mp4 quando suportado, senão webm', () => {
    expect(escolherMimeType({ isTypeSupported: (m) => m === 'video/mp4' })).toBe('video/mp4')
    expect(escolherMimeType({ isTypeSupported: (m) => m.startsWith('video/webm') })).toBe('video/webm;codecs=vp9')
    expect(escolherMimeType(undefined)).toBeNull()
    expect(extensaoDoMime('video/mp4;codecs=avc1')).toBe('mp4')
    expect(extensaoDoMime('video/webm')).toBe('webm')
  })
})
