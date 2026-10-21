import { afterEach, describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { ErroDemoSlap } from '../src/demoSlap.js'
import { presignDownload } from '../src/r2.js'
import { bancoTransacional } from './bancoTransacional.js'

const config = {
  jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos',
  allstarApiKey: null, allstarSteamIds: new Set(), demoSlapApiKey: null, demoSlapReaisPorCredito: 0.19,
}
const EU = '76561198000000009'
const AMIGO = '76561198000000004'
const cookie = `resenha_token=${signToken({ steamId: EU, isSuperAdmin: false }, config.jwtSecret)}`
const MATCH = '00000000-0000-0000-0000-0000000000aa'
const DEMO = 'https://conta.r2.cloudflarestorage.com/resenha-demos/demos/x.dem'
afterEach(() => vi.restoreAllMocks())

// Banco falso com estado: a Partida, as kills, a análise e os clipes. Cada update
// condicional da rota (reserva de passo) só "pega" se o status bate, como no Postgres.
function bancoFalso({ partida = { id: MATCH, map: 'de_dust2', demo_url: DEMO }, analise = null, clipes = [], pedidosHoje = 0, premium = true } = {}) {
  const estado = { analise, clipes: clipes.map((c) => ({ ...c })) }
  const kills = [
    { tick: 10000, round_number: 3, killer: EU, victim: AMIGO },
    { tick: 20000, round_number: 5, killer: EU, victim: '76561198000000005' },
  ]
  const clipe = (id) => estado.clipes.find((c) => c.id === id)
  const query = vi.fn(async (sql, p = []) => {
    if (sql.includes('tokens_validos_apos')) return { rows: [] }
    if (sql.includes('select is_super_admin, premium from players')) return { rows: [{ is_super_admin: false, premium }] }
    if (sql.includes('from matches m where m.id')) return { rows: partida ? [{ ...partida, id: p[0] }] : [] }
    if (sql.includes('from kill_positions')) return { rows: kills.filter((k) => p[1].includes(k.tick)) }
    if (sql.includes('count(*)::int as total')) {
      const total = pedidosHoje + estado.clipes.length
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { rows: [{ total }] }
    }
    if (sql.includes('select status, job_id, updated_at from demoslap_analises')) return { rows: estado.analise ? [estado.analise] : [] }
    if (sql.includes('insert into demoslap_analises')) {
      estado.analise = { job_id: p[1], status: 'working', tick_rate: null, erro: null, updated_at: new Date() }
      return { rows: [] }
    }
    if (sql.includes('update demoslap_analises set job_id')) {
      if (estado.analise.job_id !== p[2] || estado.analise.status !== 'working') return { rows: [] }
      estado.analise.job_id = p[1]
      return { rows: [{ match_id: MATCH }] }
    }
    if (sql.includes('select job_id, status, tick_rate, erro')) {
      return { rows: estado.analise ? [estado.analise] : [] }
    }
    if (sql.includes("update demoslap_analises set status = 'done'")) {
      Object.assign(estado.analise, { status: 'done', tick_rate: p[1] })
      return { rows: [] }
    }
    if (sql.includes("update demoslap_analises set status = 'error'")) {
      if (p[2] && (estado.analise.job_id !== p[2] || estado.analise.status !== 'working')) return { rows: [] }
      if (sql.includes("interval '5 minutes'") && Date.now() - estado.analise.updated_at <= 300000) return { rows: [] }
      Object.assign(estado.analise, { status: 'error', erro: p[1] })
      return { rows: [{ ...estado.analise }] }
    }
    if (sql.includes('insert into clipes_reais')) {
      estado.clipes.push({
        id: `c${estado.clipes.length + 1}`, match_id: p[0], pedido_por: p[1], modo: p[2], kills: JSON.parse(p[3]), sem_marca: p[4],
        status: 'analisando', video_job_ids: null, fragmovie_job_id: null, erro: null,
        created_at: new Date(), updated_at: new Date(),
      })
      return { rows: [{ id: estado.clipes.at(-1).id }] }
    }
    if (sql.includes('from clipes_reais c')) {
      return {
        rows: estado.clipes.map((c) => ({ ...c, job_id: estado.analise?.job_id ?? null, nick: 'bronze' })),
      }
    }
    const reserva = sql.match(/set status = '(\w+)', updated_at = now\(\) where id = \$1 and status = '(\w+)' returning id/)
    if (reserva) {
      const c = clipe(p[0])
      if (c?.status !== reserva[2]) return { rows: [] }
      c.status = reserva[1]
      return { rows: [{ id: c.id }] }
    }
    if (sql.includes("set status = 'renderizando'")) {
      Object.assign(clipe(p[0]), { status: 'renderizando', video_job_ids: p[1] })
      return { rows: [] }
    }
    if (sql.includes("set status = 'pronto'")) { clipe(p[0]).status = 'pronto'; return { rows: [] } }
    if (sql.includes("set status = 'juntando'")) { clipe(p[0]).status = 'juntando'; return { rows: [] } }
    if (sql.includes("set status = 'erro'")) {
      Object.assign(clipe(p[0]), { status: 'erro', erro: p[1] })
      return { rows: [] }
    }
    return { rows: [] }
  })
  return { ...bancoTransacional(query), estado }
}

function demoSlapFalso(sobrescrever = {}) {
  return {
    analisar: vi.fn().mockResolvedValue('an1'),
    statusAnalise: vi.fn().mockResolvedValue({ status: 'done' }),
    dadosAnalise: vi.fn().mockResolvedValue({ tickRate: 64 }),
    renderizar: vi.fn().mockImplementation(async (_job, clipes) => clipes.map((_, i) => `v${i + 1}`)),
    statusRender: vi.fn().mockResolvedValue({ v1: { status: 'done' }, v2: { status: 'done' } }),
    dadosRender: vi.fn().mockResolvedValue({
      highlightClips: { v1: { clipUrl: 'https://cdn.demo-slap.net/v1.mp4' }, v2: { clipUrl: 'https://cdn.demo-slap.net/v2.mp4' } },
    }),
    calcular: vi.fn().mockResolvedValue(4),
    ...sobrescrever,
  }
}

const r2Client = { send: vi.fn() }
vi.mock('../src/r2.js', async (original) => ({
  ...(await original()),
  presignDownload: vi.fn().mockResolvedValue('https://r2-assinada/x.dem'),
}))

function app({ banco = bancoFalso(), demoSlap = demoSlapFalso() } = {}) {
  return { app: createApp({ config, db: banco.db, r2Client, demoSlap }), banco, demoSlap }
}

const TK = { tick: 10000, round: 3, pov: EU }

describe('clipes reais (DEMO-SLAP)', () => {
  it.each([false, true])('reserva de análise recente espera, antiga vira erro (antiga: %s)', async (antiga) => {
    const banco = bancoFalso({
      analise: { job_id: 'reserva:analise', status: 'working', updated_at: new Date(Date.now() - (antiga ? 600000 : 1000)) },
      clipes: [{ id: 'c1', match_id: MATCH, pedido_por: EU, kills: [TK], status: 'analisando', updated_at: new Date() }],
    })
    const { app: a, demoSlap } = app({ banco })
    const res = await request(a).get(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.clipes[0].status).toBe(antiga ? 'erro' : 'analisando')
    expect(demoSlap.statusAnalise).not.toHaveBeenCalled()
    expect(demoSlap.renderizar).not.toHaveBeenCalled()
  })

  it('timeout de 10s cancela a análise e marca análise e clipe como erro', async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    const banco = bancoFalso()
    const analisar = vi.fn((_url, { signal } = {}) => new Promise((_resolve, reject) => {
      if (!signal) return reject(new Error('sem cancelamento'))
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      setTimeout(() => controller.abort(new Error('tempo esgotado')), 5)
    }))
    const { app: a } = app({ banco, demoSlap: demoSlapFalso({ analisar }) })
    const res = await request(a).post(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie).send({ kills: [TK] })
    expect(res.status).toBe(502)
    expect(timeout).toHaveBeenCalledWith(10000)
    expect(banco.estado.analise.status).toBe('error')
    expect(banco.estado.clipes[0].status).toBe('erro')
    expect(banco.clientes.every((c) => !c.emTransacao && c.release.mock.calls.length === 1)).toBe(true)
  })
  it.each([EU, AMIGO])('dois POSTs simultâneos reservam uma única análise paga (segundo Jogador %s)', async (segundo) => {
    const banco = bancoFalso()
    const analisar = vi.fn(async () => {
      const reservador = banco.clientes.find((c) => c.query.mock.calls.some(([sql]) => sql.includes('insert into demoslap_analises')))
      expect(reservador.emTransacao).toBe(false)
      expect(reservador.release).toHaveBeenCalledTimes(1)
      expect(banco.db.query.mock.calls.some(([sql]) => sql.includes('insert into demoslap_analises'))).toBe(true)
      expect(banco.db.query.mock.calls.some(([sql]) => sql.includes('insert into clipes_reais'))).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 30))
      return 'an1'
    })
    const { app: a } = app({ banco, demoSlap: demoSlapFalso({ analisar }) })
    const respostas = await Promise.all([EU, segundo].map((steamId) => request(a)
      .post(`/api/matches/${MATCH}/clipes-reais`)
      .set('Cookie', `resenha_token=${signToken({ steamId }, config.jwtSecret)}`).send({ kills: [TK] })))
    expect(respostas.map((r) => r.status)).toEqual([201, 201])
    expect(analisar).toHaveBeenCalledTimes(1)
    expect(banco.estado.clipes).toHaveLength(2)
    expect(banco.db.query.mock.calls.some(([sql]) => sql.includes('update demoslap_analises set job_id'))).toBe(true)
  })

  it.each([MATCH, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'])('dois POSTs não excedem a cota diária (segunda Partida %s)', async (segunda) => {
    const banco = bancoFalso({ pedidosHoje: 9, analise: { job_id: 'an1', status: 'done', tick_rate: 64 } })
    const { app: a } = app({ banco })
    const respostas = await Promise.all([MATCH, segunda].map((matchId) => request(a)
      .post(`/api/matches/${matchId}/clipes-reais`).set('Cookie', cookie).send({ kills: [TK] })))
    expect(respostas.map((r) => r.status).sort()).toEqual([201, 429])
    expect(banco.estado.clipes).toHaveLength(1)
  })
  it('sem login: 401', async () => {
    const { app: a } = app()
    expect((await request(a).get(`/api/matches/${MATCH}/clipes-reais`)).status).toBe(401)
  })

  it('sem chave configurada: GET avisa e POST devolve 503', async () => {
    const banco = bancoFalso()
    const a = createApp({ config, db: banco.db, r2Client })
    const get = await request(a).get(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie)
    expect(get.body).toEqual({ disponivel: false, clipes: [] })
    // Desligado não toca nas tabelas da 0059 (podem nem ter sido criadas ainda).
    expect(banco.db.query.mock.calls.some(([sql]) => sql.includes('clipes_reais'))).toBe(false)
    const post = await request(a).post(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie).send({ kills: [TK] })
    expect(post.status).toBe(503)
  })

  it('partida não visível: 404', async () => {
    const { app: a } = app({ banco: bancoFalso({ partida: null }) })
    expect((await request(a).get(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie)).status).toBe(404)
  })

  it('valida o pedido: lista vazia, mais de 10 kills, pov inválido', async () => {
    const { app: a } = app()
    const enviar = (kills) => request(a).post(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie).send({ kills })
    expect((await enviar([])).status).toBe(400)
    expect((await enviar(Array.from({ length: 11 }, () => TK))).status).toBe(400)
    expect((await enviar([{ ...TK, pov: 'x' }])).status).toBe(400)
  })

  it('kill que não existe ou câmera em quem não participou: 400', async () => {
    const { app: a } = app()
    const enviar = (kills) => request(a).post(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie).send({ kills })
    expect((await enviar([{ ...TK, tick: 12345 }])).status).toBe(400)
    expect((await enviar([{ ...TK, pov: '76561198000000099' }])).status).toBe(400)
  })

  it('limite diário: 429', async () => {
    const { app: a } = app({ banco: bancoFalso({ pedidosHoje: 10 }) })
    const res = await request(a).post(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie).send({ kills: [TK] })
    expect(res.status).toBe(429)
  })

  it('primeiro clipe da Partida: analisa a Demo e já manda gravar quando a análise termina', async () => {
    const { app: a, banco, demoSlap } = app()
    const res = await request(a).post(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie)
      .send({ kills: [{ ...TK, pov: AMIGO }] })
    expect(res.status).toBe(201)
    expect(demoSlap.analisar).toHaveBeenCalledWith('https://r2-assinada/x.dem', { signal: expect.any(AbortSignal) })
    expect(demoSlap.renderizar).toHaveBeenCalledWith(
      'an1', [{ tick: 10000 - 256, duration: 7, povSteamId: AMIGO }], { highResolution: true },
    )
    expect(banco.estado.clipes[0]).toMatchObject({ status: 'renderizando', video_job_ids: ['v1'] })
    expect(res.body.clipes[0]).toMatchObject({ status: 'renderizando', montagem: false, videos: [] })
  })

  it('análise já feita não é refeita', async () => {
    const banco = bancoFalso({ analise: { job_id: 'an1', status: 'done', tick_rate: 64, erro: null } })
    const { app: a, demoSlap } = app({ banco })
    await request(a).post(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie).send({ kills: [TK] })
    expect(demoSlap.analisar).not.toHaveBeenCalled()
    expect(demoSlap.renderizar).toHaveBeenCalledTimes(1)
  })

  it('clipe gravado: GET marca pronto e devolve a URL do vídeo', async () => {
    const banco = bancoFalso({
      analise: { job_id: 'an1', status: 'done', tick_rate: 64, erro: null },
      clipes: [{ id: 'c1', match_id: MATCH, pedido_por: EU, kills: [TK], status: 'renderizando', video_job_ids: ['v1'], fragmovie_job_id: null, updated_at: new Date() }],
    })
    const { app: a } = app({ banco })
    const res = await request(a).get(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie)
    expect(res.body.disponivel).toBe(true)
    expect(res.body.clipes[0]).toMatchObject({ id: 'c1', status: 'pronto', videos: ['https://cdn.demo-slap.net/v1.mp4'] })
  })

  it('montagem: com os trechos gravados espera a junção, sem mostrar os trechos soltos', async () => {
    const kills = [TK, { tick: 20000, round: 5, pov: EU }]
    const banco = bancoFalso({
      analise: { job_id: 'an1', status: 'done', tick_rate: 64, erro: null },
      clipes: [{ id: 'c1', match_id: MATCH, pedido_por: EU, kills, status: 'renderizando', video_job_ids: ['v2', 'v1'], fragmovie_job_id: null, updated_at: new Date() }],
    })
    const { app: a, demoSlap } = app({ banco })
    const res = await request(a).get(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie)
    expect(res.body.clipes[0]).toMatchObject({ status: 'juntando', montagem: true, videos: [] })
    expect(demoSlap.dadosRender).not.toHaveBeenCalled()
  })

  it('montagem que o Coletor não juntou em 1 h fica pronta com os trechos, na ordem', async () => {
    const banco = bancoFalso({
      analise: { job_id: 'an1', status: 'done', tick_rate: 64, erro: null },
      clipes: [{ id: 'c1', match_id: MATCH, pedido_por: EU, kills: [TK, TK], status: 'juntando', video_job_ids: ['v2', 'v1'], updated_at: new Date(Date.now() - 61 * 60 * 1000) }],
    })
    const { app: a } = app({ banco })
    const res = await request(a).get(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie)
    expect(res.body.clipes[0]).toMatchObject({ status: 'pronto', videos: ['https://cdn.demo-slap.net/v2.mp4', 'https://cdn.demo-slap.net/v1.mp4'] })
  })

  it('montagem já juntada pelo Coletor: entrega só o vídeo único do R2', async () => {
    const banco = bancoFalso({
      analise: { job_id: 'an1', status: 'done', tick_rate: 64, erro: null },
      clipes: [{ id: 'c1', match_id: MATCH, pedido_por: EU, kills: [TK, TK], status: 'pronto', video_job_ids: ['v1', 'v2'], video_r2_key: 'clipes/c1.mp4', updated_at: new Date() }],
    })
    const { app: a, demoSlap } = app({ banco })
    const res = await request(a).get(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie)
    expect(res.body.clipes[0].videos).toEqual(['https://r2-assinada/x.dem'])
    expect(presignDownload).toHaveBeenLastCalledWith(r2Client, 'resenha-demos', 'clipes/c1.mp4', 3600)
    expect(demoSlap.dadosRender).not.toHaveBeenCalled()
  })


  it('DEMO-SLAP recusa o render (ex.: sem crédito): clipe vira erro com a mensagem deles', async () => {
    const banco = bancoFalso({ analise: { job_id: 'an1', status: 'done', tick_rate: 64, erro: null } })
    const renderizar = vi.fn().mockRejectedValue(new ErroDemoSlap(400, 'Not enough credits'))
    const { app: a } = app({ banco, demoSlap: demoSlapFalso({ renderizar }) })
    const res = await request(a).post(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie).send({ kills: [TK] })
    expect(res.body.clipes[0]).toMatchObject({ status: 'erro', erro: 'Not enough credits' })
  })

  it('falha de rede ao consultar não estraga o clipe', async () => {
    const banco = bancoFalso({
      analise: { job_id: 'an1', status: 'done', tick_rate: 64, erro: null },
      clipes: [{ id: 'c1', match_id: MATCH, pedido_por: EU, kills: [TK], status: 'renderizando', video_job_ids: ['v1'], fragmovie_job_id: null, updated_at: new Date() }],
    })
    const statusRender = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const { app: a } = app({ banco, demoSlap: demoSlapFalso({ statusRender }) })
    const res = await request(a).get(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie)
    expect(res.body.clipes[0].status).toBe('renderizando')
  })

  it('reserva interrompida há mais de 5 min vira erro', async () => {
    const banco = bancoFalso({
      analise: { job_id: 'an1', status: 'done', tick_rate: 64, erro: null },
      clipes: [{ id: 'c1', match_id: MATCH, pedido_por: EU, kills: [TK], status: 'enviando', updated_at: new Date(Date.now() - 10 * 60 * 1000) }],
    })
    const { app: a } = app({ banco })
    const res = await request(a).get(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie)
    expect(res.body.clipes[0].status).toBe('erro')
  })

  it('Jogador sem Premium: vê os clipes, mas não pede nem estima', async () => {
    const { app: a, demoSlap } = app({ banco: bancoFalso({ premium: false }) })
    const get = await request(a).get(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie)
    expect(get.body).toMatchObject({ disponivel: true, permitido: false })
    const post = await request(a).post(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie).send({ kills: [TK] })
    expect(post.status).toBe(403)
    const est = await request(a).post(`/api/matches/${MATCH}/clipes-reais/estimativa`).set('Cookie', cookie).send({ kills: [TK] })
    expect(est.status).toBe(403)
    expect(demoSlap.renderizar).not.toHaveBeenCalled()
    expect(demoSlap.calcular).not.toHaveBeenCalled()
  })

  it('modo inválido: 400', async () => {
    const { app: a } = app()
    const res = await request(a).post(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie).send({ modo: 'x', kills: [TK] })
    expect(res.status).toBe(400)
  })

  it('coaching: cada morte vira dois trechos, na visão de quem morreu e de quem matou', async () => {
    const banco = bancoFalso({ analise: { job_id: 'an1', status: 'done', tick_rate: 64, erro: null } })
    const { app: a, demoSlap } = app({ banco })
    const res = await request(a).post(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie)
      .send({ modo: 'coaching', kills: [{ ...TK, pov: AMIGO }] })
    expect(res.status).toBe(201)
    const [, clipes, opcoes] = demoSlap.renderizar.mock.calls[0]
    expect(clipes.map((c) => c.povSteamId)).toEqual([AMIGO, EU])
    expect(opcoes).toEqual({ highResolution: true })
    expect(banco.estado.clipes[0]).toMatchObject({ modo: 'coaching' })
    expect(res.body.clipes[0]).toMatchObject({ modo: 'coaching', montagem: true })
  })

  it('fails só aceita a visão de quem morreu', async () => {
    const { app: a } = app()
    const res = await request(a).post(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie)
      .send({ modo: 'fails', kills: [TK] })
    expect(res.status).toBe(400)
  })

  it('cheater analysis grava na visão de quem matou, com X-Ray', async () => {
    const banco = bancoFalso({ analise: { job_id: 'an1', status: 'done', tick_rate: 64, erro: null } })
    const { app: a, demoSlap } = app({ banco })
    await request(a).post(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie).send({ modo: 'cheater', kills: [TK] })
    expect(demoSlap.renderizar.mock.calls[0][2]).toEqual({ highResolution: true, showXRay: true })
  })

  it('sem marca d\'água: guarda a escolha e pede o render com hideWatermark', async () => {
    const banco = bancoFalso({ analise: { job_id: 'an1', status: 'done', tick_rate: 64, erro: null } })
    const { app: a, demoSlap } = app({ banco })
    const res = await request(a).post(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie).send({ kills: [TK], semMarca: true })
    expect(demoSlap.renderizar.mock.calls[0][2]).toEqual({ highResolution: true, hideWatermark: true })
    expect(banco.estado.clipes[0].sem_marca).toBe(true)
    expect(res.body.clipes[0].semMarca).toBe(true)
  })

  it('estimativa: créditos da DEMO-SLAP + 1 da leitura da Demo, em reais, e o extra sem marca d\'água', async () => {
    const calcular = vi.fn().mockImplementation(async (_clipes, opcoes) => (opcoes.hideWatermark ? 6 : 4))
    const { app: a, banco, demoSlap } = app({ demoSlap: demoSlapFalso({ calcular }) })
    const res = await request(a).post(`/api/matches/${MATCH}/clipes-reais/estimativa`).set('Cookie', cookie)
      .send({ modo: 'coaching', kills: [{ ...TK, pov: AMIGO }] })
    expect(res.body).toEqual({ trechos: 2, creditos: 4, analise: 1, total: 5, reais: 0.95, extraSemMarca: 2, reaisExtraSemMarca: 0.38 })
    const semMarca = await request(a).post(`/api/matches/${MATCH}/clipes-reais/estimativa`).set('Cookie', cookie)
      .send({ modo: 'coaching', kills: [{ ...TK, pov: AMIGO }], semMarca: true })
    expect(semMarca.body).toMatchObject({ creditos: 6, total: 7 })
    expect(demoSlap.calcular.mock.calls[0][0]).toHaveLength(2)
    expect(demoSlap.analisar).not.toHaveBeenCalled()
    expect(banco.estado.clipes).toHaveLength(0)
  })
})
