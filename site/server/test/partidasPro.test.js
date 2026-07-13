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
const cookieJogador = `resenha_token=${signToken({ steamId: '765', isAdmin: false }, config.jwtSecret)}`
const cookieAdmin = `resenha_token=${signToken({ steamId: '999', isAdmin: true }, config.jwtSecret)}`

function appWith(handlers) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      for (const [needle, rows] of handlers) {
        if (sql.includes(needle)) return Promise.resolve({ rows })
      }
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db, r2Client: { send: vi.fn() } }), db }
}

describe('GET /api/partidas-pro-fila', () => {
  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/partidas-pro-fila').set('Cookie', cookieJogador)).status).toBe(403)
  })

  it('admin ve a fila', async () => {
    const { app } = appWith([
      ['from partidas_pro_fila', [{ id: 'f1', hltv_url: 'https://hltv.org/x', status: 'pendente', match_id: null, match_ids: [], erro: null }]],
    ])
    const res = await request(app).get('/api/partidas-pro-fila').set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ id: 'f1', status: 'pendente', matchIds: [] })
  })

  it('devolve matchIds quando a fila tem varios mapas de uma serie', async () => {
    const { app } = appWith([
      ['from partidas_pro_fila', [{
        id: 'f2', hltv_url: 'https://hltv.org/y', status: 'concluida', match_id: 'm1',
        match_ids: ['m1', 'm2', 'm3'], erro: null,
      }]],
    ])
    const res = await request(app).get('/api/partidas-pro-fila').set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ id: 'f2', matchId: 'm1', matchIds: ['m1', 'm2', 'm3'] })
  })
})

describe('POST /api/partidas-pro-fila', () => {
  it('adiciona link novo', async () => {
    const { app, db } = appWith([['insert into partidas_pro_fila', [{ id: 'f2' }]]])
    const res = await request(app).post('/api/partidas-pro-fila').set('Cookie', cookieAdmin).send({ hltvUrl: 'https://hltv.org/download/demo/999' })
    expect(res.status).toBe(201)
    expect(db.query.mock.calls[0][1][1]).toBe('999') // steamId de quem adicionou
  })

  it('sem url: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/partidas-pro-fila').set('Cookie', cookieAdmin).send({})
    expect(res.status).toBe(400)
  })
})

describe('POST /api/partidas-pro-fila/upload-url', () => {
  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/partidas-pro-fila/upload-url')
      .set('Cookie', cookieJogador)
      .send({ filename: 'demo.rar' })
    expect(res.status).toBe(403)
  })

  it('extensao invalida: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/partidas-pro-fila/upload-url')
      .set('Cookie', cookieAdmin)
      .send({ filename: 'demo.zip' })
    expect(res.status).toBe(400)
  })

  it('caminho feliz devolve id, uploadUrl e key com a extensao certa', async () => {
    const { app, db } = appWith([['insert into partidas_pro_fila', [{ id: 'f9' }]]])
    const res = await request(app)
      .post('/api/partidas-pro-fila/upload-url')
      .set('Cookie', cookieAdmin)
      .send({ filename: 'MinhaDemo.DEM' })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('f9')
    expect(res.body.uploadUrl).toBe('https://r2.example/presigned-put')
    expect(res.body.key).toMatch(/^partidas-pro-pendentes\/.+\.dem$/)
    expect(db.query.mock.calls[0][1][1]).toBe('999') // steamId de quem enviou
    expect(presignUpload).toHaveBeenCalledWith(
      expect.anything(), 'resenha-demos', res.body.key, 'application/octet-stream',
    )
  })
})

describe('PATCH /api/partidas-pro-fila/:id/retry', () => {
  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    expect((await request(app).patch('/api/partidas-pro-fila/f1/retry').set('Cookie', cookieJogador)).status).toBe(403)
  })

  it('admin reseta item falhou pra pendente', async () => {
    const { app, db } = appWith([['update partidas_pro_fila', [{ id: 'f1' }]]])
    const res = await request(app).patch('/api/partidas-pro-fila/f1/retry').set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, status: 'pendente' })
    expect(db.query.mock.calls[0][1]).toEqual(['f1'])
  })

  it('item nao encontrado ou nao esta falhou: 404', async () => {
    const { app } = appWith([['update partidas_pro_fila', []]])
    const res = await request(app).patch('/api/partidas-pro-fila/f1/retry').set('Cookie', cookieAdmin)
    expect(res.status).toBe(404)
  })
})
