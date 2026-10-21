import { describe, it, expect } from 'vitest'
import { inicioDoDiaSql, fimDoDiaSql, inicioDoDiaMs } from '../src/fuso.js'

describe('fuso dos filtros de período', () => {
  it('SQL corta o dia em Brasília', () => {
    expect(inicioDoDiaSql('$2')).toBe("($2::date::timestamp at time zone 'America/Sao_Paulo')")
    expect(fimDoDiaSql('$3')).toBe("(($3::date + 1)::timestamp at time zone 'America/Sao_Paulo')")
  })

  it('Partida das 22h30 de 20/10 em Brasília (01h30 UTC de 21/10) é do dia 20', () => {
    const partida = Date.parse('2026-10-21T01:30:00Z')
    expect(partida >= inicioDoDiaMs('2026-10-20')).toBe(true)
    expect(partida < inicioDoDiaMs('2026-10-21')).toBe(true)
  })
})
