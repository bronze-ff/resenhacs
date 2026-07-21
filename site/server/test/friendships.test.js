import { describe, it, expect } from 'vitest'
import { parCanonico, partidaVisivelExpr, partidaVisivelWhere, partidaVisivelPredicado } from '../src/friendships.js'

describe('parCanonico', () => {
  it('ordena por string, menor primeiro', () => {
    expect(parCanonico('222', '111')).toEqual(['111', '222'])
    expect(parCanonico('111', '222')).toEqual(['111', '222'])
  })
  it('é idempotente qualquer que seja a ordem de entrada', () => {
    expect(parCanonico('b', 'a')).toEqual(parCanonico('a', 'b'))
  })
})

describe('partidaVisivelExpr', () => {
  it('monta: eu joguei OU amigo accepted meu jogou', () => {
    const sql = partidaVisivelExpr('m', '$1')
    expect(sql).toContain('mv.steam_id64 = $1')                 // eu joguei
    expect(sql).toContain('from friendships f')                 // via amizade
    expect(sql).toContain("f.status = 'accepted'")
    expect(sql).toContain('mv.match_id = m.id')
    expect(sql).not.toContain('group')                          // grupo não existe mais
    expect(sql).not.toContain('ranking_publico')
  })
  it('sobrevive ao .replaceAll("m.", "mh.") dos subqueries de aces', () => {
    const trocado = partidaVisivelExpr('m', '$1').replaceAll('m.', 'mh.')
    expect(trocado).toContain('mv.match_id = mh.id')
    expect(trocado).toContain('from friendships f')             // 'f.'/'mv.' intactos
    expect(trocado).not.toContain('mh.match_id = ')             // mv não vira mh
  })
})

describe('partidaVisivelWhere', () => {
  it('null devolve string vazia e não mexe nos params', () => {
    const params = ['x']
    expect(partidaVisivelWhere('m', null, params)).toBe('')
    expect(params).toEqual(['x'])
  })
  it('dá push no viewer e aponta pro param novo', () => {
    const params = ['765']
    const sql = partidaVisivelWhere('m', '999', params)
    expect(params).toEqual(['765', '999'])
    expect(sql.startsWith(' and (')).toBe(true)
    expect(sql).toContain('mv.steam_id64 = $2')
  })
})

describe('partidaVisivelPredicado', () => {
  it('devolve o predicado sem " and " e dá push no viewer', () => {
    const params = ['id1']
    const sql = partidaVisivelPredicado('matches', '999', params)
    expect(params).toEqual(['id1', '999'])
    expect(sql.startsWith('(')).toBe(true)
    expect(sql).not.toMatch(/^\s*and /)
    expect(sql).toContain('mv.match_id = matches.id')
  })
})
