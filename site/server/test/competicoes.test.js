import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookieJogador = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`
const cookieAdmin = `resenha_token=${signToken({ steamId: '999', isSuperAdmin: true }, config.jwtSecret)}`

function appWith(handlers) {
  const db = {
    query: vi.fn().mockImplementation((sql, params) => {
      if (sql.includes('is_super_admin from players')) return Promise.resolve({ rows: [{ is_super_admin: params?.[0] === '999' }] })
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

  it('sem competicao nenhuma: ativa null, agendadas e encerradas vazios', async () => {
    const { app } = appWith([])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ativa: null, agendadas: [], encerradas: [] })
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

  it('competicao com data_inicio no futuro aparece em agendadas, nao some da resposta', async () => {
    const agora = new Date()
    const { app } = appWith([
      ['from competicoes', [{
        id: 'comp-futura', nome: 'Semana que vem', descricao: '', premio_descricao: 'Skin',
        data_inicio: new Date(agora.getTime() + 86400000), data_fim: new Date(agora.getTime() + 7 * 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 3, vencedor_steam_id64: null,
      }]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body.ativa).toBeNull()
    expect(res.body.encerradas).toEqual([])
    expect(res.body.agendadas).toHaveLength(1)
    expect(res.body.agendadas[0].id).toBe('comp-futura')
  })

  it('inclui premioImagemUrl/premioMercadoUrl na resposta e na query', async () => {
    const agora = new Date()
    const { app, db } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: 'Skin',
        premio_imagem_url: 'https://exemplo.com/ak47.png',
        premio_mercado_url: 'https://steamcommunity.com/market/listings/730/AK-47',
        data_inicio: new Date(agora.getTime() - 86400000), data_fim: new Date(agora.getTime() + 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 3, vencedor_steam_id64: null,
      }]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    expect(res.body.ativa.premioImagemUrl).toBe('https://exemplo.com/ak47.png')
    expect(res.body.ativa.premioMercadoUrl).toBe('https://steamcommunity.com/market/listings/730/AK-47')
    const [sql] = db.query.mock.calls.find(([s]) => s.includes('from competicoes'))
    expect(sql).toContain('premio_imagem_url')
    expect(sql).toContain('premio_mercado_url')
  })

  it('inclui vencedorSubmissoes pro admin quando ha vencedor nao confirmado, com origemNaoVerificada por source', async () => {
    const agora = new Date()
    const { app } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: '',
        data_inicio: new Date(agora.getTime() - 172800000), data_fim: new Date(agora.getTime() - 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 1, vencedor_steam_id64: '999',
        vencedor_confirmado_em: null,
      }]],
      ['m.plataforma_manual', [
        { id: 'clip1', clip_url: 'https://x/clip1', clip_snapshot_url: null, pontuacao_total: 100, pontuacao_detalhe: null, enviado_em: agora, source: 'upload', plataforma_manual: 'gamers_club' },
      ]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieAdmin)
    const comp = res.body.encerradas[0]
    expect(comp.vencedorSubmissoes).toHaveLength(1)
    expect(comp.vencedorSubmissoes[0].origemNaoVerificada).toBe(true)
    expect(comp.vencedorSubmissoes[0].plataformaManual).toBe('gamers_club')
  })

  it('nao inclui vencedorSubmissoes depois que o vencedor ja foi confirmado', async () => {
    const agora = new Date()
    const { app } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: '',
        data_inicio: new Date(agora.getTime() - 172800000), data_fim: new Date(agora.getTime() - 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 1, vencedor_steam_id64: '999',
        vencedor_confirmado_em: agora,
      }]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieAdmin)
    const comp = res.body.encerradas[0]
    expect(comp.vencedorSubmissoes).toBeUndefined()
  })

  it('vencedorSubmissoes nao aparece pra jogador que nao e o vencedor nem admin', async () => {
    const agora = new Date()
    const { app } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: '',
        data_inicio: new Date(agora.getTime() - 172800000), data_fim: new Date(agora.getTime() - 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 1, vencedor_steam_id64: '999',
        vencedor_confirmado_em: null,
      }]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    const comp = res.body.encerradas[0]
    expect(comp.vencedorSubmissoes).toBeUndefined()
  })

  it('clipes recentes trazem o contexto da jogada', async () => {
    const agora = new Date()
    const playedAt = new Date('2026-07-25T00:37:00Z')
    const { app } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: 'Skin',
        data_inicio: new Date(agora.getTime() - 86400000),
        data_fim: new Date(agora.getTime() + 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 3,
        vencedor_steam_id64: null,
      }]],
      ['from competicao_submissoes cs', [{
        id: 'c1', clip_url: 'https://allstar/c1', clip_snapshot_url: 'https://allstar/c1.jpg',
        steam_id64: '765', nick: 'bronze', avatar_url: null,
        map: 'de_inferno', played_at: playedAt, round_number: 18, kind: 'clutch_1v3',
        pontuacao_total: 111, pontuacao_detalhe: { kills: 3, total: 111 },
      }]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)

    const clipe = res.body.ativa.clipesRecentes[0]
    expect(clipe.map).toBe('de_inferno')
    expect(clipe.playedAt).toBe(playedAt.toISOString())
    expect(clipe.roundNumber).toBe(18)
    expect(clipe.kind).toBe('clutch_1v3')
    expect(clipe.nick).toBe('bronze')
    expect(clipe.clipUrl).toBe('https://allstar/c1')
  })

  it('clipe recente sem Highlight correspondente continua na lista, com kind nulo', async () => {
    const agora = new Date()
    const { app } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: 'Skin',
        data_inicio: new Date(agora.getTime() - 86400000),
        data_fim: new Date(agora.getTime() + 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 3,
        vencedor_steam_id64: null,
      }]],
      ['from competicao_submissoes cs', [{
        id: 'c1', clip_url: 'https://allstar/c1', clip_snapshot_url: null,
        steam_id64: '765', nick: 'bronze', avatar_url: null,
        map: 'de_dust2', played_at: new Date(), round_number: 4, kind: null,
        pontuacao_total: 30, pontuacao_detalhe: null,
      }]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)

    expect(res.body.ativa.clipesRecentes).toHaveLength(1)
    expect(res.body.ativa.clipesRecentes[0].kind).toBeNull()
    expect(res.body.ativa.clipesRecentes[0].pontuacao).toEqual({ total: 30 })
  })

  it('o feed usa left join lateral com limit 1 (Jogador com dois Highlights no mesmo round)', async () => {
    const agora = new Date()
    const { app, db } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: 'Skin',
        data_inicio: new Date(agora.getTime() - 86400000),
        data_fim: new Date(agora.getTime() + 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 3,
        vencedor_steam_id64: null,
      }]],
    ])
    await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    // buscarLeaderboard também casa com 'from competicao_submissoes cs' e roda antes
    // de buscarClipesRecentes na mesma requisição — pega a ÚLTIMA ocorrência, que é a
    // query do feed (a do leaderboard não tem lateral nem limit).
    const chamadas = db.query.mock.calls.filter((c) => c[0].includes('from competicao_submissoes cs'))
    const q = chamadas[chamadas.length - 1][0]
    expect(q).toContain('left join lateral')
    expect(q).toContain('limit 1')
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
      premioImagemUrl: 'https://exemplo.com/ak47.png',
      premioMercadoUrl: 'https://steamcommunity.com/market/listings/730/AK-47',
      dataInicio: '2026-08-01T00:00:00Z', dataFim: '2026-08-08T00:00:00Z',
      limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 3,
    })
    expect(res.status).toBe(201)
    const insert = db.query.mock.calls.find(([sql]) => sql.includes('insert into competicoes'))
    expect(insert).toBeTruthy()
    expect(insert[1]).toContain('https://exemplo.com/ak47.png')
    expect(insert[1]).toContain('https://steamcommunity.com/market/listings/730/AK-47')
  })

  it('sem premioImagemUrl/premioMercadoUrl: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieAdmin).send({
      nome: 'X', dataInicio: '2026-08-01T00:00:00Z', dataFim: '2026-08-08T00:00:00Z',
    })
    expect(res.status).toBe(400)
  })

  it('premioMercadoUrl fora do dominio da steam: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieAdmin).send({
      nome: 'X', dataInicio: '2026-08-01T00:00:00Z', dataFim: '2026-08-08T00:00:00Z',
      premioImagemUrl: 'https://exemplo.com/ak47.png',
      premioMercadoUrl: 'https://exemplo.com/market',
    })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/steamcommunity\.com\/market/)
  })

  it('data_fim antes de data_inicio: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieAdmin).send({
      nome: 'X', dataInicio: '2026-08-08T00:00:00Z', dataFim: '2026-08-01T00:00:00Z',
      premioImagemUrl: 'https://exemplo.com/ak47.png',
      premioMercadoUrl: 'https://steamcommunity.com/market/listings/730/AK-47',
    })
    expect(res.status).toBe(400)
  })

  it('limiteDiario negativo: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieAdmin).send({
      nome: 'X', dataInicio: '2026-08-01T00:00:00Z', dataFim: '2026-08-08T00:00:00Z', limiteDiario: -1,
      premioImagemUrl: 'https://exemplo.com/ak47.png',
      premioMercadoUrl: 'https://steamcommunity.com/market/listings/730/AK-47',
    })
    expect(res.status).toBe(400)
  })

  it('limiteTotal fracionario: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieAdmin).send({
      nome: 'X', dataInicio: '2026-08-01T00:00:00Z', dataFim: '2026-08-08T00:00:00Z', limiteTotal: 2.5,
      premioImagemUrl: 'https://exemplo.com/ak47.png',
      premioMercadoUrl: 'https://steamcommunity.com/market/listings/730/AK-47',
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

  it('premioMercadoUrl fora do dominio da steam: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).put(`/api/competicoes/admin/${COMP_ID}`).set('Cookie', cookieAdmin)
      .send({ premioMercadoUrl: 'https://exemplo.com/market' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/steamcommunity\.com\/market/)
  })

  it('premioImagemUrl e premioMercadoUrl validos: atualiza com sucesso', async () => {
    const { app, db } = appWith([
      ['update competicoes set', [{ id: COMP_ID }]],
    ])
    const res = await request(app).put(`/api/competicoes/admin/${COMP_ID}`).set('Cookie', cookieAdmin).send({
      premioImagemUrl: 'https://exemplo.com/ak47.png',
      premioMercadoUrl: 'https://steamcommunity.com/market/listings/730/AK-47',
    })
    expect(res.status).toBe(200)
    const update = db.query.mock.calls.find(([sql]) => sql.includes('update competicoes set'))
    expect(update[1]).toContain('https://exemplo.com/ak47.png')
    expect(update[1]).toContain('https://steamcommunity.com/market/listings/730/AK-47')
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

  const ID = '11111111-1111-1111-1111-111111111111'

  function appComElegiveis(clipes) {
    const agora = new Date()
    return appWith([
      ['from competicoes', [{
        id: 'comp1',
        data_inicio: new Date(agora.getTime() - 86400000),
        data_fim: new Date(agora.getTime() + 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 3,
      }]],
      ['from allstar_clips', clipes],
      ['from competicao_submissoes', [{ hoje: '1', total: '4' }]],
    ])
  }

  it('devolve clipes e limites, com contexto do clipe', async () => {
    const playedAt = new Date('2026-07-25T00:37:00Z')
    const { app } = appComElegiveis([{
      id: 'c1', match_id: 'm1', round_number: 18, map: 'de_inferno',
      played_at: playedAt, kind: 'clutch_1v3',
      clip_url: 'https://allstar/c1?x=1', clip_snapshot_url: 'https://allstar/c1.jpg',
      pontuacao_total: 111, pontuacao_detalhe: { kills: 3, total: 111 },
      ja_enviado: false,
    }])
    const res = await request(app).get(`/api/competicoes/${ID}/elegiveis`).set('Cookie', cookieJogador)

    expect(res.status).toBe(200)
    expect(res.body.clipes).toHaveLength(1)
    expect(res.body.clipes[0]).toEqual({
      allstarClipId: 'c1', matchId: 'm1', roundNumber: 18, map: 'de_inferno',
      playedAt: playedAt.toISOString(), kind: 'clutch_1v3',
      clipUrl: 'https://allstar/c1?x=1', clipSnapshotUrl: 'https://allstar/c1.jpg',
      pontuacao: { kills: 3, total: 111 }, jaEnviado: false,
    })
    expect(res.body.limites).toEqual({
      hoje: 1, limiteDiario: 2, total: 4, limiteTotal: 10, minimoParaRankear: 3,
    })
  })

  it('clipe sem highlight correspondente continua na lista, com kind nulo', async () => {
    // Regressão: clipes do fluxo novo têm highlight_id nulo. Um join INNER faria
    // eles sumirem da lista de elegíveis.
    const { app } = appComElegiveis([{
      id: 'c1', match_id: 'm1', round_number: 18, map: 'de_inferno',
      played_at: new Date(), kind: null,
      clip_url: 'https://allstar/c1', clip_snapshot_url: null,
      pontuacao_total: 30, pontuacao_detalhe: null, ja_enviado: false,
    }])
    const res = await request(app).get(`/api/competicoes/${ID}/elegiveis`).set('Cookie', cookieJogador)

    expect(res.body.clipes).toHaveLength(1)
    expect(res.body.clipes[0].kind).toBeNull()
    expect(res.body.clipes[0].pontuacao).toEqual({ total: 30 })
  })

  it('o join com highlights e LEFT e colapsa em uma linha por clipe', async () => {
    const { app, db } = appComElegiveis([])
    await request(app).get(`/api/competicoes/${ID}/elegiveis`).set('Cookie', cookieJogador)
    const [sql, params] = db.query.mock.calls.find((c) => c[0].includes('from allstar_clips'))
    expect(sql).toContain('left join lateral')
    // sem o limit 1, um round com ace E clutch duplicaria o clipe na lista
    expect(sql).toContain('limit 1')
    // Seguranca: garante que filtra por steamId do token (req.player.steamId), nunca por outro
    expect(params).toContain('765')
  })
})

describe('POST /api/competicoes/:id/submissoes', () => {
  const COMP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const CLIP_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  // Datas RELATIVAS a agora, nunca absolutas: fixtures com '2026-07-01'..'2026-08-01'
  // apodreceram quando o calendário passou de 01/08 — a rota devolvia 400 "encerrada"
  // antes de chegar no caso que cada teste queria exercitar (4 testes quebraram em
  // 2026-08-05 sem nenhuma mudança de código).
  const DIA = 86400000
  const compAtiva = {
    id: COMP_ID,
    data_inicio: new Date(Date.now() - 7 * DIA).toISOString(),
    data_fim: new Date(Date.now() + 7 * DIA).toISOString(),
    limite_diario: 2, limite_total: 10,
  }
  const jogadaDentroDoPeriodo = new Date(Date.now() - 2 * DIA).toISOString()

  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).post(`/api/competicoes/${COMP_ID}/submissoes`)).status).toBe(401)
  })

  it('clipe nao existe ou nao e do proprio jogador: 404', async () => {
    const { app } = appWith([
      ['from competicoes where id', [compAtiva]],
      ['from allstar_clips ac', []], // clipe nao encontrado (ou de outro steamId — mesma query já filtra)
    ])
    const res = await request(app).post(`/api/competicoes/${COMP_ID}/submissoes`).set('Cookie', cookieJogador).send({ allstarClipId: CLIP_ID })
    expect(res.status).toBe(404)
  })

  it('competicao ainda nao comecou: 400', async () => {
    const amanha = new Date(Date.now() + 86400000).toISOString()
    const semana = new Date(Date.now() + 7 * 86400000).toISOString()
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_inicio: amanha, data_fim: semana, limite_diario: 2, limite_total: 10 }]],
    ])
    const res = await request(app).post(`/api/competicoes/${COMP_ID}/submissoes`).set('Cookie', cookieJogador).send({ allstarClipId: CLIP_ID })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/n[ãa]o come[çc]ou/i)
  })

  it('clipe valido dentro do periodo e dos limites: envia com sucesso', async () => {
    const gravados = []
    const db = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (sql.includes('from competicoes where id')) {
          return Promise.resolve({ rows: [compAtiva] })
        }
        if (sql.includes('from allstar_clips ac')) {
          return Promise.resolve({ rows: [{ id: CLIP_ID, steam_id64: '765', status: 'Processed', played_at: jogadaDentroDoPeriodo }] })
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
    // Regressao: allstar_clips.steam_id64 e verificado direto (migracao 0042) - um
    // join (inner) com highlights aqui rejeitaria/404 clipes legitimos do fluxo
    // por-jogador (highlight_id nulo), quebrando o check de ownership pra eles.
    const [sql] = db.query.mock.calls.find(([s]) => s.includes('from allstar_clips ac'))
    expect(sql).not.toContain('join highlights')
  })

  it('limite diario ja atingido: 400', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('from competicoes where id')) {
          return Promise.resolve({ rows: [compAtiva] })
        }
        if (sql.includes('from allstar_clips ac')) {
          return Promise.resolve({ rows: [{ id: CLIP_ID, steam_id64: '765', status: 'Processed', played_at: jogadaDentroDoPeriodo }] })
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
          return Promise.resolve({ rows: [compAtiva] })
        }
        if (sql.includes('from allstar_clips ac')) {
          // Jogada ANTES do início da competição (30 dias atrás vs início há 7) — o
          // caso exercitado é "partida fora do período", com a competição ainda ativa.
          return Promise.resolve({ rows: [{ id: CLIP_ID, steam_id64: '765', status: 'Processed', played_at: new Date(Date.now() - 30 * DIA).toISOString() }] })
        }
        return Promise.resolve({ rows: [] })
      }),
    }
    const app = createApp({ config, db })
    const res = await request(app).post(`/api/competicoes/${COMP_ID}/submissoes`).set('Cookie', cookieJogador).send({ allstarClipId: CLIP_ID })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/per[íi]odo/i)
  })

  it('a contagem do dia usa o fuso de Brasilia, nao o do servidor', async () => {
    const agora = new Date()
    const { app, db } = appWith([
      ['from competicoes', [{
        id: 'comp1',
        data_inicio: new Date(agora.getTime() - 86400000),
        data_fim: new Date(agora.getTime() + 86400000),
        limite_diario: 2, limite_total: 10,
      }]],
      ['from allstar_clips', [{ id: 'c1', played_at: agora }]],
      ['from competicao_submissoes', [{ hoje: '0', total: '0' }]],
    ])
    await request(app)
      .post('/api/competicoes/11111111-1111-1111-1111-111111111111/submissoes')
      .set('Cookie', cookieJogador)
      .send({ allstarClipId: '22222222-2222-2222-2222-222222222222' })

    const contagem = db.query.mock.calls.find((c) => c[0].includes('count(*) filter'))
    expect(contagem[0]).toContain("at time zone 'America/Sao_Paulo'")
    // os DOIS lados da comparação precisam do at time zone — converter só um
    // compararia data de Brasília com data UTC, que é o bug original ao contrário.
    expect(contagem[0].match(/at time zone 'America\/Sao_Paulo'/g)).toHaveLength(2)
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

  it('empate exato: desempata pelo enviado_em da ultima submissao, quem fechou o total mais cedo vence', async () => {
    const { app } = appWith([
      ['from competicoes', [{ id: 'comp1', nome: 'X', data_inicio: '2026-07-01', data_fim: '2026-07-10', limite_diario: 2, limite_total: 10, minimo_para_rankear: 1, vencedor_steam_id64: null }]],
      ['from competicao_submissoes cs join', [
        { competicao_id: 'comp1', steam_id64: '765', nick: 'bronze', avatar_url: null, total: 100, qtd: 1, ultimo_envio: '2026-07-05T12:00:00Z' },
        { competicao_id: 'comp1', steam_id64: '999', nick: 'troya', avatar_url: null, total: 100, qtd: 1, ultimo_envio: '2026-07-03T09:00:00Z' },
      ]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    const comp = res.body.encerradas[0] ?? res.body.ativa
    expect(comp.leaderboard[0].steamId).toBe('999')
    expect(comp.leaderboard[1].steamId).toBe('765')
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

  it('vencedor sem confirmacao do admin: 400', async () => {
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: '2026-07-01', vencedor_steam_id64: '765', vencedor_confirmado_em: null }]],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/tradelink`).set('Cookie', cookieJogador).send({ tradelink: 'https://steamcommunity.com/tradeoffer/x' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/confirma[çc][ãa]o/i)
  })

  it('o proprio vencedor consegue gravar', async () => {
    const { app, db } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: '2026-07-01', vencedor_steam_id64: '765', vencedor_confirmado_em: '2026-07-02T00:00:00Z' }]],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/tradelink`).set('Cookie', cookieJogador).send({ tradelink: 'https://steamcommunity.com/tradeoffer/new/?partner=12345&token=AbC-1_x' })
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

describe('GET /api/competicoes/status', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/competicoes/status')).status).toBe(401)
  })

  it('existe competicao no periodo atual: temAtiva true', async () => {
    const { app } = appWith([
      ['from competicoes where data_inicio', [{ tem_ativa: true, tem_agendada: false }]],
    ])
    const res = await request(app).get('/api/competicoes/status').set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ temAtiva: true, temAgendada: false })
  })

  it('nenhuma competicao no periodo atual nem agendada: tudo false', async () => {
    const { app } = appWith([
      ['from competicoes where data_inicio', [{ tem_ativa: false, tem_agendada: false }]],
    ])
    const res = await request(app).get('/api/competicoes/status').set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ temAtiva: false, temAgendada: false })
  })

  it('competicao agendada (em breve): temAgendada true mesmo sem ativa', async () => {
    const { app } = appWith([
      ['from competicoes where data_inicio', [{ tem_ativa: false, tem_agendada: true }]],
    ])
    const res = await request(app).get('/api/competicoes/status').set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ temAtiva: false, temAgendada: true })
  })
})

describe('PUT /api/competicoes/:id/confirmar-vencedor', () => {
  const COMP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/confirmar-vencedor`).set('Cookie', cookieJogador)
    expect(res.status).toBe(403)
  })

  it('id nao-uuid: 404', async () => {
    const { app } = appWith([])
    const res = await request(app).put('/api/competicoes/abc/confirmar-vencedor').set('Cookie', cookieAdmin)
    expect(res.status).toBe(404)
  })

  it('competicao ainda ativa: 400', async () => {
    const noFuturo = new Date(Date.now() + 86400000).toISOString()
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: noFuturo, vencedor_steam_id64: null, minimo_para_rankear: 1 }]],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/confirmar-vencedor`).set('Cookie', cookieAdmin)
    expect(res.status).toBe(400)
  })

  it('sem vencedor calculado: 400', async () => {
    const noPassado = new Date(Date.now() - 86400000).toISOString()
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: noPassado, vencedor_steam_id64: null, minimo_para_rankear: 1 }]],
      ['from competicao_submissoes cs join', []],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/confirmar-vencedor`).set('Cookie', cookieAdmin)
    expect(res.status).toBe(400)
  })

  it('vencedor calculado: confirma com sucesso', async () => {
    const noPassado = new Date(Date.now() - 86400000).toISOString()
    const { app, db } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: noPassado, vencedor_steam_id64: '765', minimo_para_rankear: 1 }]],
      ['update competicoes set vencedor_confirmado_em', [{ id: COMP_ID }]],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/confirmar-vencedor`).set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    const update = db.query.mock.calls.find(([sql]) => sql.includes('update competicoes set vencedor_confirmado_em'))
    expect(update).toBeTruthy()
  })

  it('confirmar duas vezes: idempotente, sempre 200', async () => {
    const noPassado = new Date(Date.now() - 86400000).toISOString()
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: noPassado, vencedor_steam_id64: '765', minimo_para_rankear: 1 }]],
      ['update competicoes set vencedor_confirmado_em', [{ id: COMP_ID }]],
    ])
    const res1 = await request(app).put(`/api/competicoes/${COMP_ID}/confirmar-vencedor`).set('Cookie', cookieAdmin)
    const res2 = await request(app).put(`/api/competicoes/${COMP_ID}/confirmar-vencedor`).set('Cookie', cookieAdmin)
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
  })
})

describe('GET /api/competicoes/:id/jogador/:steamId/clipes', () => {
  const ID = '11111111-1111-1111-1111-111111111111'

  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get(`/api/competicoes/${ID}/jogador/765/clipes`)).status).toBe(401)
  })

  it('id de steamId invalido (nao numerico): 404', async () => {
    const { app } = appWith([['from competicoes', [{ id: 'comp1' }]]])
    const res = await request(app).get(`/api/competicoes/${ID}/jogador/abc/clipes`).set('Cookie', cookieJogador)
    expect(res.status).toBe(404)
  })

  it('competicao inexistente: 404', async () => {
    const { app } = appWith([])
    const res = await request(app).get(`/api/competicoes/${ID}/jogador/765/clipes`).set('Cookie', cookieJogador)
    expect(res.status).toBe(404)
    expect(res.body.erro).toBe('competição não encontrada')
  })

  it('id nao-uuid: 404', async () => {
    const { app } = appWith([['from competicoes', [{ id: 'comp1' }]]])
    const res = await request(app).get('/api/competicoes/nao-uuid/jogador/765/clipes').set('Cookie', cookieJogador)
    expect(res.status).toBe(404)
    expect(res.body.erro).toBe('competição não encontrada')
  })

  it('devolve os clipes daquele Jogador com o contexto da jogada', async () => {
    const playedAt = new Date('2026-07-25T00:37:00Z')
    const { app, db } = appWith([
      ['from competicoes', [{ id: 'comp1' }]],
      ['from competicao_submissoes cs', [{
        id: 'c1', clip_url: 'https://allstar/c1', clip_snapshot_url: 'https://allstar/c1.jpg',
        map: 'de_inferno', played_at: playedAt, round_number: 18, kind: 'ace',
        pontuacao_total: 111, pontuacao_detalhe: { kills: 3, total: 111 },
      }]],
    ])
    // steamId da URL (888) é diferente do steamId da sessão (cookieJogador é 765) — se a
    // rota usasse req.player.steamId em vez de req.params.steamId, o teste passaria
    // igual, mas a expansão do leaderboard mostraria os clipes errados na tela.
    const res = await request(app).get(`/api/competicoes/${ID}/jogador/888/clipes`).set('Cookie', cookieJogador)

    expect(res.status).toBe(200)
    expect(res.body.clipes).toEqual([{
      id: 'c1', clipUrl: 'https://allstar/c1', clipSnapshotUrl: 'https://allstar/c1.jpg',
      map: 'de_inferno', playedAt: playedAt.toISOString(), roundNumber: 18, kind: 'ace',
      pontuacao: { kills: 3, total: 111 },
    }])
    // escopo: a query filtra pela competição e pelo steamId da URL, nunca pelo da sessão
    const [, params] = db.query.mock.calls.find((c) => c[0].includes('from competicao_submissoes cs'))
    expect(params).toEqual(['comp1', '888'])
  })

  it('NAO devolve os campos de conferencia do admin', async () => {
    // origemNaoVerificada e plataformaManual existem pra o admin checar o vencedor
    // antes de liberar o premio — exibir isso pros competidores foi decidido contra.
    // O mock devolve source/plataforma_manual (snake_case, como viria do Postgres) —
    // travar o shape inteiro da resposta (em vez de só os campos camelCase) garante
    // que um spread acidental da linha crua (que vazaria `source`/`plataforma_manual`)
    // também quebre o teste.
    const { app } = appWith([
      ['from competicoes', [{ id: 'comp1' }]],
      ['from competicao_submissoes cs', [{
        id: 'c1', clip_url: 'https://allstar/c1', clip_snapshot_url: null,
        map: 'de_dust2', played_at: new Date(), round_number: 4, kind: null,
        pontuacao_total: 30, pontuacao_detalhe: null,
        source: 'upload', plataforma_manual: 'faceit',
      }]],
    ])
    const res = await request(app).get(`/api/competicoes/${ID}/jogador/765/clipes`).set('Cookie', cookieJogador)

    expect(res.status).toBe(200)
    expect(Object.keys(res.body.clipes[0]).sort()).toEqual(
      ['clipSnapshotUrl', 'clipUrl', 'id', 'kind', 'map', 'playedAt', 'pontuacao', 'roundNumber'],
    )
    expect(res.body.clipes[0].pontuacao).toEqual({ total: 30 })
  })
})
