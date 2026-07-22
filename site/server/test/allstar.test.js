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

  it('clipProcessed: atualiza status/clipUrl/clipTitle/clipSnapshotURL/roundNumber por requestId', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({
        event: 'clip', requestId: 'r1', status: 'Processed', roundNumber: 14,
        clipUrl: 'https://allstar.gg/iframe?clip=abc', clipTitle: 'AWP 5K', clipSnapshotURL: 'https://media.allstar.gg/abc.jpg',
      })
    expect(res.status).toBe(200)
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('update allstar_clips')
    expect(params).toEqual(['r1', 'Processed', 'https://allstar.gg/iframe?clip=abc', 'AWP 5K', 'https://media.allstar.gg/abc.jpg', null, 14])
  })

  it('clipError: grava a mensagem de erro, sempre devolve 2xx (evita retry deles a toa)', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({ event: 'clip', status: 'Error', requestId: 'r1', message: 'telnet timed out' })
    expect(res.status).toBe(200)
    const [, params] = db.query.mock.calls[0]
    expect(params).toEqual(['r1', 'Error', null, null, null, 'telnet timed out', null])
  })

  it('clipUrl e clipSnapshotURL aceitam subdomínio de allstar.gg', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({
        requestId: 'r1', status: 'Processed',
        clipUrl: 'https://cdn.allstar.gg/iframe?clip=abc', clipSnapshotURL: 'https://cdn.allstar.gg/abc.jpg',
      })
    expect(res.status).toBe(200)
    const [, params] = db.query.mock.calls[0]
    expect(params).toEqual(['r1', 'Processed', 'https://cdn.allstar.gg/iframe?clip=abc', null, 'https://cdn.allstar.gg/abc.jpg', null, null])
  })

  it('clipUrl fora da allowlist (host diferente): descarta só a URL, resto do update segue, ainda 200 (finding #5)', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({ requestId: 'r1', status: 'Processed', clipUrl: 'https://evil.com/phishing', clipTitle: 'AWP 5K' })
    expect(res.status).toBe(200)
    const [, params] = db.query.mock.calls[0]
    // clipUrl vira null (coalesce mantém o valor já gravado) — status e clipTitle seguem normais.
    expect(params).toEqual(['r1', 'Processed', null, 'AWP 5K', null, null, null])
  })

  it('clipSnapshotURL fora da allowlist ("allstar.gg.evil.com" não engana o sufixo): descarta só ela', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({ requestId: 'r1', clipUrl: 'https://allstar.gg/iframe?clip=abc', clipSnapshotURL: 'https://allstar.gg.evil.com/abc.jpg' })
    expect(res.status).toBe(200)
    const [, params] = db.query.mock.calls[0]
    expect(params).toEqual(['r1', null, 'https://allstar.gg/iframe?clip=abc', null, null, null, null])
  })

  it('clipUrl com protocolo não-http (javascript:) é descartada', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({ requestId: 'r1', clipUrl: 'javascript:alert(1)' })
    expect(res.status).toBe(200)
    const [, params] = db.query.mock.calls[0]
    expect(params[2]).toBeNull()
  })

  it('comparação constant-time ainda funciona: secret certo passa, secret errado (mesmo tamanho) continua 401', async () => {
    const { app, db } = appWith()
    // Mesmo tamanho do secret configurado ("token segredo-123"), só muda o último char —
    // cobre o caso que timing attack exploraria e garante que timingSafeEqual não quebrou a comparação.
    const errado = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-124')
      .send({ requestId: 'r1', status: 'Processed' })
    expect(errado.status).toBe(401)
    expect(db.query).not.toHaveBeenCalled()

    const certo = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({ requestId: 'r1', status: 'Processed' })
    expect(certo.status).toBe(200)
  })
})
