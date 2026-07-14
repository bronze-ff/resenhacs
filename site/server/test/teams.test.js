import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '111' }, config.jwtSecret)}`
const GRUPO = '11111111-1111-1111-1111-111111111111'

// handlers: [needle, rows, rowCount?] — rowCount só é preciso pros testes de
// DELETE (o handler lê rowCount pra decidir 404 vs 200).
function appWith(handlers, connectHandlers = handlers) {
  const query = vi.fn().mockImplementation((sql) => {
    for (const [needle, rows, rowCount] of [...handlers, ['group_members where group_id = $1 and steam_id64', [{}]]]) {
      if (sql.includes(needle)) return Promise.resolve({ rows, rowCount: rowCount ?? rows.length })
    }
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
  const clientQuery = vi.fn().mockImplementation((sql) => {
    for (const [needle, rows] of [...connectHandlers, ['group_members where group_id = $1 and steam_id64', [{}]]]) {
      if (sql.includes(needle)) return Promise.resolve({ rows })
    }
    return Promise.resolve({ rows: [] })
  })
  const client = { query: clientQuery, release: vi.fn() }
  const db = { query, connect: vi.fn().mockResolvedValue(client) }
  return { app: createApp({ config, db }), db, client }
}

describe('POST /api/teams', () => {
  it('nao-admin do grupo: 403', async () => {
    const { app } = appWith([['role from group_members', [{ role: 'membro' }]]])
    const res = await request(app).post('/api/teams').set('Cookie', cookie).set('X-Group-Id', GRUPO)
      .send({ nome: 'Titulares', membros: ['76561198000000001'] })
    expect(res.status).toBe(403)
  })

  it('admin: cria time com membros', async () => {
    const { app } = appWith([
      ['role from group_members', [{ role: 'admin' }]],
      ['insert into teams', [{ id: 't1', nome: 'Titulares', publico: false }]],
    ])
    const res = await request(app).post('/api/teams').set('Cookie', cookie).set('X-Group-Id', GRUPO)
      .send({ nome: 'Titulares', membros: ['76561198000000001', '76561198000000002'] })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: 't1', nome: 'Titulares', publico: false })
  })

  it('sem membros validos: 400', async () => {
    const { app } = appWith([['role from group_members', [{ role: 'admin' }]]])
    const res = await request(app).post('/api/teams').set('Cookie', cookie).set('X-Group-Id', GRUPO)
      .send({ nome: 'Titulares', membros: [] })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/teams', () => {
  it('lista times do grupo ativo com membros', async () => {
    const { app } = appWith([
      ['from teams t', [{ id: 't1', nome: 'Titulares', publico: true, membros: [{ steamId: '1', nick: 'a', avatarUrl: null }] }]],
    ])
    const res = await request(app).get('/api/teams').set('Cookie', cookie).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 't1', nome: 'Titulares', publico: true, membros: [{ steamId: '1', nick: 'a', avatarUrl: null }] }])
  })
})

describe('PATCH /api/teams/:id', () => {
  it('nao-admin: 403', async () => {
    const { app } = appWith([['role from group_members', [{ role: 'membro' }]]])
    const res = await request(app).patch('/api/teams/t1').set('Cookie', cookie).set('X-Group-Id', GRUPO).send({ publico: true })
    expect(res.status).toBe(403)
  })

  it('admin: torna publico', async () => {
    const { app, db } = appWith([
      ['role from group_members', [{ role: 'admin' }]],
      ['id from teams', [{ id: 't1' }]],
    ])
    const res = await request(app).patch('/api/teams/t1').set('Cookie', cookie).set('X-Group-Id', GRUPO).send({ publico: true })
    expect(res.status).toBe(200)
    expect(db.query.mock.calls.some((c) => c[0].includes('update teams set') && c[0].includes('publico'))).toBe(true)
  })
})

describe('DELETE /api/teams/:id', () => {
  it('nao-admin: 403', async () => {
    const { app } = appWith([['role from group_members', [{ role: 'membro' }]]])
    const res = await request(app).delete('/api/teams/t1').set('Cookie', cookie).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(403)
  })

  it('admin: apaga', async () => {
    const { app } = appWith([
      ['role from group_members', [{ role: 'admin' }]],
      ['delete from teams', [], 1],
    ])
    const res = await request(app).delete('/api/teams/t1').set('Cookie', cookie).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(200)
  })

  it('id inexistente: 404', async () => {
    const { app } = appWith([
      ['role from group_members', [{ role: 'admin' }]],
      ['delete from teams', [], 0],
    ])
    const res = await request(app).delete('/api/teams/tx').set('Cookie', cookie).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(404)
  })
})

describe('GET /api/teams/compare', () => {
  it('time nao publico e fora do meu grupo: 403', async () => {
    const { app } = appWith([
      ['from teams t join groups', [{ id: 'ta', group_id: 'g-outro', publico: false, grupo_nome: 'Outro' }]],
      ['select 1 from group_members where group_id = $1 and steam_id64 = $2', []],
    ])
    const res = await request(app).get('/api/teams/compare?a=ta&b=tb').set('Cookie', cookie)
    expect(res.status).toBe(403)
  })

  it('dois times publicos: compara e monta confronto', async () => {
    const { app } = appWith([
      ['from teams t join groups', [{ id: 'ta', nome: 'A', group_id: 'g1', publico: true, grupo_nome: 'Grupo A' }]],
      ['from grupos', [{ partidas: 5, vitorias: 3, rating: '1.1', kills: 300, deaths: 250 }]],
      ['lado_a la join lado_b', [{ a_venceu: true }, { a_venceu: false }]],
    ])
    const res = await request(app).get('/api/teams/compare?a=ta&b=tb').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.confronto).toEqual({ partidasJuntos: 2, aVenceu: 1, bVenceu: 1 })
  })
})
