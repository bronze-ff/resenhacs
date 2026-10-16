import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { validarQuadro, validarPassos, LIMITES } from '../src/quadroValidacao.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos' }
const cookie = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`
const ID = '11111111-2222-3333-4444-555555555555'

function appWith(handlers) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      for (const [needle, rows] of handlers) {
        if (sql.includes(needle)) return Promise.resolve({ rows })
      }
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db }), db }
}

const chamada = (db, needle) => db.query.mock.calls.find((c) => c[0].includes(needle))

const QUADRO = {
  nome: 'Execução A',
  map: 'de_mirage',
  lado: 'T',
  descricao: 'split',
  passos: [
    {
      nome: 'Setup',
      objetos: [
        { tipo: 't', id: 'o1', x: 0.5, y: 0.5, rotulo: 'fih' },
        { tipo: 'smoke', x: 0.123456789, y: 0.2 },
        { tipo: 'seta', x: 0.1, y: 0.1, x2: 0.3, y2: 0.4 },
        { tipo: 'traco', pontos: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.25]] },
      ],
    },
  ],
}

describe('validarQuadro', () => {
  it('aceita um quadro válido e limpa campos desconhecidos', () => {
    const r = validarQuadro({ ...QUADRO, extra: 'x', passos: [{ ...QUADRO.passos[0], lixo: 1 }] })
    expect(r.erro).toBeUndefined()
    expect(r.quadro.publicoNoGrupo).toBe(true)
    expect(r.quadro.passos[0]).not.toHaveProperty('lixo')
    expect(r.quadro.passos[0].objetos[0]).toEqual({ tipo: 't', id: 'o1', x: 0.5, y: 0.5, rotulo: 'fih' })
    expect(r.quadro.passos[0].objetos[1].x).toBe(0.1235)
    expect(r.quadro.passos[0].objetos[3]).toMatchObject({ x: 0.1, y: 0.1, pontos: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.25]] })
  })

  it.each([
    ['sem nome', { ...QUADRO, nome: '  ' }],
    ['nome longo', { ...QUADRO, nome: 'x'.repeat(LIMITES.nome + 1) }],
    ['mapa fora do padrão', { ...QUADRO, map: "de_mirage'; drop" }],
    ['lado inválido', { ...QUADRO, lado: 'X' }],
    ['descrição longa', { ...QUADRO, descricao: 'x'.repeat(LIMITES.descricao + 1) }],
    ['publicoNoGrupo não booleano', { ...QUADRO, publicoNoGrupo: 'sim' }],
    ['sem passos', { ...QUADRO, passos: [] }],
    ['passos demais', { ...QUADRO, passos: Array.from({ length: LIMITES.passos + 1 }, () => ({ nome: 'p', objetos: [] })) }],
  ])('rejeita %s', (_, body) => {
    expect(validarQuadro(body).erro).toBeTruthy()
  })

  it.each([
    ['tipo fora da allowlist', { tipo: 'bomba', x: 0.1, y: 0.1 }],
    ['coord > 1', { tipo: 'ct', x: 1.2, y: 0.1 }],
    ['coord negativa', { tipo: 'ct', x: -0.1, y: 0.1 }],
    ['coord string', { tipo: 'ct', x: '0.1', y: 0.1 }],
    ['coord NaN', { tipo: 'ct', x: NaN, y: 0.1 }],
    ['seta sem destino', { tipo: 'seta', x: 0.1, y: 0.1 }],
    ['traço com 1 ponto', { tipo: 'traco', pontos: [[0.1, 0.1]] }],
    ['traço com ponto fora', { tipo: 'traco', pontos: [[0.1, 0.1], [2, 0]] }],
    ['id com caractere estranho', { tipo: 't', id: '<x>', x: 0.1, y: 0.1 }],
    ['rótulo longo', { tipo: 't', x: 0.1, y: 0.1, rotulo: 'x'.repeat(LIMITES.rotulo + 1) }],
  ])('rejeita objeto: %s', (_, objeto) => {
    expect(validarPassos([{ nome: 'p', objetos: [objeto] }]).erro).toBeTruthy()
  })

  it('rejeita passo com objetos demais', () => {
    const objetos = Array.from({ length: LIMITES.objetosPorPasso + 1 }, () => ({ tipo: 'ct', x: 0.5, y: 0.5 }))
    expect(validarPassos([{ nome: 'p', objetos }]).erro).toMatch(/até/)
  })

  it('lado vazio vira null', () => {
    expect(validarQuadro({ ...QUADRO, lado: '' }).quadro.lado).toBeNull()
  })
})

describe('GET /api/quadros', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/quadros')).status).toBe(401)
  })

  it('lista meus + de amigos accepted públicos, com filtro de mapa', async () => {
    const { app, db } = appWith([
      ['from quadros_taticos q', [
        { id: ID, nome: 'A', map: 'de_mirage', lado: 'T', publico_no_grupo: true, criado_por: '765', qtd_passos: 3, criado_por_nick: 'eu', updated_at: 'x' },
        { id: 'b', nome: 'B', map: 'de_mirage', lado: null, publico_no_grupo: true, criado_por: '999', qtd_passos: 1, criado_por_nick: 'amigo', updated_at: 'y' },
      ]],
    ])
    const res = await request(app).get('/api/quadros?map=de_mirage').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ id: ID, meu: true, qtdPassos: 3 })
    expect(res.body[1]).toMatchObject({ meu: false, criadoPorNick: 'amigo' })
    const [sql, params] = chamada(db, 'from quadros_taticos q')
    expect(sql).toContain("f.status = 'accepted'")
    expect(sql).toContain('q.publico_no_grupo')
    expect(sql).toContain('q.map = $2')
    expect(params).toEqual(['765', 'de_mirage'])
  })

  it('mapa inválido no filtro é ignorado', async () => {
    const { app, db } = appWith([])
    await request(app).get('/api/quadros?map=x%27or').set('Cookie', cookie)
    const [sql, params] = chamada(db, 'from quadros_taticos q')
    expect(sql).not.toContain('q.map =')
    expect(params).toEqual(['765'])
  })
})

describe('GET /api/quadros/:id', () => {
  it('404 se não visível', async () => {
    const { app } = appWith([])
    expect((await request(app).get(`/api/quadros/${ID}`).set('Cookie', cookie)).status).toBe(404)
  })

  it('id que não é uuid: 404 sem tocar o banco', async () => {
    const { app, db } = appWith([])
    expect((await request(app).get('/api/quadros/abc').set('Cookie', cookie)).status).toBe(404)
    expect(chamada(db, 'quadros_taticos')).toBeUndefined()
  })

  it('devolve o quadro com passos', async () => {
    const { app, db } = appWith([
      ['from quadros_taticos q', [{ id: ID, nome: 'A', map: 'de_mirage', lado: 'CT', descricao: 'd', passos: QUADRO.passos, publico_no_grupo: false, criado_por: '765', updated_at: 'u', created_at: 'c' }]],
    ])
    const res = await request(app).get(`/api/quadros/${ID}`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: ID, meu: true, descricao: 'd', qtdPassos: 1 })
    expect(res.body.passos[0].nome).toBe('Setup')
    expect(chamada(db, 'from quadros_taticos q')[1]).toEqual(['765', ID])
  })
})

describe('POST /api/quadros', () => {
  it('cria com o dono do cookie e passos limpos', async () => {
    const { app, db } = appWith([
      ['count(*)', [{ n: 0 }]],
      ['insert into quadros_taticos', [{ id: ID }]],
    ])
    const res = await request(app).post('/api/quadros').set('Cookie', cookie).send({ ...QUADRO, criadoPor: 'outro' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: ID })
    const [, params] = chamada(db, 'insert into quadros_taticos')
    expect(params[0]).toBe('765')
    expect(params[1]).toBe('de_mirage')
    expect(JSON.parse(params[5])[0].objetos).toHaveLength(4)
  })

  it('400 em JSON inválido, sem inserir', async () => {
    const { app, db } = appWith([])
    const res = await request(app).post('/api/quadros').set('Cookie', cookie)
      .send({ ...QUADRO, passos: [{ nome: 'p', objetos: [{ tipo: 'ct', x: 5, y: 0 }] }] })
    expect(res.status).toBe(400)
    expect(chamada(db, 'insert into')).toBeUndefined()
  })

  it('400 quando passa do limite de quadros por jogador', async () => {
    const { app, db } = appWith([['count(*)', [{ n: LIMITES.quadrosPorJogador }]]])
    const res = await request(app).post('/api/quadros').set('Cookie', cookie).send(QUADRO)
    expect(res.status).toBe(400)
    expect(chamada(db, 'insert into')).toBeUndefined()
  })

  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).post('/api/quadros').send(QUADRO)).status).toBe(401)
  })
})

describe('PUT /api/quadros/:id', () => {
  it('atualiza só se for o dono', async () => {
    const { app, db } = appWith([['update quadros_taticos', [{ id: ID }]]])
    const res = await request(app).put(`/api/quadros/${ID}`).set('Cookie', cookie).send(QUADRO)
    expect(res.status).toBe(200)
    const [sql, params] = chamada(db, 'update quadros_taticos')
    expect(sql).toContain('criado_por = $2')
    expect(params.slice(0, 2)).toEqual([ID, '765'])
  })

  it('quadro alheio: 404', async () => {
    const { app } = appWith([['update quadros_taticos', []]])
    expect((await request(app).put(`/api/quadros/${ID}`).set('Cookie', cookie).send(QUADRO)).status).toBe(404)
  })

  it('400 em JSON inválido', async () => {
    const { app } = appWith([])
    expect((await request(app).put(`/api/quadros/${ID}`).set('Cookie', cookie).send({ ...QUADRO, map: '' })).status).toBe(400)
  })
})

describe('DELETE /api/quadros/:id', () => {
  it('exclui só se for o dono', async () => {
    const { app, db } = appWith([['delete from quadros_taticos', [{ id: ID }]]])
    const res = await request(app).delete(`/api/quadros/${ID}`).set('Cookie', cookie)
    expect(res.status).toBe(204)
    expect(chamada(db, 'delete from quadros_taticos')[1]).toEqual([ID, '765'])
  })

  it('quadro alheio: 404', async () => {
    const { app } = appWith([])
    expect((await request(app).delete(`/api/quadros/${ID}`).set('Cookie', cookie)).status).toBe(404)
  })
})
