import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { bancoTransacional } from './bancoTransacional.js'

vi.mock('../src/r2.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, presignUpload: vi.fn().mockResolvedValue('https://r2.example/presigned-put') }
})
import { presignUpload } from '../src/r2.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos' }
const cookie = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`

function appWith(handlers, extra = {}) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      for (const [needle, rows] of handlers) {
        if (sql.includes(needle)) return Promise.resolve({ rows })
      }
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db: bancoTransacional(db.query).db, r2Client: { send: vi.fn() }, ...extra }), db }
}

describe('POST /api/upload/upload-url', () => {
  it('seis POSTs simultâneos com quatro uploads ativos reservam só a última vaga', async () => {
    presignUpload.mockClear()
    let quantidade = 4
    const query = vi.fn(async (sql) => {
      if (sql.includes('select count(*)')) {
        const n = quantidade
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { rows: [{ n }] }
      }
      if (sql.includes('insert into uploads_pendentes')) {
        quantidade++
        return { rows: [{ id: `u${quantidade}` }] }
      }
      return { rows: [] }
    })
    const { db, clientes } = bancoTransacional(query)
    const app = createApp({ config, db, r2Client: { send: vi.fn() } })
    const respostas = await Promise.all(Array.from({ length: 6 }, () => request(app)
      .post('/api/upload/upload-url').set('Cookie', cookie).send({ filename: 'x.dem', tamanho: 10 })))
    expect(respostas.map((res) => res.status).sort()).toEqual([200, 429, 429, 429, 429, 429])
    expect(quantidade).toBe(5)
    expect(presignUpload).toHaveBeenCalledTimes(1)
    expect(clientes).toHaveLength(6)
    expect(clientes.every((client) => !client.emTransacao && client.release.mock.calls.length === 1)).toBe(true)
    const aceito = clientes.find((client) => client.query.mock.calls.some(([sql]) => sql.includes('insert into uploads_pendentes')))
    const comandos = aceito.query.mock.calls.map(([sql]) => sql)
    expect(comandos[0]).toBe('begin')
    expect(comandos.findIndex((sql) => sql.includes('select count(*)'))).toBeLessThan(comandos.findIndex((sql) => sql.includes('insert into uploads_pendentes')))
    expect(comandos.at(-1)).toBe('commit')
  })
  it.each(['parsed', 'pending', 'failed', 'skipped', 'expired'])('Share Code de Partida %s só bloqueia se já processada', async (status) => {
    presignUpload.mockClear()
    const { app, db } = appWith([
      ['from matches where share_code', status === 'parsed' ? [{ id: 'm1' }] : []],
      ['insert into uploads_pendentes', [{ id: 'u1' }]],
    ])
    const shareCode = 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee'
    const res = await request(app).post('/api/upload/upload-url').set('Cookie', cookie)
      .send({ filename: 'x.dem', tamanho: 10, shareCode })
    expect(res.status).toBe(status === 'parsed' ? 409 : 200)
    if (status === 'parsed') {
      expect(res.body.erro).toBe('Essa Partida já está registrada.')
      expect(presignUpload).not.toHaveBeenCalled()
      expect(db.query.mock.calls.some(([sql]) => sql.includes('insert into uploads_pendentes'))).toBe(false)
    }
    const [sql, params] = db.query.mock.calls.find(([q]) => q.includes('from matches where share_code'))
    expect(sql).toContain("status = 'parsed'")
    expect(params).toEqual([shareCode])
  })

  it('upload com alvo ignora Share Code do cliente mesmo se já processado', async () => {
    const matchId = '11111111-1111-1111-1111-111111111111'
    const { app, db } = appWith([
      ['from matches m where m.id', [{ id: matchId, tem_demo: false, source: 'faceit', participou: true }]],
      ['from matches where share_code', [{ id: 'existente' }]],
      ['insert into uploads_pendentes', [{ id: 'u1' }]],
    ])
    const res = await request(app).post('/api/upload/upload-url').set('Cookie', cookie)
      .send({ filename: 'x.dem', tamanho: 10, matchId, shareCode: 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee' })
    expect(res.status).toBe(200)
    expect(db.query.mock.calls.some(([sql]) => sql.includes('from matches where share_code'))).toBe(false)
  })
  it.each([null, '10', 1.5, -1, false])('recusa tamanho não inteiro positivo: %s', async (tamanho) => {
    const { app, db } = appWith([])
    const res = await request(app).post('/api/upload/upload-url').set('Cookie', cookie)
      .send({ filename: 'x.dem', tamanho })
    expect(res.status).toBe(400)
    expect(db.query.mock.calls.some(([sql]) => sql.includes('insert into uploads_pendentes'))).toBe(false)
  })

  it('conta também processando e falhas recentes no teto por Jogador', async () => {
    const { app, db } = appWith([['select count(*)', [{ n: 5 }]]])
    const res = await request(app).post('/api/upload/upload-url').set('Cookie', cookie)
      .send({ filename: 'x.dem', tamanho: 10 })
    expect(res.status).toBe(429)
    const [sql, params] = db.query.mock.calls.find(([q]) => q.includes('select count(*)'))
    expect(sql).toContain("'processando'")
    expect(sql).toContain("'falhou'")
    expect(sql).toContain("interval '24 hours'")
    expect(params).toEqual(['765'])
  })

  it('recusa data local sem fuso', async () => {
    const { app } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const local = new Date(Date.now() - 3600000).toISOString().slice(0, 19)
    const res = await request(app).post('/api/upload/upload-url').set('Cookie', cookie)
      .send({ filename: 'x.dem', tamanho: 10, playedAt: local })
    expect(res.status).toBe(400)
    expect(res.body.erro).toBe('Data sem fuso')
  })
  it.each(['partida.dem.gz', 'PARTIDA.DEM.GZ'])('aceita %s e preserva o formato na chave do Coletor', async (filename) => {
    const { app, db } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const res = await request(app).post('/api/upload/upload-url').set('Cookie', cookie).send({ filename, tamanho: 100 })
    expect(res.status).toBe(200)
    expect(res.body.key).toMatch(/^uploads-pendentes\/[0-9a-f-]+\.dem\.gz$/)
    expect(presignUpload).toHaveBeenLastCalledWith(expect.anything(), 'resenha-demos', res.body.key, 'application/octet-stream', 900, 100)
    const insercao = db.query.mock.calls.find(([sql]) => sql.includes('insert into uploads_pendentes'))
    expect(insercao[1][1]).toBe(res.body.key)
  })

  it.each(['demo.gz', 'demo.dem.gz.exe', 'demo.dem.bz2'])('recusa formato fora da lista: %s', async (filename) => {
    const { app } = appWith([])
    const res = await request(app).post('/api/upload/upload-url').set('Cookie', cookie).send({ filename, tamanho: 100 })
    expect(res.status).toBe(400)
  })

  it('mantém o teto sobre o tamanho comprimido enviado', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/upload/upload-url').set('Cookie', cookie)
      .send({ filename: 'partida.dem.gz', tamanho: 400 * 1024 * 1024 + 1 })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/limite de 400MB/)
  })

  it('sem login: 401', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/upload/upload-url').send({ tamanho: 10, filename: 'x.dem' })
    expect(res.status).toBe(401)
  })

  it('sem R2 configurado: 503', async () => {
    const { app } = appWith([], { r2Client: null })
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem' })
    expect(res.status).toBe(503)
  })

  it('extensão errada: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'demo.txt' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/\.dem/)
  })

  it('share code inválido: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem', shareCode: 'nao-e-um-share-code' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/share code/i)
  })

  it('data inválida: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem', playedAt: 'ontem à noite' })
    expect(res.status).toBe(400)
  })

  it('data no futuro: 400', async () => {
    const { app } = appWith([])
    const futuro = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem', playedAt: futuro })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/entre.*dias/i)
  })

  it('data com formato valido mas invalida no calendario (mes/hora impossiveis): 400, nao 500', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem', playedAt: '2026-13-45T99:99' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/data.*hora inv[áa]lida/i)
  })

  it('data mais de 3 dias no passado: 400', async () => {
    const { app } = appWith([])
    const antigo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem', playedAt: antigo })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/entre.*dias/i)
  })

  it('data dentro da janela de 3 dias: aceita normalmente', async () => {
    const { app } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const recente = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem', playedAt: recente })
    expect(res.status).toBe(200)
  })

  it('caminho feliz: insere na fila sem group_id e devolve a url assinada', async () => {
    const { app, db } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const playedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'MinhaDemo.DEM', shareCode: 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee', playedAt })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('u1')
    expect(res.body.uploadUrl).toBe('https://r2.example/presigned-put')
    expect(res.body.key).toMatch(/^uploads-pendentes\/.+\.dem$/)
    const insert = db.query.mock.calls.find((c) => c[0].includes('insert into uploads_pendentes'))
    expect(insert[0]).not.toContain('group_id')
    expect(insert[1]).toEqual(['765', res.body.key, 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee', playedAt, null, null])
    expect(presignUpload).toHaveBeenCalledWith(expect.anything(), 'resenha-demos', res.body.key, 'application/octet-stream', 900, 10)
  })

  it('plataforma manual invalida: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem', plataformaManual: 'esl' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/plataforma/i)
  })

  it('plataforma manual valida: grava na fila', async () => {
    const { app, db } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem', plataformaManual: 'gamers_club' })
    expect(res.status).toBe(200)
    const insert = db.query.mock.calls.find((c) => c[0].includes('insert into uploads_pendentes'))
    expect(insert[1]).toEqual(['765', res.body.key, null, null, 'gamers_club', null])
  })

  // ---- finding #2 da auditoria: teto de tamanho (defesa em profundidade client-side) ----

  it('tamanho acima do limite: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', tamanho: 500 * 1024 * 1024 })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/limite/i)
  })

  it('tamanho invalido (nao numerico ou <= 0): 400', async () => {
    const { app } = appWith([])
    const res1 = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', tamanho: 'muito' })
    expect(res1.status).toBe(400)

    const res2 = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', tamanho: 0 })
    expect(res2.status).toBe(400)
  })

  it('tamanho dentro do limite: aceita normalmente', async () => {
    const { app } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', tamanho: 100 * 1024 * 1024 })
    expect(res.status).toBe(200)
  })

  it('sem tamanho: rejeita antes de criar o envio', async () => {
    const { app } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem' })
    expect(res.status).toBe(400)
  })

  // ---- envio amarrado a uma Partida (matchId) ----

  const UUID = '11111111-1111-1111-1111-111111111111'

  it('matchId que não é uuid: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem', matchId: 'nao-e-uuid' })
    expect(res.status).toBe(400)
  })

  it('matchId de partida onde o jogador não jogou: 403', async () => {
    const { app, db } = appWith([['from matches m where m.id', [{ id: UUID, tem_demo: false, source: 'faceit', participou: false }]]])
    presignUpload.mockClear()
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem', matchId: UUID })
    expect(res.status).toBe(403)
    expect(res.body.erro).toMatch(/jogou/i)
    expect(presignUpload).not.toHaveBeenCalled()
    expect(db.query.mock.calls.some((c) => c[0].includes('insert into uploads_pendentes'))).toBe(false)
  })

  it('matchId inexistente: 403 (não revela que a partida existe ou não)', async () => {
    const naoJogou = appWith([['from matches m where m.id', [{ id: UUID, tem_demo: false, source: 'faceit', participou: false }]]])
    const resNaoJogou = await request(naoJogou.app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem', matchId: UUID })

    const inexistente = appWith([['from matches m where m.id', []]])
    const resInexistente = await request(inexistente.app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem', matchId: UUID })

    expect(resInexistente.status).toBe(403)
    // Mesmo status E mesmo corpo — senão o 403 vira oráculo por causa da mensagem.
    expect(resInexistente.body).toEqual(resNaoJogou.body)
  })

  it('partida que já tem demo processada: 409', async () => {
    const { app, db } = appWith([['from matches m where m.id', [{ id: UUID, tem_demo: true, source: 'faceit', participou: true }]]])
    presignUpload.mockClear()
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem', matchId: UUID })
    expect(res.status).toBe(409)
    expect(res.body.erro).toMatch(/j[áa] tem demo/i)
    expect(presignUpload).not.toHaveBeenCalled()
    expect(db.query.mock.calls.some((c) => c[0].includes('insert into uploads_pendentes'))).toBe(false)
  })

  it('partida que não é faceit stats-only: 409', async () => {
    const { app } = appWith([['from matches m where m.id', [{ id: UUID, tem_demo: false, source: 'valve_mm', participou: true }]]])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem', matchId: UUID })
    expect(res.status).toBe(409)
  })

  it('caminho feliz: grava match_alvo_id e ignora shareCode/playedAt/plataforma do cliente', async () => {
    const { app, db } = appWith([
      ['from matches m where m.id', [{ id: UUID, tem_demo: false, source: 'faceit', participou: true }]],
      ['insert into uploads_pendentes', [{ id: 'u1' }]],
    ])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({
        tamanho: 10, filename: 'x.dem',
        matchId: UUID,
        shareCode: 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee',
        plataformaManual: 'gamers_club',
      })
    expect(res.status).toBe(200)
    const insert = db.query.mock.calls.find((c) => c[0].includes('insert into uploads_pendentes'))
    expect(insert[0]).toContain('match_alvo_id')
    // herda tudo da Partida: nada de share code / plataforma vindos do cliente
    expect(insert[1]).toEqual(['765', res.body.key, null, null, null, UUID])
  })

  it('envio já em andamento pra essa partida (unique violation): 409', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('from matches m where m.id')) {
          return Promise.resolve({ rows: [{ id: UUID, tem_demo: false, source: 'faceit', participou: true }] })
        }
        if (sql.includes('insert into uploads_pendentes')) {
          return Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }))
        }
        return Promise.resolve({ rows: [] })
      }),
    }
    const app = createApp({ config, db: bancoTransacional(db.query).db, r2Client: { send: vi.fn() } })
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ tamanho: 10, filename: 'x.dem', matchId: UUID })
    expect(res.status).toBe(409)
    expect(res.body.erro).toMatch(/em andamento/i)
  })
})
