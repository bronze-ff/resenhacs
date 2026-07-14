import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos' }
const cookieJogador = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`
const cookieAdmin = `resenha_token=${signToken({ steamId: '999', isSuperAdmin: true }, config.jwtSecret)}`

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

describe('GET /api/taticas', () => {
  it('jogador comum: 403 (pagina ainda em teste, admin-only)', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/taticas?map=de_mirage').set('Cookie', cookieJogador)).status).toBe(403)
  })

  it('admin lista só aprovadas por padrao', async () => {
    const { app, db } = appWith([['from taticas', []]])
    await request(app).get('/api/taticas?map=de_mirage').set('Cookie', cookieAdmin)
    expect(db.query.mock.calls[0][0]).toContain("status = 'aprovada'")
  })
})

describe('POST /api/taticas', () => {
  it('qualquer jogador autenticado pode sugerir, entra como sugerida', async () => {
    const { app, db } = appWith([
      ['insert into taticas', [{ id: 't1' }]],
    ])
    const res = await request(app).post('/api/taticas').set('Cookie', cookieJogador).send({
      nome: 'Execução B', descricao: 'bronze entra seco', map: 'de_mirage',
      matchId: 'm1', roundNumber: 5,
    })
    expect(res.status).toBe(201)
    const insert = db.query.mock.calls.find((c) => c[0].includes('insert into taticas'))
    expect(insert[1]).toContain('sugerida')
  })

  it('sem nome: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/taticas').set('Cookie', cookieJogador).send({ map: 'de_mirage', matchId: 'm1', roundNumber: 1 })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/taticas/:id', () => {
  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    const res = await request(app).patch('/api/taticas/t1').set('Cookie', cookieJogador).send({ status: 'aprovada' })
    expect(res.status).toBe(403)
  })

  it('admin aprova', async () => {
    const { app, db } = appWith([['update taticas', [{ id: 't1' }]]])
    const res = await request(app).patch('/api/taticas/t1').set('Cookie', cookieAdmin).send({ status: 'aprovada' })
    expect(res.status).toBe(200)
    expect(db.query.mock.calls[0][1]).toEqual(['aprovada', 't1'])
  })
})
