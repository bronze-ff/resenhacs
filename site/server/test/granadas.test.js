import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookieJogador = `resenha_token=${signToken({ steamId: '765', isAdmin: false }, config.jwtSecret)}`
const cookieAdmin = `resenha_token=${signToken({ steamId: '999', isAdmin: true }, config.jwtSecret)}`

function appWith(handlers) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
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

  it('logado lista com filtros validados e camelCase', async () => {
    const { app, db } = appWith([['from lineups_curados', [LINHA]]])
    const res = await request(app)
      .get('/api/granadas?map=de_mirage&lado=T&tipo=smoke')
      .set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({
      id: 'g1', videoUrl: 'https://youtu.be/abcdefghijk', arremessoX: 0.2, alvoY: 0.3,
      passos: ['mire no pixel', 'jumpthrow'], tecnica: 'jumpthrow',
    })
    expect(db.query.mock.calls[0][1]).toEqual(['de_mirage', 'T', 'smoke'])
  })

  it('filtro invalido e ignorado (nao vira SQL)', async () => {
    const { app, db } = appWith([['from lineups_curados', []]])
    await request(app).get("/api/granadas?map=x';drop&lado=Z&tipo=nuke").set('Cookie', cookieJogador)
    expect(db.query.mock.calls[0][1]).toEqual([])
  })
})

describe('GET /api/granadas/contagem', () => {
  it('agrupa por mapa e tipo', async () => {
    const { app } = appWith([['group by map, tipo', [{ map: 'de_mirage', tipo: 'smoke', total: '3' }]]])
    const res = await request(app).get('/api/granadas/contagem').set('Cookie', cookieJogador)
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
    const params = db.query.mock.calls[0][1]
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

describe('PATCH /api/granadas/:id', () => {
  it('admin edita e atualizado_em anda', async () => {
    const { app, db } = appWith([['update lineups_curados', [{ id: 'g1' }]]])
    const res = await request(app).patch('/api/granadas/g1').set('Cookie', cookieAdmin)
      .send({ map: 'de_mirage', lado: 'CT', tipo: 'flash', titulo: 'Flash CT',
        tecnica: 'normal', botao: 'direito', passos: [], arremessoX: 0.1, arremessoY: 0.1,
        alvoX: 0.2, alvoY: 0.2 })
    expect(res.status).toBe(200)
    expect(db.query.mock.calls[0][0]).toContain('atualizado_em = now()')
  })

  it('id inexistente: 404', async () => {
    const { app } = appWith([['update lineups_curados', []]])
    const res = await request(app).patch('/api/granadas/gx').set('Cookie', cookieAdmin)
      .send({ map: 'de_mirage', lado: 'CT', tipo: 'flash', titulo: 'x', tecnica: 'normal',
        botao: 'direito', passos: [], arremessoX: 0.1, arremessoY: 0.1, alvoX: 0.2, alvoY: 0.2 })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/granadas/:id', () => {
  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    expect((await request(app).delete('/api/granadas/g1').set('Cookie', cookieJogador)).status).toBe(403)
  })

  it('admin apaga', async () => {
    const { app, db } = appWith([['delete from lineups_curados', [{ id: 'g1' }]]])
    const res = await request(app).delete('/api/granadas/g1').set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    expect(db.query.mock.calls[0][1]).toEqual(['g1'])
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
    expect(db.query.mock.calls[0][1]).toEqual(['de_mirage'])
  })

  it('lado null (demo antiga, sem coleta de team_num) nao quebra a resposta', async () => {
    const { app } = appWith([['from lineups', [{
      tipo: 'flash', origem: 'grupo', lado: null, total: '3', alvo_x: '0.1', alvo_y: '0.9',
      arremesso_x: '0.5', arremesso_y: '0.5',
    }]]])
    const res = await request(app).get('/api/granadas/sugestoes?map=de_mirage').set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    expect(res.body[0]).toEqual({
      tipo: 'flash', origem: 'grupo', lado: null, total: 3, alvoX: 0.1, alvoY: 0.9, arremessoX: 0.5, arremessoY: 0.5,
    })
  })

  it('sem map valido: 400', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/granadas/sugestoes').set('Cookie', cookieAdmin)).status).toBe(400)
  })
})
