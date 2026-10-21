import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { ErroDemoSlap } from '../src/demoSlap.js'
import { presignDownload } from '../src/r2.js'

const config = {
  jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos',
  allstarApiKey: null, allstarSteamIds: new Set(), demoSlapApiKey: null, demoSlapReaisPorCredito: 0.19,
}
const EU = '76561198000000009'
const AMIGO = '76561198000000004'
const cookie = `resenha_token=${signToken({ steamId: EU, isSuperAdmin: false }, config.jwtSecret)}`
const MATCH = '00000000-0000-0000-0000-0000000000aa'
const DEMO = 'https://conta.r2.cloudflarestorage.com/resenha-demos/demos/x.dem'

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
    if (sql.includes('from matches m where m.id')) return { rows: partida ? [partida] : [] }
    if (sql.includes('from kill_positions')) return { rows: kills.filter((k) => p[1].includes(k.tick)) }
    if (sql.includes('count(*)::int as total')) return { rows: [{ total: pedidosHoje }] }
    if (sql.includes('select status from demoslap_analises')) return { rows: estado.analise ? [estado.analise] : [] }
    if (sql.includes('insert into demoslap_analises')) {
      estado.analise = { job_id: p[1], status: 'working', tick_rate: null, erro: null }
      return { rows: [] }
    }
    if (sql.includes('select job_id, status, tick_rate, erro from demoslap_analises')) {
      return { rows: estado.analise ? [estado.analise] : [] }
    }
    if (sql.includes("update demoslap_analises set status = 'done'")) {
      Object.assign(estado.analise, { status: 'done', tick_rate: p[1] })
      return { rows: [] }
    }
    if (sql.includes("update demoslap_analises set status = 'error'")) {
      Object.assign(estado.analise, { status: 'error', erro: p[1] })
      return { rows: [] }
    }
    if (sql.includes('insert into clipes_reais')) {
      estado.clipes.push({
        id: `c${estado.clipes.length + 1}`, match_id: p[0], pedido_por: p[1], modo: p[2], kills: JSON.parse(p[3]),
        status: 'analisando', video_job_ids: null, fragmovie_job_id: null, erro: null,
        created_at: new Date(), updated_at: new Date(),
      })
      return { rows: [] }
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
    if (sql.includes("set status = 'erro'")) {
      Object.assign(clipe(p[0]), { status: 'erro', erro: p[1] })
      return { rows: [] }
    }
    return { rows: [] }
  })
  return { db: { query }, estado }
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
    expect(demoSlap.analisar).toHaveBeenCalledWith('https://r2-assinada/x.dem')
    expect(demoSlap.renderizar).toHaveBeenCalledWith(
      'an1', [{ tick: 10000 - 256, duration: 7, povSteamId: AMIGO }], { highResolution: false },
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

  it('montagem: com os trechos gravados fica pronta e entrega um vídeo por kill, na ordem', async () => {
    const kills = [TK, { tick: 20000, round: 5, pov: EU }]
    const banco = bancoFalso({
      analise: { job_id: 'an1', status: 'done', tick_rate: 64, erro: null },
      clipes: [{ id: 'c1', match_id: MATCH, pedido_por: EU, kills, status: 'renderizando', video_job_ids: ['v2', 'v1'], fragmovie_job_id: null, updated_at: new Date() }],
    })
    const { app: a } = app({ banco })
    const res = await request(a).get(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie)
    expect(res.body.clipes[0]).toMatchObject({
      status: 'pronto', montagem: true, videos: ['https://cdn.demo-slap.net/v2.mp4', 'https://cdn.demo-slap.net/v1.mp4'],
    })
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

  it('pedido antigo parado em juntando vira pronto com os trechos', async () => {
    const banco = bancoFalso({
      analise: { job_id: 'an1', status: 'done', tick_rate: 64, erro: null },
      clipes: [{ id: 'c1', match_id: MATCH, pedido_por: EU, kills: [TK, TK], status: 'juntando', video_job_ids: ['v1', 'v2'], fragmovie_job_id: 'f1', updated_at: new Date() }],
    })
    const { app: a } = app({ banco })
    const res = await request(a).get(`/api/matches/${MATCH}/clipes-reais`).set('Cookie', cookie)
    expect(res.body.clipes[0]).toMatchObject({ status: 'pronto', videos: ['https://cdn.demo-slap.net/v1.mp4', 'https://cdn.demo-slap.net/v2.mp4'] })
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
    expect(opcoes).toEqual({ highResolution: false })
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
    expect(demoSlap.renderizar.mock.calls[0][2]).toEqual({ highResolution: false, showXRay: true })
  })

  it('estimativa: créditos da DEMO-SLAP + 1 da leitura da Demo, em reais, sem pedir nada', async () => {
    const { app: a, banco, demoSlap } = app()
    const res = await request(a).post(`/api/matches/${MATCH}/clipes-reais/estimativa`).set('Cookie', cookie)
      .send({ modo: 'coaching', kills: [{ ...TK, pov: AMIGO }] })
    expect(res.body).toEqual({ trechos: 2, creditos: 4, analise: 1, total: 5, reais: 0.95 })
    expect(demoSlap.calcular.mock.calls[0][0]).toHaveLength(2)
    expect(demoSlap.analisar).not.toHaveBeenCalled()
    expect(banco.estado.clipes).toHaveLength(0)
  })
})
