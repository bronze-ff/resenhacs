// site/client/src/test/format.test.js
import { describe, it, expect } from 'vitest'
import { contadorRegressivo, dataHora, datetimeLocalBrasiliaParaIso, origemPartida, paraDatetimeLocalBrasilia } from '../lib/format.js'

describe('dataHora', () => {
  it('sempre renderiza no horario de Brasilia, independente do fuso do dispositivo', () => {
    // 03:01Z == 00:01 em America/Sao_Paulo (UTC-3, sem horario de verao desde 2019).
    // O grupo inteiro é brasileiro e as regras de competição falam em horário de
    // Brasília — a exibição não pode variar com o fuso do aparelho/viagem/VPN.
    expect(dataHora('2026-07-25T03:01:00Z')).toBe('25/07/2026 00:01')
    expect(dataHora('2026-08-01T02:59:00Z')).toBe('31/07/2026 23:59')
  })

  it('valores invalidos/vazios viram "data desconhecida"', () => {
    expect(dataHora(null)).toBe('data desconhecida')
    expect(dataHora('nada')).toBe('data desconhecida')
  })

  it('converte datetime-local como horário de Brasília, sem usar o fuso do navegador', () => {
    expect(datetimeLocalBrasiliaParaIso('2026-07-24T18:01')).toBe('2026-07-24T21:01:00.000Z')
    expect(datetimeLocalBrasiliaParaIso('2026-07-31T23:59')).toBe('2026-08-01T02:59:00.000Z')
    expect(paraDatetimeLocalBrasilia('2026-08-01T02:59:00.000Z')).toBe('2026-07-31T23:59')
  })

  it('formata o contador regressivo', () => {
    expect(contadorRegressivo('2026-07-25T00:00:01Z', new Date('2026-07-24T00:00:00Z').getTime())).toBe('1d 00:00:01')
  })
})

describe('origemPartida', () => {
  it('upload manual continua MANUAL', () => {
    expect(origemPartida('upload', true).label).toBe('Manual')
  })

  it('partida automática com demo parseada é AUTO', () => {
    expect(origemPartida('valve_mm', true).label).toBe('Auto')
  })

  it('partida sem demo (stats-only da API) é SEM DEMO', () => {
    expect(origemPartida('faceit', false).label).toBe('SEM DEMO')
  })
})
