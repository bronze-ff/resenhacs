import { afterEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createExtensaoRouter, FACEIT_DEMO_HOSTS } from '../src/routes/extensao.js'
import * as extensao from '../src/routes/extensao.js'
import { assinarTokenExtensao } from '../src/auth/tokenExtensao.js'
import { createRequireAuth } from '../src/auth/middleware.js'
import { signToken } from '../src/auth/jwt.js'
import { createUploadRouter } from '../src/routes/upload.js'
import { createApp } from '../src/app.js'
import { bancoTransacional } from './bancoTransacional.js'
import { capturarErro } from '../src/observabilidade/sentry.js'

vi.mock('../src/observabilidade/sentry.js', () => ({ capturarErro: vi.fn() }))
vi.mock('../src/r2.js', async (original) => ({ ...await original(), presignUpload: vi.fn(async () => 'https://r2.test/upload') }))

const steamId = '76561198012345678'
const jwtSecret = 'segredo-ficticio-extensao'
const matchId = '11111111-1111-1111-1111-111111111111'
const faceitMatchId = `1-${matchId}`
const hosts = ['demos.faceit.test']
const siteOrigin = 'https://resenha-phi.vercel.app'
const corpo = { faceitMatchId, downloadUrl: 'https://demos.faceit.test/demo.dem.gz?assinatura=ficticia' }
const cookie = () => `resenha_token=${signToken({ steamId }, jwtSecret)}`
const bearer = () => `Bearer ${assinarTokenExtensao({ steamId }, jwtSecret).token}`
afterEach(() => vi.restoreAllMocks())

function preparar({ alvo = { id: matchId, tem_demo: false, source: 'faceit', participou: true }, ativos = 0, diarios = 0, erroInsert, erroConnect, reais = false } = {}) {
  const estado = { ativos, diarios }
  const query = vi.fn(async (sql) => {
    if (sql.includes('tokens_validos_apos')) return { rows: [{ tokens_validos_apos: null }] }
    if (sql.includes('from matches m')) return { rows: alvo ? [alvo] : [] }
    if (sql.includes('select count(*)')) return { rows: [{ n: sql.includes("origem = 'extensao'") ? estado.diarios : estado.ativos }] }
    if (sql.includes('insert into uploads_pendentes')) {
      if (erroInsert) throw erroInsert
      estado.ativos++
      if (sql.includes('origem_url')) estado.diarios++
      return { rows: [{ id: matchId }] }
    }
    return { rows: [] }
  })
  const banco = bancoTransacional(query)
  if (erroConnect) banco.db.connect.mockRejectedValue(erroConnect)
  const requireAuth = createRequireAuth(jwtSecret, banco.db)
  const app = express()
  app.use(cookieParser())
  app.use('/api/extensao', createExtensaoRouter({ db: banco.db, requireAuth, jwtSecret, ...(reais ? {} : { faceitDemoHosts: hosts }) }))
  app.use('/api/upload', express.json(), createUploadRouter({ db: banco.db, requireAuth, r2Client: {}, r2Bucket: 'teste' }))
  return { app, query, estado, ...banco }
}

describe('I9 token e renovação', () => {
  it('token exige cookie, retorna só token/expiraEm e não aceita Bearer no lugar', async () => {
    const { app } = preparar()
    expect((await request(app).post('/api/extensao/token')).status).toBe(401)
    expect((await request(app).post('/api/extensao/token').set('Authorization', bearer())).status).toBe(401)
    const res = await request(app).post('/api/extensao/token').set('Cookie', cookie()).set('Origin', siteOrigin).send({})
    expect(res.status).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(['expiraEm', 'token'])
    expect(jwt.decode(res.body.token)).toMatchObject({ steamId, escopo: 'extensao-upload' })
    expect(new Date(res.body.expiraEm).toISOString()).toBe(res.body.expiraEm)
  })

  it('renovar exige Bearer e mantém conectadoEm; rotas antigas não existem', async () => {
    const { app } = preparar()
    expect((await request(app).post('/api/extensao/renovar').set('Cookie', cookie())).status).toBe(401)
    const token = bearer()
    const res = await request(app).post('/api/extensao/renovar').set('Authorization', token)
    expect(res.status).toBe(200)
    expect(jwt.decode(res.body.token).conectadoEm).toBe(jwt.decode(token.slice(7)).conectadoEm)
    for (const url of ['/api/extensao/pendentes', `/api/extensao/partida/${faceitMatchId}`]) expect((await request(app).get(url).set('Authorization', token)).status).toBe(404)
  })

  it.each(['token', 'renovar'])('%s recusa campos extras', async (rota) => {
    const res = await request(preparar().app).post(`/api/extensao/${rota}`).set('Cookie', cookie()).set('Authorization', bearer()).set('Origin', siteOrigin).send({ extra: true })
    expect(res.status).toBe(400)
  })

  it.each([undefined, 'null', 'https://evil.test', `${siteOrigin}.evil.test`, 'http://resenha-phi.vercel.app'])('token recusa Origin não confiável mesmo com cookie válido: %s', async (origin) => {
    const pedido = request(preparar().app).post('/api/extensao/token').set('Cookie', cookie())
    if (origin !== undefined) pedido.set('Origin', origin)
    const res = await pedido.send({})
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ erro: 'Origem não permitida' })
  })

  it('token recusa Sec-Fetch-Site cross-site mesmo com Origin permitido', async () => {
    const res = await request(preparar().app).post('/api/extensao/token').set('Cookie', cookie()).set('Origin', siteOrigin).set('Sec-Fetch-Site', 'cross-site').send({})
    expect(res.status).toBe(403)
    expect(res.body).not.toHaveProperty('token')
  })
})

describe('I9 envio e fronteiras', () => {
  it('enfileira só a Partida do Jogador, com binds e sem presign', async () => {
    const { app, query, clientes } = preparar()
    const res = await request(app).post('/api/extensao/envio').set('Authorization', bearer()).send(corpo)
    expect(res.status).toBe(202)
    expect(res.body).toEqual({ id: matchId, matchId })
    const [sqlAlvo, paramsAlvo] = query.mock.calls.find(([sql]) => sql.includes('from matches m'))
    expect(sqlAlvo).toContain('mp.steam_id64 = $2')
    expect(paramsAlvo).toEqual([faceitMatchId, steamId])
    const [sql, params] = query.mock.calls.find(([sql]) => sql.includes('insert into uploads_pendentes'))
    expect(sql).toContain('origem_url')
    expect(sql).toContain("'extensao'")
    expect(sql).not.toContain(corpo.downloadUrl)
    expect(params).toEqual([steamId, expect.stringMatching(/^uploads-pendentes\/[0-9a-f-]+\.dem\.gz$/), matchId, corpo.downloadUrl])
    const comandos = clientes[0].query.mock.calls.map(([s]) => s)
    expect(comandos[0]).toBe('begin')
    expect(comandos.at(-1)).toBe('commit')
    expect(clientes[0].release).toHaveBeenCalledTimes(1)
  })

  it('recusa cookie como credencial de envio e falha fechado com allowlist real vazia', async () => {
    const { app, db } = preparar({ reais: true })
    expect(FACEIT_DEMO_HOSTS).toEqual([])
    expect((await request(app).post('/api/extensao/envio').set('Cookie', cookie()).send(corpo)).status).toBe(401)
    expect((await request(app).post('/api/extensao/envio').set('Authorization', bearer()).send(corpo)).status).toBe(400)
    expect(db.connect).not.toHaveBeenCalled()
  })

  it.each([
    { ...corpo, faceitMatchId: 'invalido' }, { ...corpo, extra: true }, { faceitMatchId },
    { ...corpo, downloadUrl: 'http://demos.faceit.test/demo.dem.gz' },
    { ...corpo, downloadUrl: 'https://demos.faceit.test.evil.test/demo.dem.gz' },
    { ...corpo, downloadUrl: 'https://user:senha@demos.faceit.test/demo.dem.gz' },
    { ...corpo, downloadUrl: 'https://demos.faceit.test:444/demo.dem.gz' },
    { ...corpo, downloadUrl: `https://demos.faceit.test/${'a'.repeat(2048)}` },
  ])('400 para corpo/URL inválidos sem gravar nem ecoar dado: %j', async (body) => {
    const { app, db } = preparar()
    const res = await request(app).post('/api/extensao/envio').set('Authorization', bearer()).send(body)
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).not.toContain('assinatura')
    expect(db.connect).not.toHaveBeenCalled()
  })

  it.each([null, { id: matchId, tem_demo: false, source: 'faceit', participou: false }])('inexistente ou alheia dá o mesmo 404', async (alvo) => {
    const { app, query } = preparar({ alvo })
    const res = await request(app).post('/api/extensao/envio').set('Authorization', bearer()).send(corpo)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ erro: 'Partida não encontrada no ResenhaCS' })
    expect(query.mock.calls.some(([sql]) => sql.includes('insert into'))).toBe(false)
  })

  it.each([
    [{ id: matchId, tem_demo: true, source: 'faceit', participou: true }, 'Esta partida já tem demo processada'],
    [{ id: matchId, tem_demo: false, source: 'valve_mm', participou: true }, 'Esta partida não aceita envio de demo'],
  ])('409 para alvo inelegível', async (alvo, erro) => {
    const res = await request(preparar({ alvo }).app).post('/api/extensao/envio').set('Authorization', bearer()).send(corpo)
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ erro })
  })

  it('conflito do índice de envio ativo retorna 409, faz rollback e libera conexão', async () => {
    const { app, clientes } = preparar({ erroInsert: Object.assign(new Error('privado'), { code: '23505', constraint: 'uploads_pendentes_alvo_ativo_idx' }) })
    const res = await request(app).post('/api/extensao/envio').set('Authorization', bearer()).send(corpo)
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ erro: 'Já existe um envio em andamento pra esta partida' })
    expect(clientes[0].query).toHaveBeenLastCalledWith('rollback')
    expect(clientes[0].release).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('falha de banco não leva link, token ou erro bruto ao log/Sentry (connect=%s)', async (naConexao) => {
    capturarErro.mockClear()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const erro = new Error(`privado ${corpo.downloadUrl} ${steamId}`)
    const { app } = preparar(naConexao ? { erroConnect: erro } : { erroInsert: erro })
    const res = await request(app).post('/api/extensao/envio').set('Authorization', bearer()).send(corpo)
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ erro: 'Erro interno' })
    const observacao = JSON.stringify([log.mock.calls, capturarErro.mock.calls.map(([e]) => ({ message: e.message, stack: e.stack, cause: e.cause }))])
    for (const dado of ['privado', 'assinatura', corpo.downloadUrl, steamId]) expect(observacao).not.toContain(dado)
    expect(capturarErro).toHaveBeenCalledTimes(1)
  })

  it.each([[false, false], [true, false], [false, true], [true, true]])('createApp real não encaminha erro bruto nem duplica captura (connect=%s, compat=%s)', async (naConexao, compat) => {
    capturarErro.mockClear()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const erro = new Error(`privado ${corpo.downloadUrl} ${steamId}`)
    const { db } = preparar(naConexao ? { erroConnect: erro } : { erroInsert: erro })
    const criarRouter = extensao.createExtensaoRouter
    vi.spyOn(extensao, 'createExtensaoRouter').mockImplementation((opcoes) => criarRouter({ ...opcoes, faceitDemoHosts: hosts }))
    if (compat) {
      // Reproduz o catch(next) de compatibilidade junto ao encaminhamento do Express 5.
      const post = express.Router.prototype.post
      vi.spyOn(express.Router.prototype, 'post').mockImplementation(function (path, ...handlers) {
        return post.call(this, path, ...handlers.map((handler) => function (req, res, next) {
          const out = handler(req, res, next)
          if (out && typeof out.catch === 'function') out.catch(next)
          return out
        }))
      })
    }
    const app = createApp({ config: { jwtSecret }, db })
    const res = await request(app).post('/api/extensao/envio').set('Authorization', bearer()).send(corpo)
    await new Promise(setImmediate)
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ erro: 'Erro interno' })
    const observacao = JSON.stringify([log.mock.calls, capturarErro.mock.calls.map(([e]) => ({ message: e.message, stack: e.stack, cause: e.cause }))])
    for (const dado of ['privado', 'assinatura', corpo.downloadUrl, steamId]) expect(observacao).not.toContain(dado)
    expect(capturarErro).toHaveBeenCalledTimes(1)
    expect(capturarErro.mock.calls[0][0]).not.toBe(erro)
  })

  it('mount real preserva limite 4 KB e rejeita JSON inválido sem capturar seu corpo', async () => {
    capturarErro.mockClear()
    const app = createApp({ config: { jwtSecret }, db: preparar().db })
    expect((await request(app).post('/api/extensao/token').set('Cookie', cookie()).set('Origin', siteOrigin)).status).toBe(200)
    expect((await request(app).post('/api/extensao/envio').set('Authorization', bearer()).send({ ...corpo, lixo: 'x'.repeat(4096) })).status).toBe(413)
    const res = await request(app).post('/api/extensao/envio').set('Authorization', bearer()).set('Content-Type', 'application/json').send(`{"url":"${corpo.downloadUrl}"`)
    expect(res.status).toBe(400)
    expect(capturarErro).not.toHaveBeenCalled()
  })

  it.each(['/API/EXTENSAO/envio', '/api/EXTENSAO/envio'])('limite 4 KB também vale para rota sem distinção de caixa: %s', async (url) => {
    const app = createApp({ config: { jwtSecret }, db: preparar().db })
    const res = await request(app).post(url).set('Authorization', bearer()).send({ ...corpo, extra: 'x'.repeat(4096) })
    expect(res.status).toBe(413)
  })
})

describe('cotas por Jogador na mesma transação', () => {
  it('20 envios/24 h: seis POSTs simultâneos com 19 aceitam somente mais um', async () => {
    const { app, estado, clientes, query } = preparar({ diarios: 19 })
    const respostas = await Promise.all(Array.from({ length: 6 }, () => request(app).post('/api/extensao/envio').set('Authorization', bearer()).send(corpo)))
    expect(respostas.map((r) => r.status).sort()).toEqual([202, 429, 429, 429, 429, 429])
    expect(estado.diarios).toBe(20)
    expect(respostas.find((r) => r.status === 429).body.erro).toBe('Limite de envios da extensão atingido. Tente amanhã.')
    const [sql, params] = query.mock.calls.find(([s]) => s.includes("origem = 'extensao'"))
    expect(sql).toContain("interval '24 hours'")
    expect(params).toEqual([steamId])
    expect(clientes.every((c) => !c.emTransacao && c.release.mock.calls.length === 1)).toBe(true)
  })

  it('upload do site e extensão compartilham a última vaga e a mesma trava', async () => {
    const { app, estado, clientes } = preparar({ ativos: 4 })
    const respostas = await Promise.all([
      request(app).post('/api/extensao/envio').set('Authorization', bearer()).send(corpo),
      request(app).post('/api/upload/upload-url').set('Cookie', cookie()).send({ filename: 'a.dem', tamanho: 10 }),
    ])
    expect(respostas.filter((r) => r.status === 429)).toHaveLength(1)
    expect(estado.ativos).toBe(5)
    for (const c of clientes) expect(c.query).toHaveBeenCalledWith('select pg_advisory_xact_lock(hashtext($1))', [`uploads:${steamId}`])
  })
})
