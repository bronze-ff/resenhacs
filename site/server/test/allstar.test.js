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
    // Sem roundNumber no body e sem clip encontrado (mock generico devolve rows: []
    // pra tudo), a pontuacao nao e calculada — so o UPDATE (agora precedido pela
    // consulta que tenta achar match_id/steam_id64 do clipe via highlight_id).
    const update = db.query.mock.calls.find(([sql]) => sql.includes('update allstar_clips'))
    expect(update[0]).toContain('update allstar_clips')
    expect(update[1]).toEqual(['r1', 'Processed', 'https://allstar.gg/iframe?clip=abc', 'AWP 5K', 'https://media/abc.jpg', null, null, null])
  })

  it('clipError: grava a mensagem de erro, sempre devolve 2xx (evita retry deles a toa)', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({ event: 'clip', status: 'Error', requestId: 'r1', message: 'telnet timed out' })
    expect(res.status).toBe(200)
    const [, params] = db.query.mock.calls[0]
    expect(params).toEqual(['r1', 'Error', null, null, null, 'telnet timed out', null, null])
  })

  it('status Processed: calcula e grava pontuacao_total/pontuacao_detalhe', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('from kill_positions')) {
          return Promise.resolve({ rows: [
            { weapon: 'ak47', headshot: true },
            { weapon: 'ak47', headshot: true },
            { weapon: 'deagle', headshot: false },
          ] })
        }
        if (sql.includes('from highlights')) {
          return Promise.resolve({ rows: [{ kind: 'clutch_1v2' }] })
        }
        return Promise.resolve({ rows: [] })
      }),
    }
    const app = createApp({ config: configBase, db })
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({ requestId: 'req-1', status: 'Processed', clipUrl: 'https://allstar.gg/x', roundNumber: 5 })
    expect(res.status).toBe(200)
    const update = db.query.mock.calls.find(([sql]) => sql.includes('update allstar_clips'))
    expect(update[0]).toContain('pontuacao_total')
    expect(update[0]).toContain('pontuacao_detalhe')
    // 3 kills (50) + 2 headshots (16) + clutch 1v2 (20) + 2 armas distintas (10) = 96
    const params = update[1]
    expect(params).toContain(96)
  })

  it('status Processed sem highlight de clutch: clutch null, sem quebrar', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('from kill_positions')) return Promise.resolve({ rows: [{ weapon: 'awp', headshot: true }] })
        if (sql.includes('from highlights')) return Promise.resolve({ rows: [] })
        return Promise.resolve({ rows: [] })
      }),
    }
    const app = createApp({ config: configBase, db })
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({ requestId: 'req-2', status: 'Processed', roundNumber: 3 })
    expect(res.status).toBe(200)
  })

  it('status diferente de Processed (Submitted/Error): nao calcula pontuacao', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const app = createApp({ config: configBase, db })
    await request(app).post('/api/allstar/webhook').set('Authorization', 'token segredo-123')
      .send({ requestId: 'req-3', status: 'Error', message: 'falhou' })
    const chamouKillPositions = db.query.mock.calls.some(([sql]) => sql.includes('from kill_positions'))
    expect(chamouKillPositions).toBe(false)
  })
})
