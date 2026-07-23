import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookieJogador = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`
const cookieAdmin = `resenha_token=${signToken({ steamId: '999', isSuperAdmin: true }, config.jwtSecret)}`

function appWith(handlers) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('is_super_admin from players')) {
        return Promise.resolve({ rows: [{ is_super_admin: true }] })
      }
      for (const [needle, rows] of handlers) {
        if (sql.includes(needle)) return Promise.resolve({ rows })
      }
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db, r2Client: null }), db }
}

const LINHA = {
  id: 'g1', map: 'de_mirage', lado: 'T', tipo: 'smoke', titulo: 'Smoke janela',
  descricao: 'da base', video_url: 'https://youtu.be/abcdefghijk', tecnica: 'jumpthrow',
  botao: 'esquerdo', passos: ['mire no pixel', 'jumpthrow'], arremesso_x: '0.2',
  arremesso_y: '0.8', alvo_x: '0.4', alvo_y: '0.3', criado_por: '999',
  criado_em: '2026-07-13T00:00:00Z',
}

describe('GET /api/granadas', () => {
  it('anonimo: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/granadas')).status).toBe(401)
  })

  it('jogador comum: 200 (leitura e publica, so escrita e admin)', async () => {
    const { app } = appWith([['from lineups_curados', [LINHA]]])
    expect((await request(app).get('/api/granadas').set('Cookie', cookieJogador)).status).toBe(200)
  })

  it('admin lista com filtros validados e camelCase', async () => {
    const { app, db } = appWith([['from lineups_curados', [LINHA]]])
    const res = await request(app)
      .get('/api/granadas?map=de_mirage&lado=T&tipo=smoke')
      .set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({
      id: 'g1', videoUrl: 'https://youtu.be/abcdefghijk', arremessoX: 0.2, alvoY: 0.3,
      passos: ['mire no pixel', 'jumpthrow'], tecnica: 'jumpthrow',
    })
    const chamada = db.query.mock.calls.find(([sql]) => sql.includes('from lineups_curados'))
    expect(chamada[1]).toEqual(['de_mirage', 'T', 'smoke'])
  })

  it('filtro invalido e ignorado (nao vira SQL)', async () => {
    const { app, db } = appWith([['from lineups_curados', []]])
    await request(app).get("/api/granadas?map=x';drop&lado=Z&tipo=nuke").set('Cookie', cookieAdmin)
    const chamada = db.query.mock.calls.find(([sql]) => sql.includes('from lineups_curados'))
    expect(chamada[1]).toEqual([])
  })
})

describe('GET /api/granadas/contagem', () => {
  it('jogador comum: 200 (leitura e publica)', async () => {
    const { app } = appWith([['group by map, tipo', []]])
    expect((await request(app).get('/api/granadas/contagem').set('Cookie', cookieJogador)).status).toBe(200)
  })

  it('agrupa por mapa e tipo', async () => {
    const { app } = appWith([['group by map, tipo', [{ map: 'de_mirage', tipo: 'smoke', total: '3' }]]])
    const res = await request(app).get('/api/granadas/contagem').set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    expect(res.body[0]).toEqual({ map: 'de_mirage', tipo: 'smoke', total: 3 })
  })
})

describe('POST /api/granadas', () => {
  const valido = {
    map: 'de_mirage', lado: 'T', tipo: 'smoke', titulo: 'Smoke janela',
    videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk', tecnica: 'jumpthrow',
    botao: 'esquerdo', passos: ['p1'], arremessoX: 0.2, arremessoY: 0.8, alvoX: 0.4, alvoY: 0.3,
  }

  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    expect((await request(app).post('/api/granadas').set('Cookie', cookieJogador).send(valido)).status).toBe(403)
  })

  it('admin cria', async () => {
    const { app, db } = appWith([['insert into lineups_curados', [{ id: 'g2' }]]])
    const res = await request(app).post('/api/granadas').set('Cookie', cookieAdmin).send(valido)
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('g2')
    const params = db.query.mock.calls.find((c) => c[0].includes('insert into lineups_curados'))[1]
    expect(params).toContain('de_mirage')
    expect(params).toContain('999')
  })

  it('video que nao e youtube: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/granadas').set('Cookie', cookieAdmin)
      .send({ ...valido, videoUrl: 'https://vimeo.com/123' })
    expect(res.status).toBe(400)
  })

  it('posicao fora de 0..1: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/granadas').set('Cookie', cookieAdmin)
      .send({ ...valido, alvoX: 1.5 })
    expect(res.status).toBe(400)
  })

  it('sem titulo: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/granadas').set('Cookie', cookieAdmin)
      .send({ ...valido, titulo: '  ' })
    expect(res.status).toBe(400)
  })
})

const UUID_G1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const UUID_GX = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

describe('PATCH /api/granadas/:id', () => {
  it('admin edita e atualizado_em anda', async () => {
    const { app, db } = appWith([['update lineups_curados', [{ id: UUID_G1 }]]])
    const res = await request(app).patch(`/api/granadas/${UUID_G1}`).set('Cookie', cookieAdmin)
      .send({ map: 'de_mirage', lado: 'CT', tipo: 'flash', titulo: 'Flash CT',
        tecnica: 'normal', botao: 'direito', passos: [], arremessoX: 0.1, arremessoY: 0.1,
        alvoX: 0.2, alvoY: 0.2 })
    expect(res.status).toBe(200)
    const chamada = db.query.mock.calls.find((c) => c[0].includes('update lineups_curados'))
    expect(chamada[0]).toContain('atualizado_em = now()')
  })

  it('id inexistente: 404', async () => {
    const { app } = appWith([['update lineups_curados', []]])
    const res = await request(app).patch(`/api/granadas/${UUID_GX}`).set('Cookie', cookieAdmin)
      .send({ map: 'de_mirage', lado: 'CT', tipo: 'flash', titulo: 'x', tecnica: 'normal',
        botao: 'direito', passos: [], arremessoX: 0.1, arremessoY: 0.1, alvoX: 0.2, alvoY: 0.2 })
    expect(res.status).toBe(404)
  })

  it('id nao-uuid: 404 sem tocar no db', async () => {
    const { app, db } = appWith([])
    const res = await request(app).patch('/api/granadas/abc').set('Cookie', cookieAdmin)
      .send({ map: 'de_mirage', lado: 'CT', tipo: 'flash', titulo: 'x', tecnica: 'normal',
        botao: 'direito', passos: [], arremessoX: 0.1, arremessoY: 0.1, alvoX: 0.2, alvoY: 0.2 })
    expect(res.status).toBe(404)
    // Além do recheck de admin (requireSuperAdmin) e da checagem de revogação de sessão
    // (requireAuth), nenhuma query do handler rodou — id malformado é rejeitado antes de
    // qualquer trabalho de banco.
    expect(db.query.mock.calls.filter((c) =>
      !c[0].includes('is_super_admin from players') && !c[0].includes('tokens_validos_apos from players'),
    )).toHaveLength(0)
  })
})

describe('DELETE /api/granadas/:id', () => {
  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    expect((await request(app).delete(`/api/granadas/${UUID_G1}`).set('Cookie', cookieJogador)).status).toBe(403)
  })

  it('admin apaga', async () => {
    const { app, db } = appWith([['delete from lineups_curados', [{ id: UUID_G1 }]]])
    const res = await request(app).delete(`/api/granadas/${UUID_G1}`).set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    const chamada = db.query.mock.calls.find((c) => c[0].includes('delete from lineups_curados'))
    expect(chamada[1]).toEqual([UUID_G1])
  })

  it('id nao-uuid: 404 sem tocar no db', async () => {
    const { app, db } = appWith([])
    const res = await request(app).delete('/api/granadas/abc').set('Cookie', cookieAdmin)
    expect(res.status).toBe(404)
    // Além do recheck de admin (requireSuperAdmin) e da checagem de revogação de sessão
    // (requireAuth), nenhuma query do handler rodou — id malformado é rejeitado antes de
    // qualquer trabalho de banco.
    expect(db.query.mock.calls.filter((c) =>
      !c[0].includes('is_super_admin from players') && !c[0].includes('tokens_validos_apos from players'),
    )).toHaveLength(0)
  })
})

describe('GET /api/granadas/rounds-utilitaria', () => {
  it('jogador comum: 403 (ferramenta de curadoria)', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/granadas/rounds-utilitaria?map=de_mirage').set('Cookie', cookieJogador)).status).toBe(403)
  })

  it('sem map: 400', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/granadas/rounds-utilitaria').set('Cookie', cookieAdmin)).status).toBe(400)
  })

  it('agrupa por match+round+lado, filtra grupos com menos de 3 granadas e ordena por tick', async () => {
    const linha = (over) => ({
      match_id: 'm1', round_number: 1, lado: 'T', tipo: 'smoke', tick: 100, origem: 'pro',
      thrower_steam_id: '111', thrower_nick: 'Jogador1',
      thrower_x: '0.2', thrower_y: '0.8', target_x: '0.4', target_y: '0.3',
      team_a_name: 'Vitality', team_b_name: 'Falcons',
      ...over,
    })
    const rows = [
      // round 1, lado T: 3 granadas (candidato), ticks fora de ordem pra testar o sort
      linha({ tick: 300, tipo: 'flash' }),
      linha({ tick: 100, tipo: 'smoke' }),
      linha({ tick: 200, tipo: 'he' }),
      // round 2, lado T: só 2 granadas (deve ser filtrado)
      linha({ round_number: 2, tick: 400 }),
      linha({ round_number: 2, tick: 500 }),
    ]
    const { app, db } = appWith([['round_number', rows]])
    const res = await request(app).get('/api/granadas/rounds-utilitaria?map=de_mirage').set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const grupo = res.body[0]
    expect(grupo).toMatchObject({
      matchId: 'm1', roundNumber: 1, lado: 'T', origem: 'pro',
      teamAName: 'Vitality', teamBName: 'Falcons',
    })
    expect(grupo.granadas).toHaveLength(3)
    expect(grupo.granadas.map((g) => g.tick)).toEqual([100, 200, 300])
    expect(grupo.granadas[0]).toMatchObject({
      tipo: 'smoke', tick: 100, throwerSteamId: '111', throwerNick: 'Jogador1',
      arremessoX: 0.2, arremessoY: 0.8, alvoX: 0.4, alvoY: 0.3,
    })
    const chamada = db.query.mock.calls.find((c) => c[0].includes('round_number'))
    expect(chamada[1]).toEqual(['de_mirage'])
  })
})

describe('GET /api/granadas/sugestoes', () => {
  it('jogador comum: 403 (insight e ferramenta de curadoria)', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/granadas/sugestoes?map=de_mirage').set('Cookie', cookieJogador)).status).toBe(403)
  })

  it('admin ve clusters agregados', async () => {
    const { app, db } = appWith([['from lineups', [{
      tipo: 'smoke', origem: 'pro', lado: 'T', total: '12', alvo_x: '0.4', alvo_y: '0.3',
      arremesso_x: '0.2', arremesso_y: '0.8',
    }]]])
    const res = await request(app).get('/api/granadas/sugestoes?map=de_mirage').set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    expect(res.body[0]).toEqual({
      tipo: 'smoke', origem: 'pro', lado: 'T', total: 12, alvoX: 0.4, alvoY: 0.3, arremessoX: 0.2, arremessoY: 0.8,
    })
    const chamada = db.query.mock.calls.find((c) => c[0].includes('from lineups'))
    expect(chamada[1]).toEqual(['de_mirage'])
  })

  it('exclui granadas sem lado (demo antiga) direto na query', async () => {
    // Cluster sem lado nao serve pra gerar biblioteca (o cadastro exige T/CT) —
    // dominava o top-15 e fazia o "Gerar biblioteca" pular quase tudo.
    const { app, db } = appWith([['from lineups', []]])
    const res = await request(app).get('/api/granadas/sugestoes?map=de_mirage').set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    const chamada = db.query.mock.calls.find((c) => c[0].includes('from lineups'))
    expect(chamada[0]).toContain('lado is not null')
  })

  it('sem map valido: 400', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/granadas/sugestoes').set('Cookie', cookieAdmin)).status).toBe(400)
  })
})
