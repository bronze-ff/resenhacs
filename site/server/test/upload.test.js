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
const GRUPO = '11111111-1111-1111-1111-111111111111'

function appWith(handlers, extra = {}) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      for (const [needle, rows] of [...handlers, ['group_members where group_id = $1 and steam_id64', [{}]]]) {
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
      .set('X-Group-Id', GRUPO)
      .send({ filename: 'x.dem' })
    expect(res.status).toBe(503)
  })

  it('extensão errada: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .set('X-Group-Id', GRUPO)
      .send({ filename: 'demo.txt' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/\.dem/)
  })

  it('share code inválido: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .set('X-Group-Id', GRUPO)
      .send({ filename: 'x.dem', shareCode: 'nao-e-um-share-code' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/share code/i)
  })

  it('data inválida: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .set('X-Group-Id', GRUPO)
      .send({ filename: 'x.dem', playedAt: 'ontem à noite' })
    expect(res.status).toBe(400)
  })

  it('caminho feliz: insere na fila com o group_id do requisitante e devolve a url assinada', async () => {
    const { app, db } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .set('X-Group-Id', GRUPO)
      .send({ filename: 'MinhaDemo.DEM', shareCode: 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee', playedAt: '2026-07-09T20:15' })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('u1')
    expect(res.body.uploadUrl).toBe('https://r2.example/presigned-put')
    expect(res.body.key).toMatch(/^uploads-pendentes\/.+\.dem$/)
    expect(db.query.mock.calls[1][1]).toEqual([GRUPO, '765', res.body.key, 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee', '2026-07-09T20:15'])
    expect(presignUpload).toHaveBeenCalledWith(expect.anything(), 'resenha-demos', res.body.key, 'application/octet-stream')
  })
})
