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
    // roundNumber:14 no body faz o handler entrar no bloco de pontuacao (status ===
    // 'Processed'), disparando consultas extras antes do UPDATE — por isso .find() em
    // vez de mock.calls[0]. So os 7 primeiros params (ate roundNumber) importam aqui;
    // pontuacaoTotal/Detalhe (trailing) tem teste dedicado logo abaixo.
    const update = db.query.mock.calls.find(([sql]) => sql.includes('update allstar_clips'))
    expect(update[0]).toContain('update allstar_clips')
    expect(update[1].slice(0, 7)).toEqual(['r1', 'Processed', 'https://allstar.gg/iframe?clip=abc', 'AWP 5K', 'https://media.allstar.gg/abc.jpg', null, 14])
  })

  it('clipError: grava a mensagem de erro, sempre devolve 2xx (evita retry deles a toa)', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({ event: 'clip', status: 'Error', requestId: 'r1', message: 'telnet timed out' })
    expect(res.status).toBe(200)
    const [, params] = db.query.mock.calls[0]
    expect(params).toEqual(['r1', 'Error', null, null, null, 'telnet timed out', null, null, null])
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
    // status:'Processed' sem roundNumber ainda dispara a consulta de clipRows (bloco de
    // pontuacao), entao o UPDATE nao e mais necessariamente a 1a chamada - .find() em
    // vez de mock.calls[0]. Sem roundNumber nem clip encontrado, pontuacao fica null,null.
    const [, params] = db.query.mock.calls.find(([sql]) => sql.includes('update allstar_clips'))
    expect(params).toEqual(['r1', 'Processed', 'https://cdn.allstar.gg/iframe?clip=abc', null, 'https://cdn.allstar.gg/abc.jpg', null, null, null, null])
  })

  it('clipUrl fora da allowlist (host diferente): descarta só a URL, resto do update segue, ainda 200 (finding #5)', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({ requestId: 'r1', status: 'Processed', clipUrl: 'https://evil.com/phishing', clipTitle: 'AWP 5K' })
    expect(res.status).toBe(200)
    const [, params] = db.query.mock.calls.find(([sql]) => sql.includes('update allstar_clips'))
    // clipUrl vira null (coalesce mantém o valor já gravado) — status e clipTitle seguem normais.
    expect(params).toEqual(['r1', 'Processed', null, 'AWP 5K', null, null, null, null, null])
  })

  it('clipSnapshotURL fora da allowlist ("allstar.gg.evil.com" não engana o sufixo): descarta só ela', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/allstar/webhook')
      .set('Authorization', 'token segredo-123')
      .send({ requestId: 'r1', clipUrl: 'https://allstar.gg/iframe?clip=abc', clipSnapshotURL: 'https://allstar.gg.evil.com/abc.jpg' })
    expect(res.status).toBe(200)
    // sem status no body (nao é 'Processed'), entao o UPDATE continua sendo a unica
    // chamada - mock.calls[0] ainda vale aqui.
    const [, params] = db.query.mock.calls[0]
    expect(params).toEqual(['r1', null, 'https://allstar.gg/iframe?clip=abc', null, null, null, null, null, null])
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
