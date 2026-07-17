import { describe, it, expect } from 'vitest'
import { partidaVisivelExpr, partidaVisivelWhere, partidaVisivelPredicado, partidaPublicaExpr } from '../src/matchVisibility.js'

describe('partidaVisivelExpr', () => {
  it('monta a regra: pertence ao grupo OU tem membro do grupo na partida', () => {
    const sql = partidaVisivelExpr('m', '$1')
    // Regra: group_id do próprio grupo cobre uploads/legado; o exists cobre cross-grupo.
    expect(sql).toContain('m.group_id = $1')
    expect(sql).toContain('exists (')
    expect(sql).toContain('group_members gmv')
    expect(sql).toContain('match_players mv')
    expect(sql).toContain('gmv.group_id = $1')
    expect(sql).toContain('mv.match_id = m.id')
  })

  it('respeita o alias passado (ex.: mh na subquery de aces)', () => {
    const sql = partidaVisivelExpr('mh', '$3')
    expect(sql).toContain('mh.group_id = $3')
    expect(sql).toContain('mv.match_id = mh.id')
    expect(sql).not.toContain('m.group_id')
  })

  it('o fragmento sobrevive ao .replaceAll("m.", "mh.") usado nos call sites de aces', () => {
    // profile.js/ranking.js geram com alias "m" e trocam pra "mh" no subquery de aces.
    const trocado = partidaVisivelExpr('m', '$1').replaceAll('m.', 'mh.')
    expect(trocado).toContain('mh.group_id = $1')
    expect(trocado).toContain('mv.match_id = mh.id')
    // A troca não pode corromper os aliases internos do exists (gmv./mv. não contêm "m.").
    expect(trocado).toContain('group_members gmv')
    expect(trocado).toContain('mv.steam_id64 = gmv.steam_id64')
  })
})

describe('partidaPublicaExpr', () => {
  it('exige um jogador com ranking_publico na partida (pra abrir detalhe via perfil público)', () => {
    const sql = partidaPublicaExpr('matches')
    expect(sql).toContain('exists (')
    expect(sql).toContain('players pvp')
    expect(sql).toContain('pvp.ranking_publico = true')
    expect(sql).toContain('mvp.match_id = matches.id')
    // Não consome param (não depende de grupo).
    expect(sql).not.toContain('$')
  })
})

describe('partidaVisivelWhere', () => {
  it('null (modo público) devolve string vazia e não mexe nos params', () => {
    const params = ['x']
    expect(partidaVisivelWhere('m', null, params)).toBe('')
    expect(params).toEqual(['x'])
  })

  it('dá push no groupId e devolve " and (...)" apontando pro param novo', () => {
    const params = ['765']
    const sql = partidaVisivelWhere('m', 'g1', params)
    expect(params).toEqual(['765', 'g1'])
    expect(sql.startsWith(' and (')).toBe(true)
    expect(sql).toContain('m.group_id = $2')
  })
})

describe('partidaVisivelPredicado', () => {
  it('devolve o predicado sem " and " e dá push no groupId', () => {
    const params = ['id1']
    const sql = partidaVisivelPredicado('matches', 'g1', params)
    expect(params).toEqual(['id1', 'g1'])
    expect(sql.startsWith('(')).toBe(true)
    expect(sql).not.toMatch(/^\s*and /)
    expect(sql).toContain('matches.group_id = $2')
    expect(sql).toContain('mv.match_id = matches.id')
  })
})
