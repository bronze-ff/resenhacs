import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookieA = `resenha_token=${signToken({ steamId: '111' }, config.jwtSecret)}`
const cookieB = `resenha_token=${signToken({ steamId: '999' }, config.jwtSecret)}`

function appWith(handlers) {
  const query = vi.fn().mockImplementation((sql) => {
    for (const [needle, rows] of handlers) if (sql.includes(needle)) return Promise.resolve({ rows, rowCount: rows.length })
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
  const db = { query, connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) }
  return { app: createApp({ config, db }), db }
}

describe('POST /api/amigos', () => {
  it('alvo não é conta real: 404', async () => {
    const { app } = appWith([['conta_criada_em', []]])
    const res = await request(app).post('/api/amigos').set('Cookie', cookieA).send({ steamId: '999' })
    expect(res.status).toBe(404)
  })
  it('cria pedido pending com par canônico e requested_by = eu', async () => {
    const { app, db } = appWith([['conta_criada_em', [{ steam_id64: '999' }]]])
    const res = await request(app).post('/api/amigos').set('Cookie', cookieA).send({ steamId: '999' })
    expect(res.status).toBe(201)
    const ins = db.query.mock.calls.find((c) => c[0].includes('insert into friendships'))
    expect(ins[1]).toEqual(['111', '999', '111'])            // player_a<player_b, requested_by
  })
})

describe('POST /api/amigos/:steamId/aceitar', () => {
  it('aceita: marca accepted', async () => {
    const { app, db } = appWith([['update friendships', [{}]]])
    const res = await request(app).post('/api/amigos/999/aceitar').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    const upd = db.query.mock.calls.find((c) => c[0].includes('update friendships'))
    expect(upd[0]).toContain("status = 'accepted'")
    expect(upd[1]).toEqual(['111', '999'])                   // par canônico
    expect(upd[0]).toMatch(/requested_by <> \$1\b/)
  })
  it('aceita com steamId menor: marca accepted ($2 branch)', async () => {
    const { app, db } = appWith([['update friendships', [{}]]])
    const res = await request(app).post('/api/amigos/111/aceitar').set('Cookie', cookieB)
    expect(res.status).toBe(200)
    const upd = db.query.mock.calls.find((c) => c[0].includes('update friendships'))
    expect(upd[0]).toContain("status = 'accepted'")
    expect(upd[1]).toEqual(['111', '999'])                   // par canônico, mas euEhA=false usa $2
    expect(upd[0]).toMatch(/requested_by <> \$2\b/)
  })
  it('sem pendente pra aceitar: 404', async () => {
    const { app } = appWith([['update friendships', []]])
    const res = await request(app).post('/api/amigos/999/aceitar').set('Cookie', cookieA)
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/amigos/:steamId', () => {
  it('remove a linha do par (qualquer direção/status)', async () => {
    const { app, db } = appWith([['delete from friendships', [{}]]])
    const res = await request(app).delete('/api/amigos/999').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    const del = db.query.mock.calls.find((c) => c[0].includes('delete from friendships'))
    expect(del[1]).toEqual(['111', '999'])
  })
})

describe('GET /api/amigos', () => {
  it('devolve amigos, recebidos e enviados', async () => {
    const { app } = appWith([['from friendships', [
      { steam_id64: '999', nick: 'x', avatar_url: null, status: 'accepted', requested_by: '111' },
    ]]])
    const res = await request(app).get('/api/amigos').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('amigos')
    expect(res.body).toHaveProperty('recebidos')
    expect(res.body).toHaveProperty('enviados')
  })
})
