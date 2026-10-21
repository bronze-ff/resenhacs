import { afterEach, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { bancoTransacional } from './bancoTransacional.js'

vi.mock('../src/r2.js', async (original) => ({
  ...(await original()), presignDownload: vi.fn().mockResolvedValue('https://r2.example/demo'),
}))

const EU = '76561198000000009'
const MATCH = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const CLIP = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const config = {
  jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false,
  r2Bucket: 'demos', allstarApiKey: 'teste', allstarSteamIds: new Set(),
}
const cookie = `resenha_token=${signToken({ steamId: EU }, config.jwtSecret)}`
afterEach(() => vi.unstubAllGlobals())

it.each([false, true])('dois pedidos Allstar gastam uma chamada (reserva órfã: %s)', async (orfa) => {
  let linha = orfa ? { id: CLIP, status: 'Submitted', request_id: 'reserva:antiga', updated_at: new Date(Date.now() - 600000) } : null
  let leituras = 0
  let soltar
  const barreira = new Promise((resolve) => { soltar = resolve })
  const db = { query: vi.fn(async (sql, p) => {
    if (sql.includes('from match_players mp')) return { rows: [{ steam_id64: EU, demo_url: 'https://r2.example/demos/x.dem' }] }
    if (sql.startsWith('select status, clip_url')) {
      const reserva_expirada = linha?.request_id.startsWith('reserva:') && Date.now() - linha.updated_at > 300000
      const copia = linha ? [{ ...linha, reserva_expirada: sql.includes('reserva_expirada') && reserva_expirada }] : []
      if (++leituras === 2) soltar()
      if (leituras <= 2) await barreira
      return { rows: copia }
    }
    if (sql.includes('insert into allstar_clips')) {
      const expirada = linha?.request_id.startsWith('reserva:') && Date.now() - linha.updated_at > 300000
      if (linha && sql.includes('on conflict') && !(expirada && sql.includes("interval '5 minutes'"))) return { rows: [] }
      linha = { id: CLIP, status: 'Submitted', request_id: p[2], updated_at: new Date() }
      return { rows: [{ id: CLIP }] }
    }
    if (sql.includes('update allstar_clips set request_id')) linha.request_id = p[2]
    return { rows: [] }
  }) }
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ requestId: 'req1' }) })
  vi.stubGlobal('fetch', fetchImpl)
  const app = createApp({ config, db, r2Client: {} })
  const respostas = await Promise.all([1, 2].map(() => request(app)
    .post(`/api/matches/${MATCH}/jogador/${EU}/clipe`).set('Cookie', cookie)))
  expect(respostas.map((r) => r.body)).toEqual([{ status: 'Submitted' }, { status: 'Submitted' }])
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(linha.request_id).toBe('req1')
})

it.each(['reserva:recente', 'request-real-antigo'])('não retoma reserva recente nem pedido real: %s', async (requestId) => {
  const db = { query: vi.fn(async (sql) => {
    if (sql.includes('from match_players mp')) return { rows: [{ steam_id64: EU, demo_url: 'https://r2.example/demos/x.dem' }] }
    if (sql.startsWith('select status, clip_url')) return { rows: [{ status: 'Submitted', request_id: requestId, reserva_expirada: false }] }
    return { rows: [] }
  }) }
  const fetchImpl = vi.fn()
  vi.stubGlobal('fetch', fetchImpl)
  const app = createApp({ config, db, r2Client: {} })
  const res = await request(app).post(`/api/matches/${MATCH}/jogador/${EU}/clipe`).set('Cookie', cookie)
  expect(res.body).toEqual({ status: 'Submitted' })
  expect(fetchImpl).not.toHaveBeenCalled()
  expect(db.query.mock.calls.some(([sql]) => sql.includes('insert into allstar_clips'))).toBe(false)
})

it.each(['diário', 'total'])('dois POSTs de competição respeitam limite %s de um', async (limite) => {
  let quantidade = 0
  const query = vi.fn(async (sql) => {
    if (sql.includes('from competicoes where id')) return { rows: [{
      id: MATCH, data_inicio: new Date(Date.now() - 86400000), data_fim: new Date(Date.now() + 86400000),
      limite_diario: limite === 'diário' ? 1 : 10, limite_total: limite === 'total' ? 1 : 10,
    }] }
    if (sql.includes('from allstar_clips ac')) return { rows: [{ id: CLIP, steam_id64: EU, played_at: new Date() }] }
    if (sql.includes('count(*) filter')) {
      const n = quantidade
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { rows: [{ hoje: n, total: n }] }
    }
    if (sql.includes('insert into competicao_submissoes')) quantidade++
    return { rows: [] }
  })
  const { db, clientes } = bancoTransacional(query)
  const app = createApp({ config, db })
  const respostas = await Promise.all([CLIP, 'cccccccc-cccc-cccc-cccc-cccccccccccc'].map((allstarClipId) => request(app)
    .post(`/api/competicoes/${MATCH}/submissoes`).set('Cookie', cookie).send({ allstarClipId })))
  expect(respostas.map((r) => r.status).sort()).toEqual([200, 400])
  expect(quantidade).toBe(1)
  expect(clientes.every((c) => c.release.mock.calls.length === 1)).toBe(true)
})
