import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { agruparLineups, comandoTreino, normalizarLinha } from '../src/granadasAutomaticas.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`

function appWith(rows) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      if (sql.includes('from lineups l')) return Promise.resolve({ rows })
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db, r2Client: null }), db }
}

let seq = 0
function linha(over = {}) {
  seq += 1
  return {
    id: `l${seq}`, match_id: 'm1', round_number: 3, map: 'de_mirage', tipo: 'smoke', lado: 'T',
    origem: 'grupo', tick: 1000 + seq, thrower_steam_id: '765', thrower_nick: 'bronze',
    thrower_x: '0.500', thrower_y: '0.500', thrower_yaw: '90', thrower_pitch: '-10',
    target_x: '0.300', target_y: '0.300',
    thrower_world_x: null, thrower_world_y: null, thrower_world_z: null, replay_frame: null,
    ...over,
  }
}

describe('comandoTreino', () => {
  it('formata exatamente como o console do CS2', () => {
    expect(comandoTreino({ x: 1136, y: -255.5, z: -167.96875, pitch: -12.25, yaw: 91.5 }))
      .toBe('setpos 1136.00 -255.50 -167.97; setang -12.25 91.50 0')
  })

  it('sem Z: null (não inventa altura)', () => {
    expect(comandoTreino({ x: 1, y: 2, z: null, pitch: 0, yaw: 0 })).toBeNull()
    expect(comandoTreino(null)).toBeNull()
  })
})

describe('agruparLineups', () => {
  it('junta arremessos do mesmo spot e separa spot/alvo/lado diferentes', () => {
    const linhas = [
      linha({ thrower_x: '0.500', target_x: '0.300' }),
      linha({ thrower_x: '0.505', target_x: '0.310', thrower_steam_id: '766', thrower_nick: 'amigo' }),
      linha({ thrower_x: '0.502', target_x: '0.305' }),
      linha({ thrower_x: '0.800', target_x: '0.300' }), // outro spot de arremesso
      linha({ thrower_x: '0.500', target_x: '0.700' }), // outro alvo
      linha({ lado: 'CT' }), // outro lado
      linha({ tipo: 'flash' }), // outro tipo
    ].map(normalizarLinha)
    const clusters = agruparLineups(linhas)
    expect(clusters).toHaveLength(5)
    const maior = clusters[0]
    expect(maior.total).toBe(3)
    expect(maior.usosGrupo).toBe(3)
    expect(maior.jogadores[0]).toEqual({ steamId: '765', nick: 'bronze', usos: 2 })
    expect(maior.jogadores[1]).toEqual({ steamId: '766', nick: 'amigo', usos: 1 })
  })

  it('minUsos filtra spots raros', () => {
    const linhas = [linha(), linha(), linha({ thrower_x: '0.9' })].map(normalizarLinha)
    expect(agruparLineups(linhas, { minUsos: 2 })).toHaveLength(1)
  })

  it('comando de treino vem do membro mais central que tem coordenada de mundo', () => {
    const linhas = [
      linha({ thrower_x: '0.500' }), // central, mas sem mundo (demo antiga)
      linha({ thrower_x: '0.510', thrower_world_x: '100', thrower_world_y: '200', thrower_world_z: '-50',
        thrower_pitch: '-5.5', thrower_yaw: '45' }),
      linha({ thrower_x: '0.490' }),
    ].map(normalizarLinha)
    const [c] = agruparLineups(linhas)
    expect(c.comando).toBe('setpos 100.00 200.00 -50.00; setang -5.50 45.00 0')
    expect(c.mundo).toMatchObject({ x: 100, y: 200, z: -50 })
  })

  it('sem nenhuma coordenada de mundo: comando null', () => {
    const [c] = agruparLineups([linha()].map(normalizarLinha))
    expect(c.comando).toBeNull()
    expect(c.mundo).toBeNull()
  })

  it('exemplo prefere partida do grupo e pros saem só com nick', () => {
    const linhas = [
      linha({ origem: 'pro', match_id: 'pro1', thrower_steam_id: '7656', thrower_nick: 'ZywOo' }),
      linha({ origem: 'pro', match_id: 'pro1', thrower_steam_id: '7656', thrower_nick: 'ZywOo' }),
      linha({ origem: 'grupo', match_id: 'g1', round_number: 7, tick: 5555, replay_frame: 40, thrower_x: '0.51' }),
    ].map(normalizarLinha)
    const [c] = agruparLineups(linhas)
    expect(c.usosPro).toBe(2)
    expect(c.usosGrupo).toBe(1)
    expect(c.exemplo).toEqual({ matchId: 'g1', roundNumber: 7, tick: 5555, frame: 40, origem: 'grupo' })
    expect(c.pros).toEqual([{ nick: 'ZywOo', usos: 2 }])
    expect(JSON.stringify(c.pros)).not.toContain('7656')
  })
})

describe('GET /api/granadas/automaticas', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/granadas/automaticas?map=de_mirage')).status).toBe(401)
  })

  it('sem mapa válido: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).get("/api/granadas/automaticas?map=x';drop").set('Cookie', cookie)
    expect(res.status).toBe(400)
  })

  it('agrupa, escopa por amizade (pro é público) e parametriza filtros', async () => {
    const { app, db } = appWith([linha(), linha({ thrower_x: '0.505' })])
    const res = await request(app)
      .get('/api/granadas/automaticas?map=de_mirage&tipo=smoke&lado=T&origem=grupo&min=2')
      .set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({ tipo: 'smoke', lado: 'T', total: 2, map: 'de_mirage' })
    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes('from lineups l'))
    expect(sql).toContain('from friendships f')
    expect(sql).toContain("l.origem = 'pro' or")
    expect(params).toEqual(['765', 'de_mirage', 'smoke', 'T', 'grupo'])
  })

  it('filtros inválidos são ignorados (não viram SQL)', async () => {
    const { app, db } = appWith([])
    await request(app).get('/api/granadas/automaticas?map=de_mirage&tipo=nuke&lado=Z&origem=x').set('Cookie', cookie)
    const [, params] = db.query.mock.calls.find(([s]) => s.includes('from lineups l'))
    expect(params).toEqual(['765', 'de_mirage'])
  })
})
