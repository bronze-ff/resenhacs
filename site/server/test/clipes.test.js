import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`

// allstar_clips não guarda match_id/steam_id64/round_number direto (só highlight_id) —
// a rota junta com `highlights` (mesmo padrão já usado em routes/allstar.js). Os mocks
// abaixo respondem à query que faz esse join.
function fakeDbCom({ allstarClips = [] } = {}) {
  return {
    query: vi.fn().mockImplementation((sql) => {
      if (sql.includes('from allstar_clips ac')) return Promise.resolve({ rows: allstarClips })
      return Promise.resolve({ rows: [] })
    }),
  }
}

describe('GET /api/clipes', () => {
  it('sem login: 401', async () => {
    const db = fakeDbCom()
    const app = createApp({ config, db })
    const res = await request(app).get('/api/clipes')
    expect(res.status).toBe(401)
  })

  it('sem clipes: devolve lista vazia, sem leaderboard', async () => {
    const db = fakeDbCom({ allstarClips: [] })
    const app = createApp({ config, db })
    const res = await request(app).get('/api/clipes').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ clipes: [] })
    expect(res.body).not.toHaveProperty('leaderboard')
  })

  it('clipe processado aparece com a pontuacao gravada', async () => {
    const db = fakeDbCom({
      allstarClips: [{
        id: 'c1', match_id: 'm1', steam_id64: '765', round_number: 9,
        clip_url: 'https://allstar.gg/x', clip_snapshot_url: null, kind: null,
        map: 'de_dust2', played_at: '2026-07-01T00:00:00Z', nick: 'Jogador', avatar_url: null,
        pontuacao_total: 134,
        pontuacao_detalhe: {
          kills: 4, pontosKills: 80, headshots: 3, pontosHeadshots: 24,
          clutch: '1v2', pontosClutch: 20, armas: 2, pontosArmas: 10, total: 134,
        },
      }],
    })
    const app = createApp({ config, db })
    const res = await request(app).get('/api/clipes').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.clipes[0].pontuacao.total).toBe(134)
    expect(res.body).not.toHaveProperty('leaderboard')
  })

  it('clipe sem pontuacao_detalhe (defensivo, nao deveria acontecer p/ Processed): usa total bruto sem quebrar', async () => {
    const db = fakeDbCom({
      allstarClips: [{
        id: 'c2', match_id: 'm2', steam_id64: '765', round_number: 3,
        clip_url: 'https://allstar.gg/y', clip_snapshot_url: null, kind: null,
        map: 'de_mirage', played_at: '2026-07-02T00:00:00Z', nick: 'Jogador', avatar_url: null,
        pontuacao_total: null, pontuacao_detalhe: null,
      }],
    })
    const app = createApp({ config, db })
    const res = await request(app).get('/api/clipes').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.clipes[0].pontuacao).toEqual({ total: 0 })
  })

  it('so busca clipes com status Processed', async () => {
    const db = fakeDbCom({ allstarClips: [] })
    const app = createApp({ config, db })
    await request(app).get('/api/clipes').set('Cookie', cookie)
    const call = db.query.mock.calls.find(([sql]) => sql.includes('from allstar_clips ac'))
    expect(call[0]).toContain("ac.status = 'Processed'")
  })

  it('escopa por visibilidade de amizade (partidaVisivelExpr), nao so pelo dono do clipe', async () => {
    const db = fakeDbCom({ allstarClips: [] })
    const app = createApp({ config, db })
    await request(app).get('/api/clipes').set('Cookie', cookie)
    const call = db.query.mock.calls.find(([sql]) => sql.includes('from allstar_clips ac'))
    expect(call[0]).toContain('from friendships f')
    expect(call[1]).toContain('765')
  })

  it('periodo=semana filtra por played_at >= 7 dias', async () => {
    const db = fakeDbCom({ allstarClips: [] })
    const app = createApp({ config, db })
    await request(app).get('/api/clipes?periodo=semana').set('Cookie', cookie)
    const call = db.query.mock.calls.find(([sql]) => sql.includes('from allstar_clips ac'))
    expect(call[0]).toContain("interval '7 days'")
  })

  it('periodo invalido cai no default (sempre, sem filtro extra de intervalo)', async () => {
    const db = fakeDbCom({ allstarClips: [] })
    const app = createApp({ config, db })
    await request(app).get('/api/clipes?periodo=lixo').set('Cookie', cookie)
    const call = db.query.mock.calls.find(([sql]) => sql.includes('from allstar_clips ac'))
    expect(call[0]).not.toContain('interval')
  })
})
