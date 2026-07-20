import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookieA = `resenha_token=${signToken({ steamId: '111' }, config.jwtSecret)}`
const cookieB = `resenha_token=${signToken({ steamId: '222' }, config.jwtSecret)}`

function appWith(handlers, connectHandlers = handlers) {
  const query = vi.fn().mockImplementation((sql) => {
    for (const [needle, rows] of handlers) {
      if (sql.includes(needle)) return Promise.resolve({ rows })
    }
    return Promise.resolve({ rows: [] })
  })
  const clientQuery = vi.fn().mockImplementation((sql) => {
    for (const [needle, rows] of connectHandlers) {
      if (sql.includes(needle)) return Promise.resolve({ rows })
    }
    return Promise.resolve({ rows: [] })
  })
  const client = { query: clientQuery, release: vi.fn() }
  const db = { query, connect: vi.fn().mockResolvedValue(client) }
  return { app: createApp({ config, db }), db, client }
}

describe('POST /api/groups', () => {
  it('cria grupo, vira admin e grupo ativo', async () => {
    const { app, client } = appWith([
      ['insert into groups', [{ id: 'g1', nome: 'Time A' }]],
    ])
    const res = await request(app).post('/api/groups').set('Cookie', cookieA).send({ nome: 'Time A' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 'g1', nome: 'Time A' })
    expect(client.query.mock.calls.some((c) => c[0].includes('insert into group_members'))).toBe(true)
    expect(client.query.mock.calls.some((c) => c[0].includes('update players set grupo_ativo_id'))).toBe(true)
  })

  it('sem nome: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/groups').set('Cookie', cookieA).send({ nome: '  ' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/groups/meus', () => {
  it('lista grupos do jogador logado', async () => {
    const { app } = appWith([['from group_members', [{ id: 'g1', nome: 'Time A', role: 'admin' }]]])
    const res = await request(app).get('/api/groups/meus').set('Cookie', cookieA)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 'g1', nome: 'Time A', role: 'admin' }])
  })
})

describe('PUT /api/groups/ativo', () => {
  it('nao-membro: 403', async () => {
    const { app } = appWith([['select 1 from group_members', []]])
    const res = await request(app).put('/api/groups/ativo').set('Cookie', cookieA).send({ groupId: 'g1' })
    expect(res.status).toBe(403)
  })

  it('membro: atualiza grupo ativo', async () => {
    const { app, db } = appWith([['select 1 from group_members', [{}]]])
    const res = await request(app).put('/api/groups/ativo').set('Cookie', cookieA).send({ groupId: 'g1' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, groupId: 'g1' })
    expect(db.query.mock.calls.some((c) => c[0].includes('update players set grupo_ativo_id'))).toBe(true)
  })
})

describe('POST /api/groups/:id/convites', () => {
  it('nao-admin do grupo: 403', async () => {
    const { app } = appWith([['role from group_members', [{ role: 'membro' }]]])
    const res = await request(app).post('/api/groups/g1/convites').set('Cookie', cookieA)
    expect(res.status).toBe(403)
  })

  it('admin do grupo gera convite', async () => {
    const { app } = appWith([
      ['role from group_members', [{ role: 'admin' }]],
      ['insert into group_invites', [{ token: 'tok1' }]],
    ])
    const res = await request(app).post('/api/groups/g1/convites').set('Cookie', cookieA)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ token: 'tok1' })
  })
})

describe('PUT /api/groups/:id/discord-webhook', () => {
  it('não-admin: 403', async () => {
    const { app } = appWith([
      ['select role from group_members', [{ role: 'membro' }]],
    ])
    const res = await request(app)
      .put('/api/groups/g1/discord-webhook')
      .set('Cookie', cookieA)
      .send({ url: 'https://discord.com/api/webhooks/1/abc' })
    expect(res.status).toBe(403)
  })

  it('URL inválida: 400', async () => {
    const { app } = appWith([
      ['select role from group_members', [{ role: 'admin' }]],
    ])
    const res = await request(app)
      .put('/api/groups/g1/discord-webhook')
      .set('Cookie', cookieA)
      .send({ url: 'https://evil.com/not-discord' })
    expect(res.status).toBe(400)
  })

  it('admin com URL válida: salva e devolve ok', async () => {
    const { app, db } = appWith([
      ['select role from group_members', [{ role: 'admin' }]],
      ['update groups set discord_webhook_url', []],
    ])
    const res = await request(app)
      .put('/api/groups/g1/discord-webhook')
      .set('Cookie', cookieA)
      .send({ url: 'https://discord.com/api/webhooks/123/abcDEF' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    const update = db.query.mock.calls.find((c) => c[0].includes('update groups set discord_webhook_url'))
    expect(update[1]).toEqual(['https://discord.com/api/webhooks/123/abcDEF', 'g1'])
  })

  it('admin com url null: remove o webhook', async () => {
    const { app, db } = appWith([
      ['select role from group_members', [{ role: 'admin' }]],
      ['update groups set discord_webhook_url', []],
    ])
    const res = await request(app)
      .put('/api/groups/g1/discord-webhook')
      .set('Cookie', cookieA)
      .send({ url: null })
    expect(res.status).toBe(200)
    const update = db.query.mock.calls.find((c) => c[0].includes('update groups set discord_webhook_url'))
    expect(update[1]).toEqual([null, 'g1'])
  })
})

describe('GET /api/convites/:token', () => {
  it('convite inexistente: 404', async () => {
    const { app } = appWith([])
    const res = await request(app).get('/api/convites/tokX').set('Cookie', cookieB)
    expect(res.status).toBe(404)
  })

  it('convite revogado: 410', async () => {
    const { app } = appWith([
      ['from group_invites', [{ revogado_em: '2026-01-01', nome: 'Time A' }]],
    ])
    const res = await request(app).get('/api/convites/tok1').set('Cookie', cookieB)
    expect(res.status).toBe(410)
  })

  it('convite válido: devolve o nome do grupo', async () => {
    const { app } = appWith([
      ['from group_invites', [{ revogado_em: null, nome: 'Time A' }]],
    ])
    const res = await request(app).get('/api/convites/tok1').set('Cookie', cookieB)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ grupoNome: 'Time A' })
  })
})

describe('POST /api/convites/:token/aceitar', () => {
  it('convite revogado: 410', async () => {
    const { app } = appWith([
      ['from group_invites', [{ group_id: 'g1', revogado_em: '2026-01-01', nome: 'Time A' }]],
    ])
    const res = await request(app).post('/api/convites/tok1/aceitar').set('Cookie', cookieB)
    expect(res.status).toBe(410)
  })

  it('aceita e vira grupo ativo', async () => {
    const { app, db } = appWith([
      ['from group_invites', [{ group_id: 'g1', revogado_em: null, nome: 'Time A' }]],
    ])
    const res = await request(app).post('/api/convites/tok1/aceitar').set('Cookie', cookieB)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, groupId: 'g1', nome: 'Time A' })
    expect(db.query.mock.calls.some((c) => c[0].includes('insert into group_members'))).toBe(true)
    expect(db.query.mock.calls.some((c) => c[0].includes('update players set grupo_ativo_id'))).toBe(true)
    // Retroage as partidas antigas do novo membro no grupo (is_tracked = true), escopado
    // por group_id + steam_id64 — sem isso ele só apareceria no próprio perfil.
    const retro = db.query.mock.calls.find((c) => c[0].includes('update match_players mp set is_tracked = true'))
    expect(retro).toBeTruthy()
    expect(retro[1]).toEqual(['g1', '222'])
  })
})
