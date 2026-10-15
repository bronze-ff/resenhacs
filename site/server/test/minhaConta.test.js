import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const EU = '76561198000000009'
const cookie = `resenha_token=${signToken({ steamId: EU, isSuperAdmin: false }, config.jwtSecret)}`

function appWith(rows = []) {
  const cliente = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      if (sql.includes('tokens_validos_apos')) return Promise.resolve({ rows: [{ tokens_validos_apos: null }] })
      return Promise.resolve({ rows })
    }),
    connect: vi.fn().mockResolvedValue(cliente),
  }
  return { app: createApp({ config, db }), db, cliente }
}

describe('GET /api/minha-conta/exportar', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    expect((await request(app).get('/api/minha-conta/exportar')).status).toBe(401)
  })

  it('baixa um JSON só com os dados do próprio jogador, sem o código de histórico em claro', async () => {
    const { app, db } = appWith()
    const res = await request(app).get('/api/minha-conta/exportar').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.body).toHaveProperty('partidas')
    const sqls = db.query.mock.calls.filter(([s]) => !s.includes('tokens_validos_apos'))
    for (const [sql, params] of sqls) expect(params).toEqual([EU])
    const sqlJogador = sqls.find(([s]) => s.includes('from players'))[0]
    expect(sqlJogador).toContain('match_auth_code is not null as codigo_historico_configurado')
  })
})

describe('DELETE /api/minha-conta', () => {
  it('exige a confirmação EXCLUIR', async () => {
    const { app, cliente } = appWith()
    const res = await request(app).delete('/api/minha-conta').set('Cookie', cookie).send({})
    expect(res.status).toBe(400)
    expect(cliente.query).not.toHaveBeenCalled()
  })

  it('anonimiza numa transação, só o próprio jogador, e derruba a sessão', async () => {
    const { app, cliente } = appWith()
    const res = await request(app).delete('/api/minha-conta').set('Cookie', cookie).send({ confirmacao: 'EXCLUIR' })
    expect(res.status).toBe(200)
    const sqls = cliente.query.mock.calls.map(([s]) => s)
    expect(sqls[0]).toBe('begin')
    expect(sqls.at(-1)).toBe('commit')
    expect(sqls.some((s) => s.includes('delete from friendships'))).toBe(true)
    // envios em QUALQUER status, não só 'pendente'
    const uploads = sqls.find((s) => s.includes('delete from uploads_pendentes'))
    expect(uploads).not.toContain('status')
    expect(sqls.some((s) => s.includes('update players set') && s.includes('tokens_validos_apos = now()'))).toBe(true)
    for (const [sql, params] of cliente.query.mock.calls) if (params) expect(params[0]).toBe(EU)
    expect(cliente.release).toHaveBeenCalled()
    expect(res.headers['set-cookie'].join(';')).toContain('resenha_token=;')
  })

  it('erro no meio desfaz tudo (rollback)', async () => {
    const { app, cliente } = appWith()
    cliente.query.mockImplementation((sql) => (sql.includes('delete from curso_progresso') ? Promise.reject(new Error('x')) : Promise.resolve({ rows: [] })))
    const res = await request(app).delete('/api/minha-conta').set('Cookie', cookie).send({ confirmacao: 'EXCLUIR' })
    expect(res.status).toBe(500)
    expect(cliente.query.mock.calls.map(([s]) => s)).toContain('rollback')
    expect(cliente.release).toHaveBeenCalled()
  })
})
