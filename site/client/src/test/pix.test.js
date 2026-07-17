import { describe, it, expect } from 'vitest'
import { montarPayloadPix } from '../lib/pix.js'

describe('montarPayloadPix', () => {
  it('monta o payload BR Code/EMV com GUI maiúsculo, nome/cidade truncados e CRC16 correto', () => {
    const payload = montarPayloadPix({
      chave: '98dea706-4b3d-4ae4-b96d-e96a6669bb8a',
      nome: 'Filippe Faria',
      cidade: 'Aparecida de Goiania',
    })
    expect(payload).toBe(
      '00020101021126580014BR.GOV.BCB.PIX013698dea706-4b3d-4ae4-b96d-e96a6669bb8a' +
      '5204000053039865802BR5913FILIPPE FARIA6015APARECIDA DE GO62070503***63047D11',
    )
  })

  it('trunca nome em 25 caracteres e converte pra maiúsculas', () => {
    const payload = montarPayloadPix({
      chave: 'x',
      nome: 'um nome de recebedor bem grande que passa de vinte e cinco',
      cidade: 'Sao Paulo',
    })
    // campo 59 = "59" + tamanho (2 digitos) + valor; tamanho tem que ser exatamente 25
    const idx = payload.indexOf('59')
    const tamanho = payload.slice(idx + 2, idx + 4)
    const valor = payload.slice(idx + 4, idx + 4 + 25)
    expect(tamanho).toBe('25')
    expect(valor).toBe('UM NOME DE RECEBEDOR BEM ')
    expect(valor.length).toBe(25)
  })

  it('trunca cidade em 15 caracteres e converte pra maiúsculas', () => {
    const payload = montarPayloadPix({
      chave: 'x',
      nome: 'Nome',
      cidade: 'Uma Cidade Com Nome Bem Grande',
    })
    const idx = payload.indexOf('60')
    const tamanho = payload.slice(idx + 2, idx + 4)
    const valor = payload.slice(idx + 4, idx + 4 + 15)
    expect(tamanho).toBe('15')
    expect(valor).toBe('UMA CIDADE COM ')
    expect(valor.length).toBe(15)
  })
})
