import { describe, it, expect } from 'vitest'
import {
  reducerQuadro, estadoInicial, deQuadro, paraApi, interpolarPassos, transladar, simplificarTraco, LIMITES,
} from '../lib/quadroEditor.js'

const aplicar = (s, ...acoes) => acoes.reduce(reducerQuadro, s)
const objetos = (s) => s.passos[s.passoAtivo].objetos

describe('reducerQuadro', () => {
  it('adiciona objeto no passo ativo, seleciona e marca sujo', () => {
    const s = aplicar(estadoInicial(), { tipo: 'adicionarObjeto', objeto: { tipo: 'ct', x: 0.2, y: 0.3 } })
    expect(objetos(s)).toHaveLength(1)
    expect(objetos(s)[0]).toMatchObject({ tipo: 'ct', x: 0.2, y: 0.3 })
    expect(s.selecionado).toBe(objetos(s)[0].id)
    expect(s.sujo).toBe(true)
  })

  it('limita coordenadas ao radar e ignora tipo desconhecido', () => {
    let s = aplicar(estadoInicial(), { tipo: 'adicionarObjeto', objeto: { tipo: 't', x: 1.5, y: -2 } })
    expect(objetos(s)[0]).toMatchObject({ x: 1, y: 0 })
    s = aplicar(s, { tipo: 'adicionarObjeto', objeto: { tipo: 'bomba', x: 0.1, y: 0.1 } })
    expect(objetos(s)).toHaveLength(1)
  })

  it('respeita o teto de objetos por passo', () => {
    let s = estadoInicial()
    for (let i = 0; i < LIMITES.objetosPorPasso + 5; i++) {
      s = reducerQuadro(s, { tipo: 'adicionarObjeto', objeto: { tipo: 'ct', x: 0.5, y: 0.5 } })
    }
    expect(objetos(s)).toHaveLength(LIMITES.objetosPorPasso)
  })

  it('move objeto e o arraste inteiro vira um único undo', () => {
    let s = aplicar(estadoInicial(), { tipo: 'adicionarObjeto', objeto: { tipo: 'ct', x: 0.2, y: 0.2 } })
    const id = objetos(s)[0].id
    s = aplicar(
      s,
      { tipo: 'iniciarArraste', id },
      { tipo: 'moverObjeto', id, x: 0.3, y: 0.3 },
      { tipo: 'moverObjeto', id, x: 0.4, y: 0.5 },
    )
    expect(objetos(s)[0]).toMatchObject({ x: 0.4, y: 0.5 })
    s = reducerQuadro(s, { tipo: 'desfazer' })
    expect(objetos(s)[0]).toMatchObject({ x: 0.2, y: 0.2 })
  })

  it('apaga objeto e desfaz', () => {
    let s = aplicar(estadoInicial(), { tipo: 'adicionarObjeto', objeto: { tipo: 'smoke', x: 0.5, y: 0.5 } })
    const id = objetos(s)[0].id
    s = reducerQuadro(s, { tipo: 'apagarObjeto', id })
    expect(objetos(s)).toHaveLength(0)
    expect(s.selecionado).toBeNull()
    s = reducerQuadro(s, { tipo: 'desfazer' })
    expect(objetos(s)).toHaveLength(1)
  })

  it('desfazer sem histórico não muda nada', () => {
    const s = estadoInicial()
    expect(reducerQuadro(s, { tipo: 'desfazer' })).toBe(s)
  })

  it('histórico tem teto', () => {
    let s = estadoInicial()
    for (let i = 0; i < LIMITES.historico + 10; i++) {
      s = reducerQuadro(s, { tipo: 'adicionarObjeto', objeto: { tipo: 'ct', x: 0.5, y: 0.5 } })
    }
    expect(s.historico).toHaveLength(LIMITES.historico)
  })

  it('novo passo copia os objetos do ativo com os mesmos ids e vira o ativo', () => {
    let s = aplicar(estadoInicial(), { tipo: 'adicionarObjeto', objeto: { tipo: 't', x: 0.1, y: 0.1 } })
    const id = objetos(s)[0].id
    s = reducerQuadro(s, { tipo: 'adicionarPasso' })
    expect(s.passos).toHaveLength(2)
    expect(s.passoAtivo).toBe(1)
    expect(objetos(s)[0].id).toBe(id)
    // mexer no passo 2 não altera o passo 1
    s = reducerQuadro(s, { tipo: 'moverObjeto', id, x: 0.9, y: 0.9, registrar: true })
    expect(s.passos[0].objetos[0]).toMatchObject({ x: 0.1, y: 0.1 })
    expect(s.passos[1].objetos[0]).toMatchObject({ x: 0.9, y: 0.9 })
  })

  it('renomeia, remove passo (nunca o último) e desfaz', () => {
    let s = aplicar(estadoInicial(), { tipo: 'adicionarPasso' }, { tipo: 'renomearPasso', indice: 1, nome: 'Execução' })
    expect(s.passos[1].nome).toBe('Execução')
    s = reducerQuadro(s, { tipo: 'removerPasso', indice: 1 })
    expect(s.passos).toHaveLength(1)
    expect(s.passoAtivo).toBe(0)
    expect(reducerQuadro(s, { tipo: 'removerPasso', indice: 0 })).toBe(s)
    s = reducerQuadro(s, { tipo: 'desfazer' })
    expect(s.passos).toHaveLength(2)
    expect(s.passos[1].nome).toBe('Execução')
  })

  it('respeita o teto de passos', () => {
    let s = estadoInicial()
    for (let i = 0; i < LIMITES.passos + 3; i++) s = reducerQuadro(s, { tipo: 'adicionarPasso' })
    expect(s.passos).toHaveLength(LIMITES.passos)
  })

  it('selecionarPasso troca o ativo sem histórico', () => {
    let s = aplicar(estadoInicial(), { tipo: 'adicionarPasso' })
    const h = s.historico.length
    s = reducerQuadro(s, { tipo: 'selecionarPasso', indice: 0 })
    expect(s.passoAtivo).toBe(0)
    expect(s.historico).toHaveLength(h)
  })

  it('salvo guarda o id e limpa o sujo', () => {
    const s = aplicar(estadoInicial(), { tipo: 'meta', campos: { nome: 'X' } }, { tipo: 'salvo', id: 'abc' })
    expect(s.meta).toMatchObject({ id: 'abc', nome: 'X', meu: true })
    expect(s.sujo).toBe(false)
  })
})

describe('transladar', () => {
  it('desloca seta e traço inteiros sem sair do radar', () => {
    const seta = transladar({ tipo: 'seta', x: 0.1, y: 0.1, x2: 0.5, y2: 0.5 }, 0.8, 0.2)
    expect(seta.x2).toBeCloseTo(1)
    expect(seta.x).toBeCloseTo(0.6)
    expect(seta.y).toBeCloseTo(0.2)
    const traco = transladar({ tipo: 'traco', x: 0.2, y: 0.2, pontos: [[0.2, 0.2], [0.3, 0.4]] }, 0.25, 0.1)
    expect(traco.pontos[1][0]).toBeCloseTo(0.35)
    expect(traco.pontos[1][1]).toBeCloseTo(0.3)
  })
})

describe('simplificarTraco', () => {
  it('reduz a no máximo N pontos mantendo as pontas', () => {
    const pontos = Array.from({ length: 500 }, (_, i) => [i / 500, 0])
    const r = simplificarTraco(pontos, 100)
    expect(r).toHaveLength(100)
    expect(r[0]).toEqual(pontos[0])
    expect(r[99]).toEqual(pontos[499])
  })
})

describe('interpolarPassos', () => {
  it('desliza objetos com o mesmo id e faz fade dos que entram/saem', () => {
    const de = { objetos: [{ id: 'a', tipo: 'ct', x: 0, y: 0 }, { id: 'sai', tipo: 'smoke', x: 0.5, y: 0.5 }] }
    const para = { objetos: [{ id: 'a', tipo: 'ct', x: 1, y: 0.5 }, { id: 'entra', tipo: 'flash', x: 0.2, y: 0.2 }] }
    const r = interpolarPassos(de, para, 0.5)
    expect(r.find((o) => o.id === 'a')).toMatchObject({ x: 0.5, y: 0.25, opacidade: 1 })
    expect(r.find((o) => o.id === 'sai').opacidade).toBe(0.5)
    expect(r.find((o) => o.id === 'entra').opacidade).toBe(0.5)
  })
})

describe('deQuadro / paraApi', () => {
  it('ida e volta preserva o conteúdo e os ids', () => {
    const q = {
      id: 'q1', nome: 'Exec', map: 'de_nuke', lado: 'CT', descricao: 'd', publicoNoGrupo: false, meu: true,
      passos: [{ nome: 'Setup', objetos: [{ id: 'x1', tipo: 'ct', x: 0.1, y: 0.2 }, { tipo: 'he', x: 0.3, y: 0.3 }] }],
    }
    const s = deQuadro(q)
    expect(s.meta).toMatchObject({ id: 'q1', map: 'de_nuke', lado: 'CT', publicoNoGrupo: false })
    expect(s.passos[0].objetos[1].id).toBeTruthy()
    const corpo = paraApi(s)
    expect(corpo).toMatchObject({ nome: 'Exec', map: 'de_nuke', lado: 'CT', publicoNoGrupo: false })
    expect(corpo.passos[0].objetos[0]).toEqual({ id: 'x1', tipo: 'ct', x: 0.1, y: 0.2 })
  })

  it('lado vazio vai como null', () => {
    expect(paraApi(estadoInicial()).lado).toBeNull()
  })
})
