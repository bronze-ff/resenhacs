import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookie = `resenha_token=${signToken({ steamId: '111' }, config.jwtSecret)}`

function appWith(rows) {
  const db = { query: vi.fn().mockResolvedValue({ rows }) }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/ranking-publico/jogadores', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/ranking-publico/jogadores')).status).toBe(401)
  })

  it('lista jogadores publicos com rating', async () => {
    const { app } = appWith([
      { steam_id64: '1', nick: 'top', avatar_url: null, partidas: 10, vitorias: 7, kills: 200, deaths: 150, rating: '1.35' },
    ])
    const res = await request(app).get('/api/ranking-publico/jogadores').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ nick: 'top', rating: 1.35, winrate: 70 })
  })
})

describe('GET /api/ranking-publico/times', () => {
  it('lista times publicos', async () => {
    const { app } = appWith([
      { id: 't1', nome: 'Titulares', grupo_nome: 'Grupo A', partidas: 5, vitorias: 3, rating: '1.1' },
    ])
    const res = await request(app).get('/api/ranking-publico/times').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ nome: 'Titulares', grupoNome: 'Grupo A', winrate: 60 })
  })
})
