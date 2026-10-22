import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { partidaVisivelExpr } from '../src/friendships.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const EU = '76561198000000001'
const AMIGO = '76561198000000002'
const OUTRO = '76561198000000003'
const ids = [EU, AMIGO, OUTRO, '76561198000000004', '76561198000000005', '76561198000000006']
const cookie = `resenha_token=${signToken({ steamId: EU }, config.jwtSecret)}`
const jogador = (id) => ({ steam_id64: id, nick: `J${id.at(-1)}`, avatar_url: `https://avatar/${id.at(-1)}` })

function preparar({ jogadores = [jogador(AMIGO), jogador(EU)], grupo = [], individual = [], duplas = [] } = {}) {
  const db = { query: vi.fn(async (sql) => {
    if (sql.includes('tokens_validos_apos')) return { rows: [] }
    if (sql.includes('from players p')) return { rows: jogadores }
    if (sql.includes('from (')) return { rows: grupo }
    if (sql.includes('join match_players mp2')) return { rows: duplas }
    return { rows: individual }
  }) }
  return { db, app: createApp({ config, db, r2Client: null }) }
}

describe('GET /api/pre-fila', () => {
  it('exige autenticação', async () => {
    const { app, db } = preparar()
    expect((await request(app).get('/api/pre-fila').query({ jogadores: AMIGO })).status).toBe(401)
    expect(db.query).not.toHaveBeenCalled()
  })

  it.each([
    undefined, '', ids.slice(1).join(','), `${AMIGO},${AMIGO}`, EU,
    '765', '7656119800000000a', `${AMIGO},`, `${AMIGO}, ${OUTRO}`, '12345678901234567\n',
    [AMIGO, OUTRO], { steamId: AMIGO }, "'; drop table players;--",
  ].map(value => [value]))('recusa quantidade/formato inválido: %j', async (jogadores) => {
    const { app, db } = preparar()
    const r = await request(app).get('/api/pre-fila').query(jogadores === undefined ? {} : { jogadores }).set('Cookie', cookie)
    expect(r.status).toBe(400)
    expect(r.body).toEqual({ erro: 'Escolha de 1 a 4 amigos.' })
    expect(db.query.mock.calls).toHaveLength(1)
  })

  it.each(['pending', 'rejected', 'inexistente'])('não enumera jogador não amigo: %s', async () => {
    const { app, db } = preparar({ jogadores: [jogador(EU)] })
    const r = await request(app).get('/api/pre-fila').query({ jogadores: AMIGO }).set('Cookie', cookie)
    expect(r.status).toBe(400)
    expect(r.body).toEqual({ erro: 'Só amigos entram na Pré-fila.' })
    expect(db.query.mock.calls).toHaveLength(2)
    const [sql, params] = db.query.mock.calls[1]
    expect(sql).toContain("f.status = 'accepted'")
    expect(sql).toContain('f.player_a = $2 and f.player_b = p.steam_id64')
    expect(sql).toContain('f.player_b = $2 and f.player_a = p.steam_id64')
    expect(params).toEqual([[EU, AMIGO], EU])
  })

  it('inclui o próprio Jogador e mantém a ordem escolhida, com a resposta I7', async () => {
    const { app, db } = preparar({ jogadores: [jogador(OUTRO), jogador(AMIGO), jogador(EU)],
      grupo: [{ map: 'de_nuke', partidas: 3, vitorias: 2, decididas: 3 }],
      individual: [{ map: 'de_nuke', partidas: 9, vitorias: 3, decididas: 9 }],
      duplas: [{ a: EU, b: AMIGO, partidas: 5, vitorias: 3, decididas: 4 }],
    })
    const r = await request(app).get('/api/pre-fila').query({ jogadores: `${AMIGO},${OUTRO}` }).set('Cookie', cookie)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({
      jogadores: [EU, AMIGO, OUTRO].map(id => ({ steamId: id, nick: `J${id.at(-1)}`, avatarUrl: `https://avatar/${id.at(-1)}` })),
      mapas: [{ map: 'de_nuke', partidas: 3, vitorias: 2, winrate: 66.7, fonte: 'grupo' }],
      melhorDupla: { a: EU, b: AMIGO, partidas: 5, vitorias: 3, winrate: 75 }, piorDupla: null,
    })
    const consultas = db.query.mock.calls.slice(2)
    expect(consultas).toHaveLength(3)
    for (const [sql, params] of consultas) {
      expect(params).toEqual([[EU, AMIGO, OUTRO], EU])
      expect(sql).toContain(partidaVisivelExpr('m', '$2'))
      expect(sql).toContain("m.status = 'parsed'")
      expect(sql).toContain('any($1::text[])')
      expect(sql).not.toContain('synergy_pairs')
    }
    for (const [sql, params] of db.query.mock.calls) {
      expect(sql).not.toContain(EU)
      expect(sql).not.toContain(AMIGO)
      expect(sql).not.toContain(OUTRO)
      expect(params).toBeDefined()
    }
    const grupoSql = consultas.find(([sql]) => sql.includes('from ('))[0]
    expect(grupoSql).toContain('mp.team')
    expect(grupoSql).toContain('count(distinct mp.steam_id64) = cardinality($1::text[])')
    const duplasSql = consultas.find(([sql]) => sql.includes('join match_players mp2'))[0]
    expect(duplasSql).toContain('mp2.team = mp1.team')
    expect(duplasSql).toContain('mp1.steam_id64 < mp2.steam_id64')
    expect(duplasSql).toContain('mp2.steam_id64 = any($1::text[])')
  })

  it('aceita quatro amigos sem amostra e preserva nick vazio/avatar nulo', async () => {
    const jogadores = ids.slice(0, 5).map(id => ({ ...jogador(id), nick: '', avatar_url: null }))
    const { app } = preparar({ jogadores })
    const r = await request(app).get('/api/pre-fila').query({ jogadores: ids.slice(1, 5).join(',') }).set('Cookie', cookie)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ jogadores: ids.slice(0, 5).map(steamId => ({ steamId, nick: '', avatarUrl: null })),
      mapas: [], melhorDupla: null, piorDupla: null })
  })

  it('Partidas parsed sem mapa não geram mapa, mas contam na dupla', async () => {
    // Agregados de três Partidas sem mapa: só a consulta de duplas as conserva.
    const { app, db } = preparar({ duplas: [{ a: EU, b: AMIGO, partidas: 3, vitorias: 2, decididas: 3 }] })
    const r = await request(app).get('/api/pre-fila').query({ jogadores: AMIGO }).set('Cookie', cookie)
    expect(r.status).toBe(200)
    expect(r.body.mapas).toEqual([])
    expect(r.body.melhorDupla).toEqual({ a: EU, b: AMIGO, partidas: 3, vitorias: 2, winrate: 66.7 })
    const agregados = db.query.mock.calls.slice(2)
    const mapas = agregados.filter(([sql]) => !sql.includes('join match_players mp2'))
    expect(mapas).toHaveLength(2)
    for (const [sql] of mapas) expect(sql).toContain('m.map is not null')
    const duplasSql = agregados.find(([sql]) => sql.includes('join match_players mp2'))[0]
    expect(duplasSql).not.toContain('m.map is not null')
  })

  it('falha da consulta segue o handler global com 500', async () => {
    const { app, db } = preparar()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('falha'))
    const r = await request(app).get('/api/pre-fila').query({ jogadores: AMIGO }).set('Cookie', cookie)
    expect(r.status).toBe(500)
    expect(r.body).toEqual({ erro: 'Erro interno' })
    log.mockRestore()
  })
})
