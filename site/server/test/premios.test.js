import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'
import { calcularPremios, janelaDoPeriodo } from '../src/premios.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const VIEWER = '76561198000000009'
const cookie = `resenha_token=${signToken({ steamId: VIEWER, isSuperAdmin: false }, config.jwtSecret)}`

const base = {
  map: 'de_nuke', duration_seconds: 1800, avatar_url: null, team: 'A', won: true,
  kills: 20, deaths: 15, headshot_kills: 10, rating: 1, clutch_wins: 0, utility_damage: 100,
  team_kills: 0, he_team_damage: 0, molotov_team_damage: 0, teammates_flashed: 0,
  teammate_flash_duration: 0, traded_deaths: 5,
}
const r = (match_id, steam_id64, nick, extra = {}) => ({ ...base, match_id, steam_id64, nick, ...extra })

describe('janelaDoPeriodo', () => {
  it('semana começa na segunda e só tem "próximo" se já passou', () => {
    // 2026-10-14 é quarta.
    expect(janelaDoPeriodo('semana', '2026-10-14', '2026-10-16')).toEqual({
      tipo: 'semana', inicio: '2026-10-12', fim: '2026-10-19', anterior: '2026-10-05', proximo: null,
    })
    expect(janelaDoPeriodo('semana', '2026-10-04', '2026-10-16').proximo).toBe('2026-10-05')
  })

  it('mês de calendário; ref inválida cai em hoje', () => {
    expect(janelaDoPeriodo('mes', '2026-09-30', '2026-10-16')).toEqual({
      tipo: 'mes', inicio: '2026-09-01', fim: '2026-10-01', anterior: '2026-08-01', proximo: '2026-10-01',
    })
    expect(janelaDoPeriodo('mes', '2026-02-31', '2026-10-16').inicio).toBe('2026-10-01')
    expect(janelaDoPeriodo('mes', "1'; drop", '2026-10-16').inicio).toBe('2026-10-01')
  })
})

describe('calcularPremios', () => {
  it('calcula prêmios, dupla, mapa maldito e números do período', () => {
    const linhas = [
      // m1 Nuke: derrota do grupo
      r('m1', 'a', 'toguro', { won: false, rating: 1.4, clutch_wins: 2, clutch_attempts: 5, team: 'A' }),
      r('m1', 'b', 'zezinho', { won: false, rating: 0.8, he_team_damage: 80, team_kills: 1, team: 'A' }),
      // m2 Nuke: derrota
      r('m2', 'a', 'toguro', { won: false, rating: 1.2, team: 'A' }),
      r('m2', 'b', 'zezinho', { won: false, rating: 0.7, teammates_flashed: 3, teammate_flash_duration: 6.5, team: 'A' }),
      // m3 Mirage: vitória
      r('m3', 'a', 'toguro', { map: 'de_mirage', rating: 1.3, utility_damage: 400, team: 'B' }),
      r('m3', 'b', 'zezinho', { map: 'de_mirage', rating: 0.9, headshot_kills: 2, kills: 12, team: 'B' }),
      // m4 Mirage: vitória
      r('m4', 'a', 'toguro', { map: 'de_mirage', rating: 1.1, team: 'A' }),
      r('m4', 'b', 'zezinho', { map: 'de_mirage', rating: 1.0, deaths: 20, traded_deaths: 0, team: 'A' }),
    ]
    const { numeros, premios } = calcularPremios(linhas, 'semana')
    expect(numeros).toEqual({ partidas: 4, horas: 2, vitorias: 2, derrotas: 2, winrate: 50, clutches: 2 })
    const p = Object.fromEntries(premios.map((x) => [x.id, x]))
    expect(p.carregou).toMatchObject({ valor: 1.25, descricao: 'Rating médio em 4 partidas (mín. 2)', jogadores: [{ steamId: 'a', nick: 'toguro' }] })
    // Total do período, com o nº de Partidas na descrição: 2 clutches; 80 de dano + 1 TK × 100; 6,5 s.
    expect(p.clutch).toMatchObject({ valor: 2, descricao: 'Venceu 2 de 5 tentativas, em 4 partidas', jogadores: [{ steamId: 'a' }] })
    expect(p.granadeiro).toMatchObject({ valor: 175, jogadores: [{ steamId: 'a' }] })
    expect(p['fogo-amigo']).toMatchObject({ valor: 180, jogadores: [{ steamId: 'b' }], tom: 'ruim' })
    expect(p['fogo-amigo'].descricao).toBe('80 de dano + 1 TK × 100, em 4 partidas com Demo')
    expect(p.granadeiro.descricao).toBe('Média em 4 partidas (700 de dano no total)')
    expect(p.alface.descricao).toBe('32 HS em 72 kills (mín. 30 kills)')
    expect(p.flashador).toMatchObject({ valor: 6.5, jogadores: [{ steamId: 'b' }] })
    expect(p.baiter.jogadores[0].steamId).toBe('b')
    expect(p.alface).toMatchObject({ jogadores: [{ steamId: 'b' }] })
    expect(p.dupla).toMatchObject({ valor: 50, jogadores: [{ steamId: 'a' }, { steamId: 'b' }] })
    expect(p['mapa-maldito']).toMatchObject({ mapa: 'de_nuke', valor: 0 })
  })

  it('sem partidas: números zerados e nenhum prêmio', () => {
    expect(calcularPremios([], 'mes')).toEqual({
      numeros: { partidas: 0, horas: null, vitorias: 0, derrotas: 0, winrate: null, clutches: 0 },
      premios: [],
    })
  })

  it('sem duração gravada: horas é null, não 0h', () => {
    const linhas = [r('m1', 'a', 'toguro', { duration_seconds: null }), r('m2', 'a', 'toguro', { duration_seconds: null })]
    expect(calcularPremios(linhas, 'semana').numeros.horas).toBeNull()
  })

  it('Baiter ignora Partida sem Demo (traded_deaths vem 0 por default)', () => {
    const linhas = [
      // a: 2 Partidas com Demo, 10 mortes sem trade cada; 2 FACEIT só com stats (20 mortes, traded 0)
      r('m1', 'a', 'toguro', { deaths: 15, traded_deaths: 5 }),
      r('m2', 'a', 'toguro', { deaths: 15, traded_deaths: 5 }),
      r('m3', 'a', 'toguro', { deaths: 20, traded_deaths: 0, tem_demo: false }),
      r('m4', 'a', 'toguro', { deaths: 20, traded_deaths: 0, tem_demo: false }),
    ]
    const baiter = calcularPremios(linhas, 'semana').premios.find((p) => p.id === 'baiter')
    expect(baiter).toMatchObject({ valor: 10, descricao: '20 de 30 mortes sem trade, em 2 partidas com Demo' })
  })

  it('Fogo amigo e Flashador contam na escala só as Partidas com Demo', () => {
    const linhas = [
      r('m1', 'a', 'toguro', { he_team_damage: 50, teammates_flashed: 1, teammate_flash_duration: 2 }),
      r('m2', 'a', 'toguro', { tem_demo: false }),
      r('m3', 'a', 'toguro', { tem_demo: false }),
    ]
    const p = Object.fromEntries(calcularPremios(linhas, 'semana').premios.map((x) => [x.id, x]))
    expect(p['fogo-amigo']).toMatchObject({ valor: 50, descricao: '50 de dano + 0 TK × 100, em 1 partida com Demo' })
    expect(p.flashador).toMatchObject({ valor: 2, descricao: 'Cegou colegas 1 vez, em 1 partida com Demo' })
  })

  it('Carregou exige o mínimo de Partidas COM rating', () => {
    const linhas = [
      // b: 1 Partida com rating 2.0 e 3 sem rating (FACEIT só stats) — não pode carregar
      r('m1', 'b', 'zezinho', { rating: 2 }),
      r('m2', 'b', 'zezinho', { rating: null, tem_demo: false }),
      r('m3', 'b', 'zezinho', { rating: null, tem_demo: false }),
      r('m4', 'b', 'zezinho', { rating: null, tem_demo: false }),
      r('m1', 'a', 'toguro', { rating: 1.1 }),
      r('m2', 'a', 'toguro', { rating: 1.1 }),
    ]
    const carregou = calcularPremios(linhas, 'semana').premios.find((p) => p.id === 'carregou')
    expect(carregou.jogadores[0].steamId).toBe('a')
  })
})

describe('GET /api/premios', () => {
  function appWith(rows) {
    const db = { query: vi.fn().mockResolvedValue({ rows }) }
    return { app: createApp({ config, db }), db }
  }

  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/premios')).status).toBe(401)
  })

  it('mês com ref: params com datas, viewer, círculo de amizade e visibilidade', async () => {
    const { app, db } = appWith([r('m1', VIEWER, 'eu')])
    const res = await request(app).get('/api/premios?periodo=mes&ref=2026-09-10').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.periodo).toMatchObject({ tipo: 'mes', inicio: '2026-09-01', fim: '2026-10-01' })
    expect(res.body.numeros.partidas).toBe(1)
    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes('from matches m'))
    expect(params).toEqual([VIEWER, '2026-09-01', '2026-10-01'])
    expect(sql).toContain("f.status = 'accepted'")
    expect(sql).toContain('from match_players mv')
    expect(sql).not.toContain('2026-09')
  })
})
