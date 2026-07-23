import { describe, it, expect } from 'vitest'
import { filtrarJanela, classificarRegiao, detectar, montarTatica } from '../lib/deteccaoTaticas.js'

const CALLOUTS_INFERNO = [
  { nome: 'A', x: 0.8145, y: 0.6629, nivel: 'noob' },
  { nome: 'B', x: 0.5329, y: 0.162, nivel: 'noob' },
  { nome: 'Mid', x: 0.5551, y: 0.6393, nivel: 'noob' },
  { nome: 'Banana', x: 0.4574, y: 0.4588, nivel: 'noob' },
]

const CALLOUTS_SEM_MID = [
  { nome: 'A', x: 0.8145, y: 0.6629, nivel: 'noob' },
  { nome: 'B', x: 0.5329, y: 0.162, nivel: 'noob' },
]

function granada(over = {}) {
  return {
    tipo: 'smoke', tick: 1000, throwerSteamId: '1', throwerNick: 'p1',
    arremessoX: 0.5, arremessoY: 0.5, alvoX: 0.53, alvoY: 0.16,
    ...over,
  }
}

describe('filtrarJanela', () => {
  it('mantém granadas dentro de 1920 ticks da primeira (ordenada)', () => {
    const round = { granadas: [granada({ tick: 3000 }), granada({ tick: 1000 }), granada({ tick: 2900 })] }
    const resultado = filtrarJanela(round)
    expect(resultado.map((g) => g.tick)).toEqual([1000, 2900])
  })

  it('descarta granadas fora da janela mesmo se vierem antes na lista', () => {
    const round = { granadas: [granada({ tick: 1000 }), granada({ tick: 3500 })] }
    expect(filtrarJanela(round).map((g) => g.tick)).toEqual([1000])
  })

  it('round sem granadas devolve lista vazia', () => {
    expect(filtrarJanela({ granadas: [] })).toEqual([])
    expect(filtrarJanela({})).toEqual([])
  })
})

describe('classificarRegiao', () => {
  it('acha a região mais próxima do centróide', () => {
    expect(classificarRegiao(CALLOUTS_INFERNO, 0.8, 0.66)).toBe('A')
    expect(classificarRegiao(CALLOUTS_INFERNO, 0.53, 0.16)).toBe('B')
    expect(classificarRegiao(CALLOUTS_INFERNO, 0.55, 0.64)).toBe('MID')
  })

  it('sem Mid: classifica entre A e B (Mid é opcional)', () => {
    expect(classificarRegiao(CALLOUTS_SEM_MID, 0.8, 0.66)).toBe('A')
    expect(classificarRegiao(CALLOUTS_SEM_MID, 0.53, 0.16)).toBe('B')
  })

  it('null sem A', () => {
    const semA = CALLOUTS_INFERNO.filter((c) => c.nome !== 'A')
    expect(classificarRegiao(semA, 0.8, 0.66)).toBeNull()
  })

  it('null sem B', () => {
    const semB = CALLOUTS_INFERNO.filter((c) => c.nome !== 'B')
    expect(classificarRegiao(semB, 0.53, 0.16)).toBeNull()
  })

  it('null sem callouts', () => {
    expect(classificarRegiao([], 0.5, 0.5)).toBeNull()
    expect(classificarRegiao(null, 0.5, 0.5)).toBeNull()
  })
})

describe('detectar', () => {
  it('ignora rounds com menos de 3 granadas na janela', () => {
    const rounds = [{
      matchId: 1, roundNumber: 1, lado: 'T', origem: 'pro', teamAName: 'A', teamBName: 'B',
      granadas: [granada({ tick: 100 }), granada({ tick: 200 })],
    }]
    expect(detectar(rounds, CALLOUTS_INFERNO)).toEqual([])
  })

  it('agrupa rounds com mesma assinatura (lado|regiao|tipos) e centróide próximo', () => {
    const rodadaB = (matchId, roundNumber) => ({
      matchId, roundNumber, lado: 'T', origem: 'pro', teamAName: 'Vitality', teamBName: 'Falcons',
      granadas: [
        granada({ tick: 100, tipo: 'smoke', alvoX: 0.53, alvoY: 0.16, throwerSteamId: '1' }),
        granada({ tick: 150, tipo: 'smoke', alvoX: 0.53, alvoY: 0.16, throwerSteamId: '2' }),
        granada({ tick: 200, tipo: 'flash', alvoX: 0.53, alvoY: 0.17, throwerSteamId: '1' }),
      ],
    })
    const rounds = [rodadaB(1, 1), rodadaB(1, 5), rodadaB(2, 3)]
    const candidatos = detectar(rounds, CALLOUTS_INFERNO)
    expect(candidatos).toHaveLength(1)
    expect(candidatos[0]).toMatchObject({ lado: 'T', regiao: 'B', tipos: ['flash', 'smoke'] })
    expect(candidatos[0].rounds).toHaveLength(3)
    expect(candidatos[0].times).toEqual(['Vitality', 'Falcons'])
    // "mais recente" = maior matchId, depois maior roundNumber -> (2, 3)
    expect(candidatos[0].granadasRepresentativas).toHaveLength(3)
  })

  it('não agrupa candidatos com assinaturas diferentes (regiões diferentes)', () => {
    const base = (matchId, regiaoAlvo) => ({
      matchId, roundNumber: 1, lado: 'T', origem: 'pro', teamAName: 'A', teamBName: 'B',
      granadas: [
        granada({ tick: 100, tipo: 'smoke', alvoX: regiaoAlvo.x, alvoY: regiaoAlvo.y }),
        granada({ tick: 150, tipo: 'smoke', alvoX: regiaoAlvo.x, alvoY: regiaoAlvo.y }),
        granada({ tick: 200, tipo: 'flash', alvoX: regiaoAlvo.x, alvoY: regiaoAlvo.y }),
      ],
    })
    const rounds = [base(1, { x: 0.53, y: 0.16 }), base(2, { x: 0.81, y: 0.66 })]
    const candidatos = detectar(rounds, CALLOUTS_INFERNO)
    expect(candidatos).toHaveLength(2)
  })

  it('ordena candidatos por nº de rounds desc', () => {
    const rodada = (matchId, roundNumber, alvo) => ({
      matchId, roundNumber, lado: 'T', origem: 'pro', teamAName: 'A', teamBName: 'B',
      granadas: [
        granada({ tick: 100, tipo: 'smoke', alvoX: alvo.x, alvoY: alvo.y }),
        granada({ tick: 150, tipo: 'smoke', alvoX: alvo.x, alvoY: alvo.y }),
        granada({ tick: 200, tipo: 'flash', alvoX: alvo.x, alvoY: alvo.y }),
      ],
    })
    const alvoB = { x: 0.53, y: 0.16 }
    const alvoA = { x: 0.81, y: 0.66 }
    const rounds = [
      rodada(1, 1, alvoB), rodada(2, 1, alvoB), rodada(3, 1, alvoB), // B: 3 rounds
      rodada(4, 1, alvoA), rodada(5, 1, alvoA), // A: 2 rounds
    ]
    const candidatos = detectar(rounds, CALLOUTS_INFERNO)
    expect(candidatos.map((c) => c.regiao)).toEqual(['B', 'A'])
  })
})

describe('montarTatica', () => {
  it('monta título, tipo execute (T) e papéis agrupados por thrower', () => {
    const candidato = {
      lado: 'T', regiao: 'B', tipos: ['flash', 'smoke'],
      granadasRepresentativas: [
        granada({ tick: 100, tipo: 'smoke', alvoX: 0.53, alvoY: 0.16, throwerSteamId: '1' }),
        granada({ tick: 150, tipo: 'smoke', alvoX: 0.53, alvoY: 0.16, throwerSteamId: '2' }),
        granada({ tick: 200, tipo: 'flash', alvoX: 0.53, alvoY: 0.17, throwerSteamId: '1' }),
      ],
      times: ['Vitality', 'Falcons'],
    }
    const tatica = montarTatica(candidato, CALLOUTS_INFERNO)
    expect(tatica.tipo).toBe('execute')
    expect(tatica.local).toBe('B')
    expect(tatica.lado).toBe('T')
    expect(tatica.titulo).toMatch(/^Execute B \(/)
    expect(tatica.papeis).toHaveLength(2) // 2 throwers distintos
    expect(tatica.papeis[0].granadas).toHaveLength(2) // thrower 1 tem 2 granadas
    expect(tatica.papeis[1].granadas).toHaveLength(1)
  })

  it('tipo setup quando lado é CT', () => {
    const candidato = {
      lado: 'CT', regiao: 'A', tipos: ['smoke'],
      granadasRepresentativas: [granada({ tipo: 'smoke' })],
      times: [],
    }
    expect(montarTatica(candidato, CALLOUTS_INFERNO).tipo).toBe('setup')
  })

  it('null sem região', () => {
    expect(montarTatica({ regiao: null }, CALLOUTS_INFERNO)).toBeNull()
  })
})
