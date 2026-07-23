import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

vi.mock('../src/r2.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, presignUpload: vi.fn().mockResolvedValue('https://r2.example/presigned-put') }
})
import { presignUpload } from '../src/r2.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos' }
const cookie = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`

function appWith(handlers, extra = {}) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      for (const [needle, rows] of handlers) {
        if (sql.includes(needle)) return Promise.resolve({ rows })
      }
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db, r2Client: { send: vi.fn() }, ...extra }), db }
}

describe('POST /api/upload/upload-url', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/upload/upload-url').send({ filename: 'x.dem' })
    expect(res.status).toBe(401)
  })

  it('sem R2 configurado: 503', async () => {
    const { app } = appWith([], { r2Client: null })
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem' })
    expect(res.status).toBe(503)
  })

  it('extensão errada: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'demo.txt' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/\.dem/)
  })

  it('share code inválido: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', shareCode: 'nao-e-um-share-code' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/share code/i)
  })

  it('data inválida: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', playedAt: 'ontem à noite' })
    expect(res.status).toBe(400)
  })

  it('data no futuro: 400', async () => {
    const { app } = appWith([])
    const futuro = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', playedAt: futuro })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/entre.*dias/i)
  })

  it('data com formato valido mas invalida no calendario (mes/hora impossiveis): 400, nao 500', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', playedAt: '2026-13-45T99:99' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/data.*hora inv[áa]lida/i)
  })

  it('data mais de 3 dias no passado: 400', async () => {
    const { app } = appWith([])
    const antigo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', playedAt: antigo })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/entre.*dias/i)
  })

  it('data dentro da janela de 3 dias: aceita normalmente', async () => {
    const { app } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const recente = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', playedAt: recente })
    expect(res.status).toBe(200)
  })

  it('caminho feliz: insere na fila sem group_id e devolve a url assinada', async () => {
    const { app, db } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const playedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'MinhaDemo.DEM', shareCode: 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee', playedAt })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('u1')
    expect(res.body.uploadUrl).toBe('https://r2.example/presigned-put')
    expect(res.body.key).toMatch(/^uploads-pendentes\/.+\.dem$/)
    const insert = db.query.mock.calls.find((c) => c[0].includes('insert into uploads_pendentes'))
    expect(insert[0]).not.toContain('group_id')
    expect(insert[1]).toEqual(['765', res.body.key, 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee', playedAt, null])
    expect(presignUpload).toHaveBeenCalledWith(expect.anything(), 'resenha-demos', res.body.key, 'application/octet-stream')
  })

  it('plataforma manual invalida: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', plataformaManual: 'esl' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/plataforma/i)
  })

  it('plataforma manual valida: grava na fila', async () => {
    const { app, db } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', plataformaManual: 'gamers_club' })
    expect(res.status).toBe(200)
    const insert = db.query.mock.calls.find((c) => c[0].includes('insert into uploads_pendentes'))
    expect(insert[1]).toEqual(['765', res.body.key, null, null, 'gamers_club'])
  })

  // ---- finding #2 da auditoria: teto de tamanho (defesa em profundidade client-side) ----

  it('tamanho acima do limite: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', tamanho: 500 * 1024 * 1024 })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/limite/i)
  })

  it('tamanho invalido (nao numerico ou <= 0): 400', async () => {
    const { app } = appWith([])
    const res1 = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', tamanho: 'muito' })
    expect(res1.status).toBe(400)

    const res2 = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', tamanho: 0 })
    expect(res2.status).toBe(400)
  })

  it('tamanho dentro do limite: aceita normalmente', async () => {
    const { app } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', tamanho: 100 * 1024 * 1024 })
    expect(res.status).toBe(200)
  })

  it('sem tamanho (compat com cliente antigo): aceita normalmente', async () => {
    const { app } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem' })
    expect(res.status).toBe(200)
  })
})
