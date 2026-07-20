import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'

const configBase = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, allstarWebhookAuth: 'token segredo-123' }

function appWith(config = configBase) {
  const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
  return { app: createApp({ config, db }), db }
}

describe('POST /api/allstar/webhook', () => {
  it('sem Authorization: 401, nao chama o banco', async () => {
    const { app, db } = appWith()
    const res = await request(app).post('/api/allstar/webhook').send({ requestId: 'r1', status: 'Processed' })
    expect(res.status).toBe(401)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('Authorization errado: 401', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token errado')
      .send({ requestId: 'r1', status: 'Processed' })
    expect(res.status).toBe(401)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('sem allstarWebhookAuth configurado: 401 (nunca aceita sem validar)', async () => {
    const { app, db } = appWith({ ...configBase, allstarWebhookAuth: null })
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({ requestId: 'r1', status: 'Processed' })
    expect(res.status).toBe(401)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('sem requestId: 400', async () => {
    const { app } = appWith()
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({ status: 'Processed' })
    expect(res.status).toBe(400)
  })

  it('clipProcessed: atualiza status/clipUrl/clipTitle/clipSnapshotURL por requestId', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({
        event: 'clip', requestId: 'r1', status: 'Processed',
        clipUrl: 'https://allstar.gg/iframe?clip=abc', clipTitle: 'AWP 5K', clipSnapshotURL: 'https://media/abc.jpg',
      })
    expect(res.status).toBe(200)
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('update allstar_clips')
    expect(params).toEqual(['r1', 'Processed', 'https://allstar.gg/iframe?clip=abc', 'AWP 5K', 'https://media/abc.jpg', null])
  })

  it('clipError: grava a mensagem de erro, sempre devolve 2xx (evita retry deles a toa)', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({ event: 'clip', status: 'Error', requestId: 'r1', message: 'telnet timed out' })
    expect(res.status).toBe(200)
    const [, params] = db.query.mock.calls[0]
    expect(params).toEqual(['r1', 'Error', null, null, null, 'telnet timed out'])
  })
})
