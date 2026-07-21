import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '76561198000000009', isSuperAdmin: false }, config.jwtSecret)}`

function appWith(rows) {
  const db = { query: vi.fn().mockResolvedValue({ rows }) }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/ranking', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/ranking')).status).toBe(401)
  })

  it('calcula winrate/kd/hs e ordena por rating desc', async () => {
    const { app } = appWith([
      { steam_id64: '1', nick: 'baixo', avatar_url: null, partidas: 4, vitorias: 1, kills: 40, deaths: 50, hs: 10, rating: '0.80', aces: 0, clutch_wins: 0, clutch_attempts: 0, entry_kills: 2, entry_deaths: 2, utility_damage: 100, rounds: 80, shots_fired: 200, shots_hit: 40 },
      { steam_id64: '2', nick: 'alto', avatar_url: null, partidas: 10, vitorias: 7, kills: 200, deaths: 150, hs: 100, rating: '1.35', aces: 3, clutch_wins: 3, clutch_attempts: 5, entry_kills: 20, entry_deaths: 5, utility_damage: 200, rounds: 200, shots_fired: 500, shots_hit: 150 },
    ])
    const res = await request(app).get('/api/ranking').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0]).toMatchObject({
      nick: 'alto', winrate: 70, kd: 1.33, hsPct: 50, rating: 1.35, aces: 3,
      clutchWins: 3, clutchAttempts: 5, clutchPct: 60,
    })
    expect(res.body[0].estilo).not.toBeNull() // 2+ partidas -> classificado em algum estilo (testes dedicados em analise.test.js)
    expect(res.body[1].nick).toBe('baixo')
  })

  it('escopo populacional: quem entra no ranking é eu + amigos accepted (friendships), não group_members', async () => {
    const { app, db } = appWith([])
    const res = await request(app).get('/api/ranking').set('Cookie', cookie)
    expect(res.status).toBe(200)
    const chamada = db.query.mock.calls.find(([sql]) => sql.includes('join players p on p.steam_id64 = gm.steam_id64'))
    expect(chamada).toBeDefined()
    const [sql, params] = chamada
    // A população (LEFT JOIN base, inclui quem tem 0 partidas) vem de um union: o próprio
    // viewer + quem tem amizade accepted com ele — não mais da tabela de grupo.
    expect(sql).toContain('from (')
    expect(sql).toContain('union')
    expect(sql).toContain('from friendships f')
    expect(sql).toContain("f.status = 'accepted'")
    expect(sql).not.toContain('group_members')
    expect(params[0]).toBe('76561198000000009') // viewer do cookie -> $1 no union
  })

  it('forma recente: sobe, cai, estável e amostra insuficiente', async () => {
    const db = { query: vi.fn() }
    db.query
      .mockResolvedValueOnce({ rows: [
        { steam_id64: '1', recente: '1.40', geral: '1.10', total: 8 }, // subindo
        { steam_id64: '2', recente: '0.80', geral: '1.10', total: 8 }, // caindo
        { steam_id64: '3', recente: '1.11', geral: '1.10', total: 8 }, // estável (dentro do limiar)
        { steam_id64: '4', recente: '1.40', geral: '1.10', total: 3 }, // amostra insuficiente (<5)
      ] })
      .mockResolvedValueOnce({ rows: [
        { steam_id64: '1', nick: 'sobe', avatar_url: null, partidas: 8, vitorias: 4, kills: 80, deaths: 80, hs: 20, rating: '1.10', aces: 0, clutch_wins: 0, clutch_attempts: 0 },
        { steam_id64: '2', nick: 'desce', avatar_url: null, partidas: 8, vitorias: 4, kills: 80, deaths: 80, hs: 20, rating: '1.10', aces: 0, clutch_wins: 0, clutch_attempts: 0 },
        { steam_id64: '3', nick: 'estavel', avatar_url: null, partidas: 8, vitorias: 4, kills: 80, deaths: 80, hs: 20, rating: '1.10', aces: 0, clutch_wins: 0, clutch_attempts: 0 },
        { steam_id64: '4', nick: 'poucas', avatar_url: null, partidas: 3, vitorias: 1, kills: 30, deaths: 30, hs: 5, rating: '1.10', aces: 0, clutch_wins: 0, clutch_attempts: 0 },
      ] })
    const app = createApp({ config, db })
    const res = await request(app).get('/api/ranking').set('Cookie', cookie)
    const porNick = Object.fromEntries(res.body.map((r) => [r.nick, r.forma]))
    expect(porNick.sobe).toMatchObject({ tendencia: 'subindo', recente: 1.4, geral: 1.1 })
    expect(porNick.desce).toMatchObject({ tendencia: 'caindo', recente: 0.8, geral: 1.1 })
    expect(porNick.estavel).toMatchObject({ tendencia: 'estavel' })
    expect(porNick.poucas).toBeNull()
  })

  it('jogador sem partidas ainda: rating null vai pro fim', async () => {
    const { app } = appWith([
      { steam_id64: '1', nick: 'novato', avatar_url: null, partidas: 0, vitorias: 0, kills: 0, deaths: 0, hs: 0, rating: null, aces: 0, clutch_wins: 0, clutch_attempts: 0 },
      { steam_id64: '2', nick: 'veterano', avatar_url: null, partidas: 5, vitorias: 3, kills: 80, deaths: 60, hs: 20, rating: '1.10', aces: 1, clutch_wins: 0, clutch_attempts: 2 },
    ])
    const res = await request(app).get('/api/ranking').set('Cookie', cookie)
    expect(res.body.map((r) => r.nick)).toEqual(['veterano', 'novato'])
    expect(res.body[1].rating).toBeNull()
  })
})
