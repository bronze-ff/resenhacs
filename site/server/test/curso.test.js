import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

vi.mock('../src/r2.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    presignDownload: vi.fn().mockResolvedValue('https://r2.example/presigned-get'),
    presignUpload: vi.fn().mockResolvedValue('https://r2.example/presigned-put'),
  }
})

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos' }
const cookieMembro = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`
const cookieAdmin = `resenha_token=${signToken({ steamId: '111', isSuperAdmin: true }, config.jwtSecret)}`
const GRUPO = '11111111-1111-1111-1111-111111111111'

function appWith({ progresso = [] } = {}) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      if (sql.includes('group_members where group_id')) return Promise.resolve({ rows: [{}] })
      if (sql.includes('from curso_progresso')) return Promise.resolve({ rows: progresso })
      if (sql.includes('insert into curso_progresso')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db, r2Client: { send: vi.fn() } }), db }
}

describe('GET /api/curso', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    const res = await request(app).get('/api/curso')
    expect(res.status).toBe(401)
  })

  it('sem X-Group-Id: 400', async () => {
    const { app } = appWith()
    const res = await request(app).get('/api/curso').set('Cookie', cookieMembro)
    expect(res.status).toBe(400)
  })

  it('devolve os 5 vídeos do catálogo, em ordem, com progresso do jogador', async () => {
    const { app } = appWith({
      progresso: [{ video_slug: 'modulo-1-aimbotz', concluido: true, posicao_segundos: 600 }],
    })
    const res = await request(app).get('/api/curso').set('Cookie', cookieMembro).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(5)
    expect(res.body[0]).toMatchObject({ slug: 'introducao', titulo: 'Introdução', concluido: false, posicaoSegundos: 0 })
    expect(res.body[1]).toMatchObject({ slug: 'modulo-1-aimbotz', concluido: true, posicaoSegundos: 600 })
  })
})

describe('GET /api/curso/:slug/url', () => {
  it('slug fora do catálogo: 404', async () => {
    const { app } = appWith()
    const res = await request(app).get('/api/curso/nao-existe/url').set('Cookie', cookieMembro).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(404)
    expect(res.body.erro).toBe('Vídeo não encontrado')
  })

  it('slug válido: devolve a URL assinada', async () => {
    const { app } = appWith()
    const res = await request(app).get('/api/curso/introducao/url').set('Cookie', cookieMembro).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ url: 'https://r2.example/presigned-get' })
  })
})

describe('PUT /api/curso/:slug/progresso', () => {
  it('slug fora do catálogo: 404', async () => {
    const { app } = appWith()
    const res = await request(app)
      .put('/api/curso/nao-existe/progresso')
      .set('Cookie', cookieMembro)
      .set('X-Group-Id', GRUPO)
      .send({ posicaoSegundos: 10, concluido: false })
    expect(res.status).toBe(404)
  })

  it('slug válido: upsert e devolve 204', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .put('/api/curso/introducao/progresso')
      .set('Cookie', cookieMembro)
      .set('X-Group-Id', GRUPO)
      .send({ posicaoSegundos: 42, concluido: false })
    expect(res.status).toBe(204)
    const chamada = db.query.mock.calls.find(([sql]) => sql.includes('insert into curso_progresso'))
    expect(chamada[1]).toEqual(['765', 'introducao', 42, false])
  })
})

describe('POST /api/curso/upload-url', () => {
  it('membro comum: 403', async () => {
    const { app } = appWith()
    const res = await request(app)
      .post('/api/curso/upload-url')
      .set('Cookie', cookieMembro)
      .send({ slug: 'introducao' })
    expect(res.status).toBe(403)
  })

  it('super-admin com slug do catálogo: devolve a URL de upload', async () => {
    const { app } = appWith()
    const res = await request(app)
      .post('/api/curso/upload-url')
      .set('Cookie', cookieAdmin)
      .send({ slug: 'introducao' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ uploadUrl: 'https://r2.example/presigned-put' })
  })

  it('super-admin com slug fora do catálogo: 404', async () => {
    const { app } = appWith()
    const res = await request(app)
      .post('/api/curso/upload-url')
      .set('Cookie', cookieAdmin)
      .send({ slug: 'nao-existe' })
    expect(res.status).toBe(404)
  })
})
