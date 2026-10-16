import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { calcularStatsPorLado } from '../src/statsLado.js'
import { backfillPontuacao } from '../src/backfillPontuacao.js'

const config = {
  jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos',
  allstarApiKey: null, allstarSteamIds: new Set(),
}
const VIEWER = '76561198000000009'
const cookie = `resenha_token=${signToken({ steamId: VIEWER, isSuperAdmin: false }, config.jwtSecret)}`
const MATCH = '00000000-0000-0000-0000-0000000000aa'

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

const LINHA_KILL = {
  round_number: 1, tick: 100, killer: '76561198000000001', victim: '76561198000000002',
  assister: '76561198000000003', weapon: 'ak47', headshot: true,
  is_team_kill: false, wallbang: true, thrusmoke: false, attackerblind: false, noscope: false,
  killer_x: 10.5, killer_y: -20, victim_x: 30, victim_y: 40.25,
  killer_nick: 'fih', victim_nick: 'zé', assister_nick: 'bob',
}
const LINHA_TK = {
  round_number: 2, tick: 50, killer: '76561198000000001', victim: '76561198000000004',
  assister: null, weapon: 'hegrenade', headshot: false,
  is_team_kill: true, wallbang: false, thrusmoke: false, attackerblind: true, noscope: false,
  killer_x: null, killer_y: null, victim_x: 1, victim_y: 2,
  killer_nick: 'fih', victim_nick: 'amigo', assister_nick: null,
}
const LINHA_MUNDO = {
  round_number: 3, tick: 10, killer: null, victim: '76561198000000002', assister: null,
  weapon: 'world', headshot: false, is_team_kill: false, wallbang: false, thrusmoke: false,
  attackerblind: false, noscope: false, killer_x: null, killer_y: null, victim_x: 5, victim_y: 6,
  killer_nick: null, victim_nick: 'zé', assister_nick: null,
}

describe('GET /api/matches/:id/kills', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get(`/api/matches/${MATCH}/kills`)).status).toBe(401)
  })

  it('partida não visível: 404', async () => {
    const { app, db } = appWith([])
    const res = await request(app).get(`/api/matches/${MATCH}/kills`).set('Cookie', cookie)
    expect(res.status).toBe(404)
    const sql = db.query.mock.calls.map(([q]) => q).find((q) => q.includes('from matches where id'))
    expect(sql).toContain('from friendships f')
    expect(db.query.mock.calls.some(([s]) => s.includes('from kill_positions'))).toBe(false)
  })

  it('devolve o contrato com TK e flags, sem filtrar team kill', async () => {
    const { app, db } = appWith([
      ['from matches where id', [{ id: MATCH }]],
      ['from kill_positions kp', [LINHA_KILL, LINHA_TK, LINHA_MUNDO]],
    ])
    const res = await request(app).get(`/api/matches/${MATCH}/kills`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      {
        round: 1, tick: 100,
        killer: { steamId: '76561198000000001', nick: 'fih' },
        victim: { steamId: '76561198000000002', nick: 'zé' },
        assister: { steamId: '76561198000000003', nick: 'bob' },
        weapon: 'ak47', headshot: true, teamKill: false,
        wallbang: true, thrusmoke: false, attackerblind: false, noscope: false,
        killerX: 10.5, killerY: -20, victimX: 30, victimY: 40.25,
      },
      {
        round: 2, tick: 50,
        killer: { steamId: '76561198000000001', nick: 'fih' },
        victim: { steamId: '76561198000000004', nick: 'amigo' },
        assister: null,
        weapon: 'hegrenade', headshot: false, teamKill: true,
        wallbang: false, thrusmoke: false, attackerblind: true, noscope: false,
        killerX: null, killerY: null, victimX: 1, victimY: 2,
      },
      {
        round: 3, tick: 10, killer: null,
        victim: { steamId: '76561198000000002', nick: 'zé' },
        assister: null,
        weapon: 'world', headshot: false, teamKill: false,
        wallbang: false, thrusmoke: false, attackerblind: false, noscope: false,
        killerX: null, killerY: null, victimX: 5, victimY: 6,
      },
    ])
    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes('from kill_positions kp'))
    expect(sql).toContain('order by kp.round_number, kp.tick')
    expect(sql).not.toContain('is_team_kill = false')
    expect(params).toEqual([MATCH, null])
  })

  it('?jogador filtra killer parametrizado', async () => {
    const { app, db } = appWith([
      ['from matches where id', [{ id: MATCH }]],
      ['from kill_positions kp', [LINHA_KILL]],
    ])
    const res = await request(app)
      .get(`/api/matches/${MATCH}/kills?jogador=76561198000000001`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes('from kill_positions kp'))
    expect(sql).toContain('kp.killer = $2')
    expect(params).toEqual([MATCH, '76561198000000001'])
  })

  it('?jogador inválido: 400', async () => {
    const { app } = appWith([['from matches where id', [{ id: MATCH }]]])
    const res = await request(app).get(`/api/matches/${MATCH}/kills?jogador=abc' or 1=1`).set('Cookie', cookie)
    expect(res.status).toBe(400)
  })
})

describe('team kill não conta como kill', () => {
  it('statsLado ignora kill marcada como teamKill', () => {
    const players = [{ steamId: 'A1', team: 'A' }, { steamId: 'A2', team: 'A' }, { steamId: 'B1', team: 'B' }]
    const rounds = [{ roundNumber: 1, sideA: 'CT' }]
    const base = [{ roundNumber: 1, tick: 100, killer: 'A1', victim: 'B1', assister: null, headshot: true }]
    const comTk = [...base, { roundNumber: 1, tick: 200, killer: 'A1', victim: 'A2', assister: null, headshot: true, teamKill: true }]
    const a = calcularStatsPorLado({ players, rounds, kills: base, roundDamage: [], filtro: 'all' })
    const b = calcularStatsPorLado({ players, rounds, kills: comTk, roundDamage: [], filtro: 'all' })
    expect(b.A1.kills).toBe(1)
    expect(b).toEqual(a)
  })

  it('consultas de kill "de verdade" filtram is_team_kill = false', async () => {
    const { app, db } = appWith([
      ['from matches where id', [{ id: MATCH, team: 'A' }]],
      ['from matches m join match_players mp', [{ team: 'A' }]],
      ['from match_players mp', [{ steam_id64: '76561198000000002', nick: 'x', team: 'B' }]],
    ])
    await request(app).get(`/api/matches/${MATCH}/lado/CT`).set('Cookie', cookie)
    await request(app).get(`/api/matches/${MATCH}/jogador/${VIEWER}/detalhe`).set('Cookie', cookie)
    await request(app).get(`/api/matches/${MATCH}/head-to-head/${VIEWER}`).set('Cookie', cookie)
    const sqls = db.query.mock.calls.map(([s]) => s).filter((s) => s.includes('from kill_positions'))
    expect(sqls.length).toBeGreaterThanOrEqual(3)
    for (const s of sqls) expect(s).toContain('is_team_kill = false')
  })

  it('posicionamento agregado do perfil filtra team kill', async () => {
    const { app, db } = appWith([['group by m.map', [{ map: 'de_mirage', n: 3 }]]])
    await request(app).get(`/api/profile/${VIEWER}/posicoes?modo=kills`).set('Cookie', cookie)
    const sqls = db.query.mock.calls.map(([s]) => s).filter((s) => s.includes('from kill_positions'))
    expect(sqls).toHaveLength(2)
    for (const s of sqls) expect(s).toContain('is_team_kill = false')
  })

  it('backfill de pontuação de clipe não conta team kill', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('from allstar_clips')) {
          return Promise.resolve({ rows: [{ id: 'c1', match_id: 'm1', steam_id64: '765', round_number: 5 }] })
        }
        return Promise.resolve({ rows: [] })
      }),
    }
    await backfillPontuacao(db)
    const sql = db.query.mock.calls.map(([s]) => s).find((s) => s.includes('from kill_positions'))
    expect(sql).toContain('is_team_kill = false')
  })
})
