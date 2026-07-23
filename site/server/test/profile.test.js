import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const STEAM_ID = '76561198000000009'
const cookie = `resenha_token=${signToken({ steamId: STEAM_ID, isSuperAdmin: false }, config.jwtSecret)}`

function appWith(handlers, { temPresenca = true } = {}) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      // Gate de presença de /:steamId (só responde perfil de jogador visível ao viewer: ele
      // mesmo, um amigo accepted, ou alguém que jogou partida visível ao viewer) — prepended
      // pra casar antes dos handlers de teste, já que a query dele contém trechos que colidem
      // com o needle do fallback de match_players.
      for (const [needle, rows] of [['as tem', [{ tem: temPresenca }]], ...handlers]) {
        if (sql.includes(needle)) return Promise.resolve({ rows })
      }
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/profile/:steamId/posicoes', () => {
  it('projeta coordenadas de mundo pro radar normalizado (0..1) num mapa calibrado', async () => {
    const { app } = appWith([
      ['group by m.map order by n desc', [{ map: 'de_mirage', n: 42 }]],
      ['kp.victim_x as x', [{ x: -3230, y: 1713 }]], // == pos_x/pos_y do mapa -> projeta pro (0,0)
    ])
    const res = await request(app).get('/api/profile/765/posicoes').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      map: 'de_mirage', calibrated: true,
      mapas: [{ map: 'de_mirage', pontos: 42 }],
      pontos: [{ x: 0, y: 0 }],
    })
  })

  it('sem dados: devolve mapa null e listas vazias', async () => {
    const { app } = appWith([['group by m.map order by n desc', []]])
    const res = await request(app).get('/api/profile/765/posicoes').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ map: null, calibrated: false, mapas: [], pontos: [] })
  })

  it('modo=kills troca a coluna de origem (killer, não victim)', async () => {
    const { app } = appWith([
      ['group by m.map order by n desc', [{ map: 'de_dust2', n: 5 }]],
      ['kp.killer_x as x', [{ x: -2476, y: 3239 }]],
    ])
    const res = await request(app).get('/api/profile/765/posicoes?modo=kills').set('Cookie', cookie)
    expect(res.body.pontos).toEqual([{ x: 0, y: 0 }])
  })

  it('visibilidade por amizade: usa o steamId do viewer logado, não X-Group-Id/group_id', async () => {
    const { app, db } = appWith([
      ['group by m.map order by n desc', [{ map: 'de_mirage', n: 1 }]],
      ['kp.victim_x as x', []],
    ])
    await request(app).get('/api/profile/765/posicoes').set('Cookie', cookie)
    const sql = db.query.mock.calls.find((c) => c[0].includes('group by m.map order by n desc'))[0]
    expect(sql).toContain('from friendships f')
    expect(sql).not.toContain('group_id')
    const params = db.query.mock.calls.find((c) => c[0].includes('group by m.map order by n desc'))[1]
    expect(params).toEqual(['765', STEAM_ID])
  })
})

describe('GET /api/profile/:steamId', () => {
  it('404 quando jogador não existe nem em players nem em match_players visíveis ao viewer', async () => {
    const { app } = appWith([['where p.steam_id64 = $1', []]])
    const res = await request(app).get('/api/profile/765').set('Cookie', cookie)
    expect(res.status).toBe(404)
  })

  it('adversário sem onboarding: monta perfil com nick do match_players (fallback)', async () => {
    const { app } = appWith([
      ['where p.steam_id64 = $1', []],
      ['mp.nick, sa.avatar_url', [{ nick: 'adversario', avatar_url: 'https://cache/x.jpg' }]],
      ['count(*)::int as partidas', [{
        partidas: 1, vitorias: 0, kills: 10, deaths: 15, assists: 2, hs: 3, damage: 1200, rounds: 22, rating: '0.85',
        he_thrown: 0, he_damage: 0, he_team_damage: 0, molotovs_thrown: 0, molotov_damage: 0, molotov_team_damage: 0,
        flashes_thrown: 0, enemies_flashed: 0, enemy_flash_duration: '0', flash_assists: 0,
        enemy_flash_landed_count: 0, enemy_flash_landed_duration_sum: '0',
      }]],
    ])
    const res = await request(app).get('/api/profile/765').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.jogador).toEqual({ steamId: '765', nick: 'adversario', avatarUrl: 'https://cache/x.jpg', faceitNick: null, faceitElo: null, faceitSkillLevel: null })
  })

  it('amigo accepted com ZERO partidas registradas ainda vê o perfil (gate não é só participação)', async () => {
    // Caso novo (Task 7): o gate de presença tem 3 cláusulas — é o próprio viewer, OU tem
    // amizade accepted com o alvo (mesmo sem NENHUMA partida em comum registrada ainda), OU
    // jogou em alguma partida visível ao viewer. Sem a segunda cláusula, adicionar um amigo
    // recém-conhecido (sem partida coletada ainda) daria 404 ao abrir o perfil dele.
    const { app, db } = appWith([
      ['where p.steam_id64 = $1', [{ steam_id64: '765', nick: 'novato', avatar_url: null, faceit_nick: null, faceit_elo: null, faceit_skill_level: null }]],
      ['group by mp.steam_id64', []],
      ['group by m.map', []],
      ['from match_players mp1', []],
      ['mp.rating is not null', []],
      ['mp.won from match_players', []],
      ['from highlights h join matches m on m.id = h.match_id', []],
      ['from match_player_weapons w join matches m', []],
      ['join match_round_econ e on e.match_id', []],
      ['count(*)::int as partidas', [{
        partidas: 0, vitorias: 0, kills: 0, deaths: 0, assists: 0, hs: 0, damage: 0, rounds: 0, rating: null,
        he_thrown: 0, he_damage: 0, he_team_damage: 0, molotovs_thrown: 0, molotov_damage: 0, molotov_team_damage: 0,
        flashes_thrown: 0, enemies_flashed: 0, enemy_flash_duration: '0', flash_assists: 0,
        enemy_flash_landed_count: 0, enemy_flash_landed_duration_sum: '0',
      }]],
    ])
    const res = await request(app).get('/api/profile/765').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.jogador.nick).toBe('novato')
    expect(res.body.stats.partidas).toBe(0)
    expect(res.body.recentes).toEqual([])
    expect(res.body.sinergia).toEqual([])
    expect(res.body.destaques).toEqual([])
    // Confirma que a query do gate tem as 3 cláusulas: self, amizade accepted, e participação.
    const presencaSql = db.query.mock.calls.find((c) => c[0].includes('as tem'))[0]
    expect(presencaSql).toContain('$1 = $2')
    expect(presencaSql).toContain('from friendships f')
    expect(presencaSql).toContain("f.status = 'accepted'")
    expect(presencaSql).toContain('from match_players mp join matches m')
    expect(presencaSql).not.toContain('group_members')
    expect(presencaSql).not.toContain('group_id')
  })

  it('agrega stats, winrate, ADR, HS% e sinergia', async () => {
    const { app } = appWith([
      ['where p.steam_id64 = $1', [{ steam_id64: '765', nick: 'fih', avatar_url: null, is_admin: false, faceit_nick: 'bronzeadoo', faceit_elo: 1425, faceit_skill_level: 7 }]],
      // Sinergia agora recomputada de match_players (mp1) — precisa vir ANTES de
      // 'count(*)::int as partidas', que a query de sinergia também contém.
      ['from match_players mp1', [{ steam_id64: '999', nick: 'parça', avatar_url: null, partidas: 8, vitorias: 6 }]],
      // Precisa vir ANTES de 'count(*)::int as partidas' — o texto dessa query também
      // contém aquele trecho, e o mock casa pelo primeiro needle que bater.
      ['group by mp.steam_id64', [
        { steam_id64: '765', partidas: 10, entry_kills: 30, entry_deaths: 5, utility_damage: 200, rounds: 200, clutch_wins: 2, clutch_attempts: 3, shots_fired: 300, shots_hit: 90 },
        { steam_id64: '999', partidas: 10, entry_kills: 2, entry_deaths: 2, utility_damage: 50, rounds: 200, clutch_wins: 0, clutch_attempts: 1, shots_fired: 300, shots_hit: 60 },
      ]],
      ['count(*)::int as partidas', [{
        partidas: 10, vitorias: 6, kills: 200, deaths: 150, assists: 40, hs: 100, damage: 3300, rounds: 220, rating: '1.15',
        he_thrown: 20, he_damage: 800, he_team_damage: 100,
        molotovs_thrown: 10, molotov_damage: 300, molotov_team_damage: 50,
        flashes_thrown: 40, enemies_flashed: 30, enemy_flash_duration: '90',
        flash_assists: 8, enemy_flash_landed_count: 20, enemy_flash_landed_duration_sum: '60',
      }]],
      ['group by m.map', [{ map: 'de_mirage', partidas: 5, vitorias: 3, rating: '1.2' }]],
      ['m.score_a, m.score_b', [{ id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9, kills: 20, deaths: 15, rating: '1.1', won: true, premier_rating_before: 15420, premier_rating_after: 15480, source: 'faceit' }]],
      ['mp.premier_rating_after is not null', [{ premier_rating_after: 16250 }]],
      ['mp.rating is not null', [{ id: 'm1', played_at: null, rating: '1.1' }, { id: 'm2', played_at: null, rating: '1.4' }]],
      ['mp.won from match_players', [{ won: true }, { won: true }, { won: false }, { won: true }]],
      ['from highlights h join matches m on m.id = h.match_id', [
        { id: 'h1', match_id: 'm1', round_number: 3, kind: 'clutch_1v2', description: 'CLUTCH 1v2 no round 3', map: 'de_mirage', played_at: null },
      ]],
      ['from match_player_weapons w join matches m', [
        { weapon: 'ak47', kills: 20, hs_kills: 8, shots_fired: 150, shots_hit: 45, damage: 2500 },
        { weapon: 'awp', kills: 5, hs_kills: 4, shots_fired: 10, shots_hit: 6, damage: 700 },
      ]],
      ['join match_round_econ e on e.match_id', [
        { buy_type: 'full', rounds: 15, won: 10 },
        { buy_type: 'eco', rounds: 3, won: 1 },
      ]],
    ])
    const res = await request(app).get('/api/profile/765').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.jogador).toMatchObject({ nick: 'fih', faceitNick: 'bronzeadoo', faceitElo: 1425, faceitSkillLevel: 7 })
    expect(res.body.stats).toMatchObject({ partidas: 10, vitorias: 6, winrate: 60, kills: 200 })
    expect(res.body.stats.kd).toBeCloseTo(1.33, 2)
    expect(res.body.stats.hsPct).toBe(50)
    expect(res.body.stats.adr).toBe(15) // 3300/220
    // comparação com o Leetify (2026-07-11): dano de HE/molotov em inimigo vs time,
    // flash assists, e as médias por arremesso (não por partida).
    expect(res.body.stats.heTeamDamage).toBe(100)
    expect(res.body.stats.molotovTeamDamage).toBe(50)
    expect(res.body.stats.flashAssists).toBe(8)
    expect(res.body.stats.flashAssistPct).toBe(20) // 8/40
    expect(res.body.stats.avgHeDamage).toBe(40) // 800/20
    expect(res.body.stats.avgMolotovDamage).toBe(30) // 300/10
    expect(res.body.stats.avgBlindDuration).toBe(3) // 60/20 (landed_count/duration, não enemies_flashed)
    expect(res.body.sinergia[0]).toMatchObject({ nick: 'parça', partidas: 8, vitorias: 6, winrate: 75 })
    // fixture simula "order by played_at desc" (m1 é o mais recente); evolucaoRating inverte pra cronológico
    expect(res.body.evolucao).toEqual([{ matchId: 'm2', playedAt: null, rating: 1.4 }, { matchId: 'm1', playedAt: null, rating: 1.1 }])
    // classificação exata (qual dimensão vence) já é coberta em analise.test.js;
    // aqui só confere que o endpoint calcula e devolve alguma coisa.
    expect(res.body.estilo).not.toBeNull()
    // melhor sequência do fixture [true,true,false,true] = 2
    expect(res.body.badges.map((b) => b.tag)).not.toContain('sequencia_5')
    // "em qual partida foi esse clutch mesmo?" — lista de highlights com o matchId pra linkar
    expect(res.body.destaques).toEqual([
      { id: 'h1', matchId: 'm1', roundNumber: 3, kind: 'clutch_1v2', description: 'CLUTCH 1v2 no round 3', map: 'de_mirage', playedAt: null },
    ])
    // por-arma: agregação SUM (nunca média de %), AWP marcada como accuracy não confiável
    expect(res.body.armas).toEqual([
      { weapon: 'ak47', kills: 20, hsPct: 40, shotsFired: 150, shotsHit: 45, accuracy: 30, temAccuracyConfiavel: true, damage: 2500 },
      { weapon: 'awp', kills: 5, hsPct: 80, shotsFired: 10, shotsHit: 6, accuracy: 60, temAccuracyConfiavel: false, damage: 700 },
    ])
    // economia: win% por tipo de compra, com os 4 tipos sempre presentes (zerados se não jogou)
    expect(res.body.economia).toEqual({
      eco: { rounds: 3, won: 1, winPct: 33.3 },
      forcado: { rounds: 0, won: 0, winPct: 0 },
      semi: { rounds: 0, won: 0, winPct: 0 },
      full: { rounds: 15, won: 10, winPct: 66.7 },
    })
    // premierAtual: Premier rating mais recente de TODO o histórico (sem filtro de período/mesma
    // convenção dos badges), separado do premierBefore/After por partida em recentes[].
    expect(res.body.premierAtual).toBe(16250)
    expect(res.body.recentes[0]).toMatchObject({ premierBefore: 15420, premierAfter: 15480, source: 'faceit' })
    // Sem seção "perfilPublico" — o modo ?publico=1 foi removido (Task 7); toda visão de
    // perfil é escopada pela rede de amizade do viewer, sem exceção.
    expect(res.body.perfilPublico).toBeUndefined()
  })

  it('sem Premier rating registrado: premierAtual e recentes[].premierBefore/After vêm null', async () => {
    const { app } = appWith([
      ['where p.steam_id64 = $1', [{ steam_id64: '765', nick: 'fih', avatar_url: null }]],
      ['group by mp.steam_id64', [
        { steam_id64: '765', partidas: 10, entry_kills: 30, entry_deaths: 5, utility_damage: 200, rounds: 200, clutch_wins: 2, clutch_attempts: 3, shots_fired: 300, shots_hit: 90 },
      ]],
      ['count(*)::int as partidas', [{
        partidas: 10, vitorias: 6, kills: 200, deaths: 150, assists: 40, hs: 100, damage: 3300, rounds: 220, rating: '1.15',
        he_thrown: 20, he_damage: 800, he_team_damage: 100,
        molotovs_thrown: 10, molotov_damage: 300, molotov_team_damage: 50,
        flashes_thrown: 40, enemies_flashed: 30, enemy_flash_duration: '90',
        flash_assists: 8, enemy_flash_landed_count: 20, enemy_flash_landed_duration_sum: '60',
      }]],
      ['group by m.map', [{ map: 'de_mirage', partidas: 5, vitorias: 3, rating: '1.2' }]],
      // Partida antiga (coletada antes da Task 2): recentes vem sem premier_rating_before/after.
      ['m.score_a, m.score_b', [{ id: 'm1', map: 'de_mirage', played_at: null, score_a: 13, score_b: 9, kills: 20, deaths: 15, rating: '1.1', won: true }]],
      ['from match_players mp1', []],
      ['mp.rating is not null', []],
      ['mp.won from match_players', [{ won: true }]],
      ['from highlights h join matches m on m.id = h.match_id', []],
      ['from match_player_weapons w join matches m', []],
      ['join match_round_econ e on e.match_id', []],
      // Sem handler pra 'mp.premier_rating_after is not null' -> cai no default (rows: []).
    ])
    const res = await request(app).get('/api/profile/765').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.premierAtual).toBeNull()
    expect(res.body.recentes[0]).toMatchObject({ premierBefore: null, premierAfter: null })
  })
})

describe('GET /api/profile/compare', () => {
  it('400 quando os dois steamId não são válidos ou são iguais', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/profile/compare?a=1&b=2').set('Cookie', cookie)).status).toBe(400)
    expect((await request(app).get('/api/profile/compare?a=76561198000000001&b=76561198000000001').set('Cookie', cookie)).status).toBe(400)
  })

  it('404 quando algum dos dois não é Jogador', async () => {
    const { app } = appWith([
      ['where p.steam_id64 in', [{ steam_id64: '76561198000000001', nick: 'fih', avatar_url: null }]],
    ])
    const res = await request(app)
      .get('/api/profile/compare?a=76561198000000001&b=76561198000000002')
      .set('Cookie', cookie)
    expect(res.status).toBe(404)
  })

  it('404 quando um dos dois existe em players mas não é visível ao viewer (não é amigo accepted nem participa de partida visível)', async () => {
    const a = STEAM_ID // o próprio viewer
    const b = '76561198000000099' // linha válida em players, mas fora da rede de amizade
    const { app } = appWith([
      ['where p.steam_id64 in', [
        { steam_id64: a, nick: 'fih', avatar_url: null },
        { steam_id64: b, nick: 'estranho', avatar_url: null },
      ]],
    ], { temPresenca: false })
    const res = await request(app)
      .get(`/api/profile/compare?a=${a}&b=${b}`)
      .set('Cookie', cookie)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ erro: 'Jogador não encontrado' })
  })

  it('compara stats e monta o confronto direto (mesmo time / times opostos)', async () => {
    const a = '76561198000000001'
    const b = '76561198000000002'
    const { app, db } = appWith([
      ['where p.steam_id64 in', [
        { steam_id64: a, nick: 'fih', avatar_url: null },
        { steam_id64: b, nick: 'bronze', avatar_url: null },
      ]],
      ['count(*)::int as partidas', [{ partidas: 10, vitorias: 6, kills: 200, deaths: 150, assists: 40, hs: 100, damage: 3300, rounds: 220, rating: '1.15' }]],
      ['mp.rating is not null', []],
      ['join match_players mp_b', [
        { team_a: 'A', team_b: 'A', a_venceu: true },  // mesmo time, vitória
        { team_a: 'A', team_b: 'B', a_venceu: true },  // times opostos, a venceu
        { team_a: 'B', team_b: 'A', a_venceu: false }, // times opostos, b venceu
      ]],
    ])
    const res = await request(app).get(`/api/profile/compare?a=${a}&b=${b}`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.a).toMatchObject({ nick: 'fih', stats: { partidas: 10 } })
    expect(res.body.b).toMatchObject({ nick: 'bronze', stats: { partidas: 10 } })
    expect(res.body.confronto).toEqual({
      partidasJuntos: 3, mesmoTime: 1, mesmoTimeVitorias: 1, timesOpostos: 2, aVenceu: 1, bVenceu: 1,
    })
    // Confronto escopado por amizade (visivelWhere -> friendships.js), não group_id.
    const confrontoSql = db.query.mock.calls.find((c) => c[0].includes('join match_players mp_b'))[0]
    expect(confrontoSql).toContain('from friendships f')
    expect(confrontoSql).not.toContain('group_id')
  })
})
