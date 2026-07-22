import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookieJogador = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`
const cookieAdmin = `resenha_token=${signToken({ steamId: '999', isSuperAdmin: true }, config.jwtSecret)}`

function appWith(handlers) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      if (sql.includes('is_super_admin from players')) return Promise.resolve({ rows: [{ is_super_admin: true }] })
      for (const [needle, rows] of handlers) if (sql.includes(needle)) return Promise.resolve({ rows })
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/competicoes', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/competicoes')).status).toBe(401)
  })

  it('sem competicao nenhuma: ativa null, encerradas vazio', async () => {
    const { app } = appWith([])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ativa: null, encerradas: [] })
  })

  it('devolve a competicao ativa (data_inicio <= now <= data_fim)', async () => {
    const agora = new Date()
    const { app } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: 'Skin',
        data_inicio: new Date(agora.getTime() - 86400000), data_fim: new Date(agora.getTime() + 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 3, vencedor_steam_id64: null,
      }]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body.ativa.id).toBe('comp1')
  })
})

describe('POST /api/competicoes/admin', () => {
  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieJogador)
      .send({ nome: 'X', dataInicio: '2026-08-01', dataFim: '2026-08-08' })
    expect(res.status).toBe(403)
  })

  it('admin: cria competicao', async () => {
    const { app, db } = appWith([['insert into competicoes', [{ id: 'comp-nova' }]]])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieAdmin).send({
      nome: 'Semana 1', descricao: 'desc', premioDescricao: 'Skin AK',
      dataInicio: '2026-08-01T00:00:00Z', dataFim: '2026-08-08T00:00:00Z',
      limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 3,
    })
    expect(res.status).toBe(201)
    const insert = db.query.mock.calls.find(([sql]) => sql.includes('insert into competicoes'))
    expect(insert).toBeTruthy()
  })

  it('data_fim antes de data_inicio: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieAdmin).send({
      nome: 'X', dataInicio: '2026-08-08T00:00:00Z', dataFim: '2026-08-01T00:00:00Z',
    })
    expect(res.status).toBe(400)
  })
})
