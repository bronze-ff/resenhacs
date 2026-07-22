import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '76561198000000009', isSuperAdmin: false }, config.jwtSecret)}`
// matchId agora é validado como UUID e checado contra a visibilidade por amizade antes do insert.
const MATCH = '22222222-2222-2222-2222-222222222222'

function appWith() {
  // Toda query devolve uma linha: cobre a checagem de posse (visibilidade por amizade) da
  // partida e o próprio insert.
  const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'c1' }] }) }
  return { app: createApp({ config, db }), db }
}

describe('POST /api/clips', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/clips').send({ matchId: MATCH, url: 'https://allstar.gg/x', steamId: '76561198000000009' })
    expect(res.status).toBe(401)
  })

  it('matchId não-UUID: 400', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/clips').set('Cookie', cookie)
      .send({ matchId: 'm1', url: 'https://allstar.gg/x', steamId: '76561198000000009' })
    expect(res.status).toBe(400)
  })

  it('URL inválida: 400', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/clips').set('Cookie', cookie)
      .send({ matchId: MATCH, url: 'nada', steamId: '76561198000000009' })
    expect(res.status).toBe(400)
  })

  it('steamId inválido: 400', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/clips').set('Cookie', cookie)
      .send({ matchId: MATCH, url: 'https://allstar.gg/x', steamId: 'abc' })
    expect(res.status).toBe(400)
  })

  it('partida não visível ao viewer (não jogou nem é amigo de quem jogou): 404', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('from matches m where m.id')) return Promise.resolve({ rows: [] }) // não visível
        return Promise.resolve({ rows: [{ id: 'c1' }] })
      }),
    }
    const app = createApp({ config, db })
    const res = await request(app).post('/api/clips').set('Cookie', cookie)
      .send({ matchId: MATCH, url: 'https://allstar.gg/x', steamId: '76561198000000009' })
    expect(res.status).toBe(404)
  })

  it('steamId não participou da partida: 400', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        // 'from match_players where' (sem alias mv) é só a checagem de participação — o
        // subquery de partidaVisivelExpr usa 'from match_players mv'.
        if (sql.includes('from match_players where')) return Promise.resolve({ rows: [] }) // não participou
        return Promise.resolve({ rows: [{ id: 'c1' }] })
      }),
    }
    const app = createApp({ config, db })
    const res = await request(app).post('/api/clips').set('Cookie', cookie)
      .send({ matchId: MATCH, url: 'https://allstar.gg/x', steamId: '76561198000000009' })
    expect(res.status).toBe(400)
  })

  it('highlightId não-UUID: 400', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/clips').set('Cookie', cookie)
      .send({ matchId: MATCH, url: 'https://allstar.gg/x', steamId: '76561198000000009', highlightId: 'h1' })
    expect(res.status).toBe(400)
  })

  it('highlightId de outra partida: 400', async () => {
    const HIGHLIGHT = '33333333-3333-3333-3333-333333333333'
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('from highlights')) return Promise.resolve({ rows: [] }) // não pertence a essa match
        return Promise.resolve({ rows: [{ id: 'c1' }] })
      }),
    }
    const app = createApp({ config, db })
    const res = await request(app).post('/api/clips').set('Cookie', cookie)
      .send({ matchId: MATCH, url: 'https://allstar.gg/x', steamId: '76561198000000009', highlightId: HIGHLIGHT })
    expect(res.status).toBe(400)
  })

  it('highlightId válido e da mesma partida: aceita e passa no insert', async () => {
    const HIGHLIGHT = '33333333-3333-3333-3333-333333333333'
    const { app, db } = appWith()
    const res = await request(app).post('/api/clips').set('Cookie', cookie)
      .send({ matchId: MATCH, url: 'https://allstar.gg/x', steamId: '76561198000000009', highlightId: HIGHLIGHT })
    expect(res.status).toBe(201)
    const highlight = db.query.mock.calls.find((c) => c[0].includes('from highlights'))
    expect(highlight[1]).toEqual([HIGHLIGHT, MATCH])
    const insert = db.query.mock.calls.find((c) => c[0].includes('insert into clips'))
    expect(insert[1][1]).toBe(HIGHLIGHT)
  })

  it('anexa clipe e detecta o provider', async () => {
    const { app, db } = appWith()
    const res = await request(app).post('/api/clips').set('Cookie', cookie).send({
      matchId: MATCH, url: 'https://allstar.gg/clip/1', steamId: '76561198000000009', title: 'ace',
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: 'c1', provider: 'allstar' })
    // added_by = jogador logado (7º param do insert)
    const insert = db.query.mock.calls.find((c) => c[0].includes('insert into clips'))
    expect(insert[1][6]).toBe('76561198000000009')
  })

  it('checagem de posse usa visibilidade por amizade (não group_id)', async () => {
    const { app, db } = appWith()
    await request(app).post('/api/clips').set('Cookie', cookie).send({
      matchId: MATCH, url: 'https://allstar.gg/clip/1', steamId: '76561198000000009',
    })
    const dono = db.query.mock.calls.find((c) => c[0].includes('from matches m where m.id'))
    expect(dono[0]).toContain('from friendships f')
    expect(dono[1]).toEqual([MATCH, '76561198000000009'])
  })

  it('checa participação do steamId em match_players antes do insert', async () => {
    const { app, db } = appWith()
    await request(app).post('/api/clips').set('Cookie', cookie).send({
      matchId: MATCH, url: 'https://allstar.gg/clip/1', steamId: '76561198000000009',
    })
    const participou = db.query.mock.calls.find((c) => c[0].includes('from match_players where'))
    expect(participou[1]).toEqual([MATCH, '76561198000000009'])
  })
})
