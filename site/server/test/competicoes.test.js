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

  it('limiteDiario negativo: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieAdmin).send({
      nome: 'X', dataInicio: '2026-08-01T00:00:00Z', dataFim: '2026-08-08T00:00:00Z', limiteDiario: -1,
    })
    expect(res.status).toBe(400)
  })

  it('limiteTotal fracionario: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieAdmin).send({
      nome: 'X', dataInicio: '2026-08-01T00:00:00Z', dataFim: '2026-08-08T00:00:00Z', limiteTotal: 2.5,
    })
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/competicoes/admin/:id', () => {
  const COMP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    const res = await request(app).put(`/api/competicoes/admin/${COMP_ID}`).set('Cookie', cookieJogador).send({ nome: 'Y' })
    expect(res.status).toBe(403)
  })

  it('id nao-uuid: 404', async () => {
    const { app } = appWith([])
    const res = await request(app).put('/api/competicoes/admin/abc').set('Cookie', cookieAdmin).send({ nome: 'Y' })
    expect(res.status).toBe(404)
  })

  it('limiteTotal negativo: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).put(`/api/competicoes/admin/${COMP_ID}`).set('Cookie', cookieAdmin).send({ limiteTotal: -5 })
    expect(res.status).toBe(400)
  })

  it('so dataFim, movendo pra antes do data_inicio ja gravado: 400 (nao 500)', async () => {
    const { app, db } = appWith([
      ['data_inicio, data_fim from competicoes where id', [
        { data_inicio: '2026-08-01T00:00:00Z', data_fim: '2026-08-08T00:00:00Z' },
      ]],
    ])
    const res = await request(app).put(`/api/competicoes/admin/${COMP_ID}`).set('Cookie', cookieAdmin)
      .send({ dataFim: '2026-07-31T00:00:00Z' })
    expect(res.status).toBe(400)
    const update = db.query.mock.calls.find(([sql]) => sql.includes('update competicoes set'))
    expect(update).toBeFalsy()
  })

  it('so dataInicio, movendo pra depois do data_fim ja gravado: 400 (nao 500)', async () => {
    const { app } = appWith([
      ['data_inicio, data_fim from competicoes where id', [
        { data_inicio: '2026-08-01T00:00:00Z', data_fim: '2026-08-08T00:00:00Z' },
      ]],
    ])
    const res = await request(app).put(`/api/competicoes/admin/${COMP_ID}`).set('Cookie', cookieAdmin)
      .send({ dataInicio: '2026-08-09T00:00:00Z' })
    expect(res.status).toBe(400)
  })

  it('so dataFim, dentro do periodo ja gravado: atualiza com sucesso', async () => {
    const { app } = appWith([
      ['data_inicio, data_fim from competicoes where id', [
        { data_inicio: '2026-08-01T00:00:00Z', data_fim: '2026-08-08T00:00:00Z' },
      ]],
      ['update competicoes set', [{ id: COMP_ID }]],
    ])
    const res = await request(app).put(`/api/competicoes/admin/${COMP_ID}`).set('Cookie', cookieAdmin)
      .send({ dataFim: '2026-08-10T00:00:00Z' })
    expect(res.status).toBe(200)
  })

  it('id nao encontrado ao validar so uma data: 404', async () => {
    const { app } = appWith([
      ['data_inicio, data_fim from competicoes where id', []],
    ])
    const res = await request(app).put(`/api/competicoes/admin/${COMP_ID}`).set('Cookie', cookieAdmin)
      .send({ dataFim: '2026-08-10T00:00:00Z' })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/competicoes/:id/elegiveis', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/competicoes/comp1/elegiveis')).status).toBe(401)
  })

  it('id nao-uuid: 404', async () => {
    const { app } = appWith([])
    const res = await request(app).get('/api/competicoes/abc/elegiveis').set('Cookie', cookieJogador)
    expect(res.status).toBe(404)
  })

  it('lista so os clipes PROPRIOS, Processed, com partida dentro do periodo', async () => {
    const { app, db } = appWith([
      ['from competicoes where id', [{ id: 'comp1', data_inicio: '2026-07-23T00:00:00Z', data_fim: '2026-07-30T00:00:00Z' }]],
      ['from allstar_clips ac', [
        { id: 'clip1', match_id: 'm1', round_number: 9, map: 'de_dust2', pontuacao_total: 100, ja_enviado: false },
      ]],
    ])
    const res = await request(app).get(`/api/competicoes/${'a'.repeat(8)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(12)}/elegiveis`).set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body[0].allstarClipId).toBe('clip1')
    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes('from allstar_clips ac'))
    expect(params).toContain('765') // steamId do cookie, nunca outro
  })
})

describe('POST /api/competicoes/:id/submissoes', () => {
  const COMP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const CLIP_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).post(`/api/competicoes/${COMP_ID}/submissoes`)).status).toBe(401)
  })

  it('clipe nao existe ou nao e do proprio jogador: 404', async () => {
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_inicio: '2026-07-01', data_fim: '2026-08-01', limite_diario: 2, limite_total: 10 }]],
      ['from allstar_clips ac', []], // clipe nao encontrado (ou de outro steamId — mesma query já filtra)
    ])
    const res = await request(app).post(`/api/competicoes/${COMP_ID}/submissoes`).set('Cookie', cookieJogador).send({ allstarClipId: CLIP_ID })
    expect(res.status).toBe(404)
  })

  it('clipe valido dentro do periodo e dos limites: envia com sucesso', async () => {
    const gravados = []
    const db = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (sql.includes('from competicoes where id')) {
          return Promise.resolve({ rows: [{ id: COMP_ID, data_inicio: '2026-07-01', data_fim: '2026-08-01', limite_diario: 2, limite_total: 10 }] })
        }
        if (sql.includes('from allstar_clips ac')) {
          return Promise.resolve({ rows: [{ id: CLIP_ID, steam_id64: '765', status: 'Processed', played_at: '2026-07-22T10:00:00Z' }] })
        }
        if (sql.includes('count(*) filter')) return Promise.resolve({ rows: [{ hoje: 0, total: 0 }] })
        if (sql.includes('insert into competicao_submissoes')) { gravados.push(params); return Promise.resolve({ rows: [] }) }
        return Promise.resolve({ rows: [] })
      }),
    }
    const app = createApp({ config, db })
    const res = await request(app).post(`/api/competicoes/${COMP_ID}/submissoes`).set('Cookie', cookieJogador).send({ allstarClipId: CLIP_ID })
    expect(res.status).toBe(200)
    expect(gravados).toHaveLength(1)
  })

  it('limite diario ja atingido: 400', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('from competicoes where id')) {
          return Promise.resolve({ rows: [{ id: COMP_ID, data_inicio: '2026-07-01', data_fim: '2026-08-01', limite_diario: 2, limite_total: 10 }] })
        }
        if (sql.includes('from allstar_clips ac')) {
          return Promise.resolve({ rows: [{ id: CLIP_ID, steam_id64: '765', status: 'Processed', played_at: '2026-07-22T10:00:00Z' }] })
        }
        if (sql.includes('count(*) filter')) return Promise.resolve({ rows: [{ hoje: 2, total: 5 }] })
        return Promise.resolve({ rows: [] })
      }),
    }
    const app = createApp({ config, db })
    const res = await request(app).post(`/api/competicoes/${COMP_ID}/submissoes`).set('Cookie', cookieJogador).send({ allstarClipId: CLIP_ID })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/limite di[áa]rio/i)
  })

  it('partida fora do periodo da competicao: 400', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('from competicoes where id')) {
          return Promise.resolve({ rows: [{ id: COMP_ID, data_inicio: '2026-07-23', data_fim: '2026-07-30', limite_diario: 2, limite_total: 10 }] })
        }
        if (sql.includes('from allstar_clips ac')) {
          return Promise.resolve({ rows: [{ id: CLIP_ID, steam_id64: '765', status: 'Processed', played_at: '2026-07-01T10:00:00Z' }] })
        }
        return Promise.resolve({ rows: [] })
      }),
    }
    const app = createApp({ config, db })
    const res = await request(app).post(`/api/competicoes/${COMP_ID}/submissoes`).set('Cookie', cookieJogador).send({ allstarClipId: CLIP_ID })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/per[íi]odo/i)
  })
})

describe('leaderboard isolado por competicao', () => {
  it('soma de uma competicao nunca inclui submissao de outra', async () => {
    const { app, db } = appWith([
      ['from competicoes', [
        { id: 'compA', nome: 'A', data_inicio: '2026-07-01', data_fim: '2026-07-10', limite_diario: 2, limite_total: 10, minimo_para_rankear: 1, vencedor_steam_id64: null },
        { id: 'compB', nome: 'B', data_inicio: '2026-07-11', data_fim: '2026-07-20', limite_diario: 2, limite_total: 10, minimo_para_rankear: 1, vencedor_steam_id64: null },
      ]],
      ['from competicao_submissoes cs join', [
        { competicao_id: 'compA', steam_id64: '765', nick: 'bronze', avatar_url: null, total: 100, qtd: 1 },
      ]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    // A query de leaderboard precisa ter sido chamada com o competicao_id certo por vez —
    // cada competição tem sua própria query/filtro, nunca uma soma cruzada.
    const chamadasLeaderboard = db.query.mock.calls.filter(([sql]) => sql.includes('from competicao_submissoes cs join'))
    expect(chamadasLeaderboard.length).toBeGreaterThanOrEqual(2)
  })

  it('quem nao bate o minimo aparece separado, nao no ranking principal', async () => {
    const { app } = appWith([
      ['from competicoes', [{ id: 'comp1', nome: 'X', data_inicio: '2026-07-01', data_fim: '2026-07-10', limite_diario: 2, limite_total: 10, minimo_para_rankear: 3, vencedor_steam_id64: null }]],
      ['from competicao_submissoes cs join', [
        { competicao_id: 'comp1', steam_id64: '765', nick: 'bronze', avatar_url: null, total: 50, qtd: 1 },
        { competicao_id: 'comp1', steam_id64: '999', nick: 'troya', avatar_url: null, total: 300, qtd: 5 },
      ]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    const comp = res.body.encerradas[0] ?? res.body.ativa
    expect(comp.leaderboard.find((l) => l.steamId === '999').qualificado).toBe(true)
    expect(comp.leaderboard.find((l) => l.steamId === '765').qualificado).toBe(false)
  })
})

describe('PUT /api/competicoes/:id/tradelink', () => {
  const COMP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

  it('quem nao e o vencedor: 403', async () => {
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: '2026-07-01', vencedor_steam_id64: '999' }]],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/tradelink`).set('Cookie', cookieJogador).send({ tradelink: 'https://steamcommunity.com/tradeoffer/x' })
    expect(res.status).toBe(403)
  })

  it('o proprio vencedor consegue gravar', async () => {
    const { app, db } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: '2026-07-01', vencedor_steam_id64: '765' }]],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/tradelink`).set('Cookie', cookieJogador).send({ tradelink: 'https://steamcommunity.com/tradeoffer/x' })
    expect(res.status).toBe(200)
    const update = db.query.mock.calls.find(([sql]) => sql.includes('update competicoes set tradelink_vencedor'))
    expect(update).toBeTruthy()
  })

  it('competicao ainda ativa (nao encerrou): 400', async () => {
    const noFuturo = new Date(Date.now() + 86400000).toISOString()
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: noFuturo, vencedor_steam_id64: '765' }]],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/tradelink`).set('Cookie', cookieJogador).send({ tradelink: 'x' })
    expect(res.status).toBe(400)
  })
})

describe('tradelink so aparece pro vencedor/admin em GET /', () => {
  it('outro jogador nao ve tradelink_vencedor na resposta', async () => {
    const { app } = appWith([
      ['from competicoes', [{ id: 'comp1', data_inicio: '2026-07-01', data_fim: '2026-07-05', vencedor_steam_id64: '999', tradelink_vencedor: 'https://steamcommunity.com/x', limite_diario: 2, limite_total: 10, minimo_para_rankear: 1 }]],
      ['from competicao_submissoes cs join', []],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador) // cookie do 765, vencedor é 999
    const comp = res.body.encerradas[0]
    expect(comp.tradelinkVencedor).toBeUndefined()
  })
})
