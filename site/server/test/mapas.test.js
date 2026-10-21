import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { separarPeriodos, montarMapas, ladoDoTime } from '../src/mapas.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const VIEWER = '76561198000000009'
const cookie = `resenha_token=${signToken({ steamId: VIEWER, isSuperAdmin: false }, config.jwtSecret)}`

function partida(i, extra = {}) {
  // i=0 é a mais recente; uma por dia, a partir de 2026-10-01 pra trás, sempre às 22h30
  // de Brasília (01h30 UTC do dia seguinte): o dia do filtro é o de Brasília, não o UTC.
  const d = new Date(Date.UTC(2026, 9, 2, 1, 30) - i * 86400000)
  return { id: `p${i}`, map: 'de_mirage', playedAt: d.toISOString(), team: 'A', won: true, scoreA: 13, scoreB: 5, ...extra }
}

describe('separarPeriodos', () => {
  it('padrão: últimas 30 vs 30 anteriores', () => {
    const lista = Array.from({ length: 70 }, (_, i) => partida(i))
    const r = separarPeriodos(lista, {})
    expect(r.modo).toBe('partidas')
    expect(r.atual).toHaveLength(30)
    expect(r.anterior).toHaveLength(30)
    expect(r.atual[0].id).toBe('p0')
    expect(r.anterior[0].id).toBe('p30')
    expect(r.intervaloAtual.ate).toBe('2026-10-01')
  })

  it('por datas: comparação padrão é a janela do mesmo tamanho logo antes', () => {
    const lista = Array.from({ length: 30 }, (_, i) => partida(i))
    const r = separarPeriodos(lista, { de: '2026-09-25', ate: '2026-10-01' })
    expect(r.modo).toBe('datas')
    expect(r.atual).toHaveLength(7)
    expect(r.intervaloAnterior).toEqual({ de: '2026-09-18', ate: '2026-09-24' })
    expect(r.anterior).toHaveLength(7)
  })

  it('por datas com comparação explícita', () => {
    const lista = Array.from({ length: 31 }, (_, i) => partida(i))
    const r = separarPeriodos(lista, { de: '2026-09-30', ate: '2026-10-01', compararDe: '2026-09-01', compararAte: '2026-09-01' })
    expect(r.atual).toHaveLength(2)
    expect(r.anterior.map((p) => p.id)).toEqual(['p30'])
  })

  it('data inválida é ignorada', () => {
    const r = separarPeriodos([partida(0)], { de: "2026-13-99'; drop" })
    expect(r.modo).toBe('partidas')
  })
})

describe('ladoDoTime', () => {
  it('time B fica no lado oposto ao side_a', () => {
    expect(ladoDoTime('A', 'CT')).toBe('CT')
    expect(ladoDoTime('B', 'CT')).toBe('T')
    expect(ladoDoTime('B', null)).toBeNull()
  })
})

describe('montarMapas', () => {
  it('winrate, saldo, variação vs anterior e lados com média do grupo', () => {
    const partidas = [
      ...Array.from({ length: 30 }, (_, i) => partida(i, { won: i % 2 === 0 })), // 15V 15D no atual
      ...Array.from({ length: 30 }, (_, i) => partida(30 + i, { won: i < 10 })), // 10V no anterior
    ]
    partidas[1] = { ...partidas[1], scoreA: 12, scoreB: 12, won: false } // um empate no atual
    const rounds = [
      { matchId: 'p0', sideA: 'CT', winnerTeam: 'A' },
      { matchId: 'p0', sideA: 'CT', winnerTeam: 'B' },
      { matchId: 'p0', sideA: 'T', winnerTeam: 'A' },
      { matchId: 'p40', sideA: 'T', winnerTeam: 'B' },
    ]
    const grupo = [{ map: 'de_mirage', lado: 'CT', rounds: 10, vitorias: 6 }]
    const r = montarMapas({ partidas, rounds, grupo, filtros: {} })
    const m = r.mapas[0]
    // Empate fica fora da winrate (agregados.js): 15 / (15 + 14).
    expect(m).toMatchObject({ map: 'de_mirage', partidas: 30, vitorias: 15, empates: 1, derrotas: 14, winrate: 51.7 })
    expect(m.anterior).toEqual({ partidas: 30, winrate: 33.3 })
    expect(m.variacao).toBe(18.4)
    expect(m.lados.CT).toEqual({ atual: 50, rounds: 2, anterior: null, grupo: 60 })
    expect(m.lados.T).toMatchObject({ atual: 100, anterior: 0, grupo: null })
    expect(r.periodo.atual.partidas).toBe(30)
  })

  it('ordena por partidas no período atual', () => {
    const partidas = [partida(0, { map: 'de_nuke' }), partida(1), partida(2)]
    const r = montarMapas({ partidas, rounds: [], grupo: [], filtros: {} })
    expect(r.mapas.map((m) => m.map)).toEqual(['de_mirage', 'de_nuke'])
    expect(r.mapas[0].variacao).toBeNull()
  })
})

describe('GET /api/mapas', () => {
  function appCom(respostas) {
    const db = {
      query: vi.fn(async (sql) => {
        for (const [trecho, rows] of respostas) if (sql.includes(trecho)) return { rows }
        return { rows: [] }
      }),
    }
    return { app: createApp({ config, db }), db }
  }

  it('sem login: 401', async () => {
    const { app } = appCom([])
    expect((await request(app).get('/api/mapas')).status).toBe(401)
  })

  it('jogador inválido: 400', async () => {
    const { app } = appCom([])
    expect((await request(app).get('/api/mapas?jogador=x').set('Cookie', cookie)).status).toBe(400)
  })

  it('padrão é o viewer, com visibilidade por amizade', async () => {
    const { app, db } = appCom([
      ['from match_players mp join matches m', [
        { id: 'a', map: 'de_mirage', played_at: '2026-10-01T20:00:00Z', score_a: 13, score_b: 7, team: 'A', won: true },
      ]],
      ['winner_team from rounds', [{ match_id: 'a', side_a: 'CT', winner_team: 'A' }]],
      ['select distinct mp.match_id', [{ map: 'de_mirage', lado: 'CT', rounds: 4, vitorias: 1 }, { map: 'de_mirage', lado: null, rounds: 1, vitorias: 0 }]],
    ])
    const res = await request(app).get('/api/mapas').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.jogador).toBe(VIEWER)
    expect(res.body.mapas[0]).toMatchObject({ map: 'de_mirage', partidas: 1, winrate: 100 })
    expect(res.body.mapas[0].lados.CT).toMatchObject({ atual: 100, grupo: 25 })
    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes('from match_players mp join matches m'))
    expect(sql).toContain('from friendships f')
    expect(params).toEqual([VIEWER, VIEWER])
    const [, gParams] = db.query.mock.calls.find(([s]) => s.includes('select distinct mp.match_id'))
    expect(gParams).toEqual([VIEWER, '2026-10-01', '2026-10-01'])
  })

  it('outro jogador vai como parâmetro, não interpolado', async () => {
    const { app, db } = appCom([])
    const outro = '76561198000000001'
    const res = await request(app).get(`/api/mapas?jogador=${outro}&de=2026-09-01&ate=2026-09-30`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.mapas).toEqual([])
    expect(res.body.periodo.modo).toBe('datas')
    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes('from match_players mp join matches m'))
    expect(sql).not.toContain(outro)
    expect(params).toEqual([outro, VIEWER])
  })
})
