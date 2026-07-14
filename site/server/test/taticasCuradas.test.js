import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookieJogador = `resenha_token=${signToken({ steamId: '765', isAdmin: false }, config.jwtSecret)}`
const cookieAdmin = `resenha_token=${signToken({ steamId: '999', isAdmin: true }, config.jwtSecret)}`

function appWith(handlers) {
  const query = vi.fn().mockImplementation((sql) => {
    for (const [needle, rows] of handlers) {
      if (sql.includes(needle)) return Promise.resolve({ rows })
    }
    return Promise.resolve({ rows: [] })
  })
  // POST/PUT de taticas-curadas abrem transação num client dedicado (db.connect()),
  // não em db.query() direto — o mock do client reusa a mesma vi.fn() pra que as
  // asserções continuem enxergando begin/commit/insert* numa lista só de calls.
  const client = { query, release: vi.fn() }
  const db = { query, connect: vi.fn().mockResolvedValue(client) }
  return { app: createApp({ config, db, r2Client: null }), db, client }
}

const TATICA = {
  id: 't1', map: 'de_mirage', lado: 'T', tipo: 'execute', local: 'A', armas: 'full',
  titulo: 'Padrão A rush', descricao: 'entrada rápida', criado_por: '999',
  criado_em: '2026-07-13T00:00:00Z',
}
const PAPEL = { id: 'p1', tatica_id: 't1', ordem: 1, descricao: 'Lurker mid', obrigatorio: true }
const GRANADA_ROW = {
  papel_id: 'p1', ordem: 0, id: 'g1', map: 'de_mirage', lado: 'T', tipo: 'smoke',
  titulo: 'Smoke janela', descricao: 'da base', video_url: 'https://youtu.be/abcdefghijk',
  tecnica: 'jumpthrow', botao: 'esquerdo', passos: ['mire no pixel'], arremesso_x: '0.2',
  arremesso_y: '0.8', alvo_x: '0.4', alvo_y: '0.3', criado_por: '999',
  criado_em: '2026-07-13T00:00:00Z',
}

const PAYLOAD_VALIDO = {
  map: 'de_mirage', lado: 'T', tipo: 'execute', local: 'A', armas: 'full',
  titulo: 'Padrão A rush', descricao: 'entrada rápida',
  papeis: [{ ordem: 1, descricao: 'Lurker mid', obrigatorio: true, granadaIds: ['g1'] }],
}

describe('GET /api/taticas-curadas', () => {
  it('anonimo: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/taticas-curadas')).status).toBe(401)
  })

  it('logado lista taticas com papeis e granadas aninhados (3 queries)', async () => {
    const { app, db } = appWith([
      ['from taticas_curadas', [TATICA]],
      ['from taticas_papeis', [PAPEL]],
      ['from taticas_papel_granadas', [GRANADA_ROW]],
    ])
    const res = await request(app)
      .get('/api/taticas-curadas?map=de_mirage&lado=T')
      .set('Cookie', cookieJogador)

    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({
      id: 't1', map: 'de_mirage', lado: 'T', tipo: 'execute', local: 'A', armas: 'full',
      titulo: 'Padrão A rush',
    })
    expect(res.body[0].papeis[0]).toMatchObject({
      id: 'p1', ordem: 1, descricao: 'Lurker mid', obrigatorio: true,
    })
    expect(res.body[0].papeis[0].granadas[0]).toMatchObject({
      id: 'g1', ordem: 0, videoUrl: 'https://youtu.be/abcdefghijk', arremessoX: 0.2, alvoY: 0.3,
    })
    expect(db.query.mock.calls).toHaveLength(3)
    expect(db.query.mock.calls[0][1]).toEqual(['de_mirage', 'T'])
  })

  it('filtro invalido e ignorado (nao vira SQL)', async () => {
    const { app, db } = appWith([['from taticas_curadas', []]])
    await request(app)
      .get("/api/taticas-curadas?map=x';drop&lado=Z&tipo=nuke&local=C&armas=x")
      .set('Cookie', cookieJogador)
    expect(db.query.mock.calls[0][1]).toEqual([])
  })
})

describe('GET /api/taticas-curadas/contagem', () => {
  it('agrupa por mapa', async () => {
    const { app } = appWith([['group by map', [{ map: 'de_mirage', total: '2' }]]])
    const res = await request(app).get('/api/taticas-curadas/contagem').set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body[0]).toEqual({ map: 'de_mirage', total: 2 })
  })
})

describe('POST /api/taticas-curadas', () => {
  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    expect(
      (await request(app).post('/api/taticas-curadas').set('Cookie', cookieJogador).send(PAYLOAD_VALIDO)).status,
    ).toBe(403)
  })

  it('tipo invalido: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/taticas-curadas')
      .set('Cookie', cookieAdmin)
      .send({ ...PAYLOAD_VALIDO, tipo: 'invasao' })
    expect(res.status).toBe(400)
  })

  it('admin cria tatica com papeis usando transacao (begin/commit)', async () => {
    const { app, db } = appWith([
      ['insert into taticas_curadas', [{ id: 't1' }]],
      ['insert into taticas_papeis', [{ id: 'p1' }]],
    ])
    const res = await request(app).post('/api/taticas-curadas').set('Cookie', cookieAdmin).send(PAYLOAD_VALIDO)
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('t1')
    const sqls = db.query.mock.calls.map((c) => c[0])
    expect(sqls).toContain('begin')
    expect(sqls).toContain('commit')
    expect(sqls.some((s) => s.includes('insert into taticas_papel_granadas'))).toBe(true)
  })
})

const UUID_T1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const UUID_TX = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

describe('PUT /api/taticas-curadas/:id', () => {
  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    expect(
      (await request(app).put(`/api/taticas-curadas/${UUID_T1}`).set('Cookie', cookieJogador).send(PAYLOAD_VALIDO)).status,
    ).toBe(403)
  })

  it('id inexistente: 404 (com rollback)', async () => {
    const { app, db } = appWith([['update taticas_curadas', []]])
    const res = await request(app).put(`/api/taticas-curadas/${UUID_TX}`).set('Cookie', cookieAdmin).send(PAYLOAD_VALIDO)
    expect(res.status).toBe(404)
    const sqls = db.query.mock.calls.map((c) => c[0])
    expect(sqls).toContain('rollback')
  })

  it('admin substitui tatica e papeis', async () => {
    const { app, db } = appWith([
      ['update taticas_curadas', [{ id: UUID_T1 }]],
      ['insert into taticas_papeis', [{ id: 'p2' }]],
    ])
    const res = await request(app).put(`/api/taticas-curadas/${UUID_T1}`).set('Cookie', cookieAdmin).send(PAYLOAD_VALIDO)
    expect(res.status).toBe(200)
    const sqls = db.query.mock.calls.map((c) => c[0])
    expect(sqls.some((s) => s.includes('delete from taticas_papeis'))).toBe(true)
    expect(sqls).toContain('commit')
  })

  it('id nao-uuid: 404 sem tocar no db', async () => {
    const { app, db } = appWith([])
    const res = await request(app).put('/api/taticas-curadas/abc').set('Cookie', cookieAdmin).send(PAYLOAD_VALIDO)
    expect(res.status).toBe(404)
    expect(db.query).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/taticas-curadas/:id', () => {
  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    expect((await request(app).delete(`/api/taticas-curadas/${UUID_T1}`).set('Cookie', cookieJogador)).status).toBe(403)
  })

  it('admin apaga', async () => {
    const { app, db } = appWith([['delete from taticas_curadas', [{ id: UUID_T1 }]]])
    const res = await request(app).delete(`/api/taticas-curadas/${UUID_T1}`).set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    expect(db.query.mock.calls[0][1]).toEqual([UUID_T1])
  })

  it('id inexistente: 404', async () => {
    const { app } = appWith([['delete from taticas_curadas', []]])
    const res = await request(app).delete(`/api/taticas-curadas/${UUID_TX}`).set('Cookie', cookieAdmin)
    expect(res.status).toBe(404)
  })

  it('id nao-uuid: 404 sem tocar no db', async () => {
    const { app, db } = appWith([])
    const res = await request(app).delete('/api/taticas-curadas/abc').set('Cookie', cookieAdmin)
    expect(res.status).toBe(404)
    expect(db.query).not.toHaveBeenCalled()
  })
})
