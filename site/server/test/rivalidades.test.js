import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { calcularRivalidades } from '../src/rivalidades.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const VIEWER = '76561198000000009'
const cookie = `resenha_token=${signToken({ steamId: VIEWER, isSuperAdmin: false }, config.jwtSecret)}`

function appWith(handlers) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      for (const [needle, rows] of handlers) {
        if (sql.includes(needle)) return Promise.resolve({ rows })
      }
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db }), db }
}

const linha = (steam, nick, extra) => ({ steam_id64: steam, nick, avatar_url: null, matei: 0, morri: 0, contra: 0, juntos: 0, juntos_vitorias: 0, ...extra })

describe('calcularRivalidades', () => {
  it('acha freguês (proporção), carrasco (mais mortes), melhor e pior dupla', () => {
    const r = calcularRivalidades([
      linha('a', 'toguro', { matei: 3, morri: 9, contra: 4, juntos: 5, juntos_vitorias: 1 }),
      linha('b', 'zezinho', { matei: 8, morri: 2, contra: 3, juntos: 4, juntos_vitorias: 3 }),
      linha('c', 'paçoca', { matei: 10, morri: 6, contra: 5 }),
      // amostra pequena (2 duelos): não pode virar freguês com 100%
      linha('d', 'miojo', { matei: 2, morri: 0, contra: 1, juntos: 2, juntos_vitorias: 2 }),
    ])
    expect(r.fregues).toMatchObject({ steamId: 'b', dominio: 80 })
    expect(r.carrasco).toMatchObject({ steamId: 'a', morri: 9 })
    expect(r.melhorDupla).toMatchObject({ steamId: 'b', winrateJuntos: 75 })
    expect(r.piorDupla).toMatchObject({ steamId: 'a', winrateJuntos: 20 })
    // d tem só 2 Partidas juntos (mín. 3): fora das duplas.
    expect(r.duplas.map((d) => d.steamId)).toEqual(['b', 'a'])
    // Duelos ordenados por volume de kills trocadas.
    expect(r.duelos[0].steamId).toBe('c')
  })

  it('uma dupla só não vira pé-frio; sem duelos tudo null', () => {
    const r = calcularRivalidades([linha('a', 'x', { juntos: 3, juntos_vitorias: 2 })])
    expect(r.melhorDupla).toMatchObject({ steamId: 'a' })
    expect(r.piorDupla).toBeNull()
    expect(r.fregues).toBeNull()
    expect(r.carrasco).toBeNull()
    expect(r.duelos).toEqual([])
  })
})

describe('GET /api/rivalidades/:steamId', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/rivalidades/765')).status).toBe(401)
  })

  it('steamId inválido: 400', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/rivalidades/abc').set('Cookie', cookie)).status).toBe(400)
  })

  it('fora da rede do viewer: 404 sem consultar duelos', async () => {
    const { app, db } = appWith([['as tem', [{ tem: false }]]])
    const res = await request(app).get('/api/rivalidades/765').set('Cookie', cookie)
    expect(res.status).toBe(404)
    expect(db.query.mock.calls.some(([s]) => s.includes('kill_positions'))).toBe(false)
  })

  it('consulta parametrizada, sem team kill e escopada por amizade', async () => {
    const { app, db } = appWith([
      ['as tem', [{ tem: true }]],
      ['kill_positions', [linha('a', 'toguro', { matei: 1, morri: 7, contra: 3 })]],
    ])
    const res = await request(app).get('/api/rivalidades/765').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.carrasco).toMatchObject({ steamId: 'a', nick: 'toguro', morri: 7 })
    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes('kill_positions'))
    expect(params).toEqual(['765', VIEWER])
    expect(sql).toContain('coalesce(kp.is_team_kill, false) = false')
    expect(sql).toContain('from friendships f')
    expect(sql).not.toContain('765')
  })
})
