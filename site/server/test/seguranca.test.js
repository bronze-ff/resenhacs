// Regressões da revisão de segurança (2026-10). Cada bloco cobre uma correção.
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { bancoTransacional } from './bancoTransacional.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos' }
const token = (steamId, isSuperAdmin = false) => `resenha_token=${signToken({ steamId, isSuperAdmin }, config.jwtSecret)}`

function appWith(handlers, extra = {}) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      for (const [needle, rows] of handlers) if (sql.includes(needle)) return Promise.resolve({ rows, rowCount: rows.length })
      return Promise.resolve({ rows: [], rowCount: 0 })
    }),
  }
  return { app: createApp({ config, db: bancoTransacional(db.query).db, r2Client: { send: vi.fn() }, ...extra }), db }
}

describe('cabeçalhos', () => {
  it('não anuncia X-Powered-By', async () => {
    const { app } = appWith([])
    const res = await request(app).get('/api/health')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})

describe('GET /api/clipes', () => {
  it('?periodo=constructor não quebra (chave herdada do prototype) e tem limite', async () => {
    const { app, db } = appWith([])
    const res = await request(app).get('/api/clipes?periodo=constructor').set('Cookie', token('765'))
    expect(res.status).toBe(200)
    const sql = db.query.mock.calls.find(([s]) => s.includes('from allstar_clips ac'))[0]
    expect(sql).not.toContain('function')
    expect(sql).toContain('limit 200')
  })
})

describe('competições', () => {
  const COMP = '11111111-1111-4111-8111-111111111111'

  it('tradelink fora do formato da Steam é recusado', async () => {
    const { app, db } = appWith([
      ['from competicoes where id', [{ id: COMP, data_fim: '2020-01-01', vencedor_steam_id64: '765', vencedor_confirmado_em: '2020-01-02' }]],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP}/tradelink`).set('Cookie', token('765'))
      .send({ tradelink: 'javascript:alert(1)' })
    expect(res.status).toBe(400)
    expect(db.query.mock.calls.some(([s]) => s.includes('update competicoes set tradelink_vencedor'))).toBe(false)
  })

  it('admin rebaixado (JWT ainda diz admin, banco não) não vê tradelink', async () => {
    const { app } = appWith([
      ['is_super_admin from players', [{ is_super_admin: false }]],
      ['from competicoes', [{ id: COMP, data_inicio: '2026-07-01', data_fim: '2026-07-05', vencedor_steam_id64: '999', tradelink_vencedor: 'https://steamcommunity.com/tradeoffer/new/?partner=1&token=a', limite_diario: 2, limite_total: 10, minimo_para_rankear: 1 }]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', token('765', true))
    expect(res.body.encerradas[0].tradelinkVencedor).toBeUndefined()
  })
})

describe('POST /api/upload/upload-url', () => {
  it('com 5 uploads pendentes, o 6º pedido recebe 429 sem gerar URL', async () => {
    const send = vi.fn()
    const { app } = appWith([['from uploads_pendentes', [{ n: 5 }]]], { r2Client: { send } })
    const res = await request(app).post('/api/upload/upload-url').set('Cookie', token('765'))
      .send({ filename: 'x.dem', tamanho: 1000 })
    expect(res.status).toBe(429)
  })
})

describe('GET /api/matches/:id/demo', () => {
  it('serve como anexo octet-stream com o nome real do objeto (.dem.bz2)', async () => {
    const { Readable } = await import('node:stream')
    const send = vi.fn().mockResolvedValue({ ContentType: 'text/html', Body: Readable.from([Buffer.from('BZh')]) })
    const { app } = appWith(
      [['select demo_url from matches', [{ demo_url: 'https://pub.r2.dev/resenha-demos/demos/m1.dem.bz2' }]]],
      { r2Client: { send } },
    )
    const res = await request(app).get('/api/matches/00000000-0000-4000-8000-000000000001/demo').set('Cookie', token('765'))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/octet-stream')
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="?m1.dem.bz2"?$/)
  })
})
