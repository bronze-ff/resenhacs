import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { assinarTokenExtensao, renovarTokenExtensao, createRequireExtensao } from '../src/auth/tokenExtensao.js'
import { signToken, verifyToken } from '../src/auth/jwt.js'

const segredo = 'segredo-ficticio-testes-extensao'
const steamId = '76561198012345678'
const agora = 1792670400
const dia = 86400
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(agora * 1000) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function appCom(db = { query: vi.fn(async () => ({ rows: [{ tokens_validos_apos: null }] })) }) {
  const app = express()
  app.get('/', createRequireExtensao(segredo, db), (req, res) => res.json({ steamId: req.player.steamId }))
  return { app, db }
}

describe('token de extensão', () => {
  it('tem escopo mínimo, chave separada, vida de 24 h e expiraEm UTC', () => {
    const emitido = assinarTokenExtensao({ steamId }, segredo)
    const payload = jwt.verify(emitido.token, `${segredo}:extensao-upload`, { algorithms: ['HS256'] })
    expect(payload).toEqual({ steamId, escopo: 'extensao-upload', conectadoEm: agora, iat: agora, exp: agora + dia })
    expect(emitido.expiraEm).toBe(new Date((agora + dia) * 1000).toISOString())
    expect(verifyToken(emitido.token, segredo)).toBeNull()
    expect(renovarTokenExtensao(signToken({ steamId }, segredo), segredo)).toBeNull()
  })

  it('renova sem reiniciar conectadoEm e respeita o teto absoluto de 30 dias', () => {
    const primeiro = assinarTokenExtensao({ steamId }, segredo)
    vi.setSystemTime((agora + dia - 60) * 1000)
    const renovado = renovarTokenExtensao(primeiro.token, segredo)
    expect(jwt.decode(renovado.token)).toMatchObject({ conectadoEm: agora, exp: agora + 2 * dia - 60 })
    vi.setSystemTime((agora + 30 * dia - 60) * 1000)
    const ultimo = assinarTokenExtensao({ steamId, conectadoEm: agora }, segredo)
    expect(jwt.decode(ultimo.token).exp).toBe(agora + 30 * dia)
    vi.setSystemTime((agora + 30 * dia) * 1000)
    expect(renovarTokenExtensao(ultimo.token, segredo)).toBeNull()
    expect(assinarTokenExtensao({ steamId, conectadoEm: agora }, segredo)).toBeNull()
  })

  it.each([
    { escopo: 'sessao' }, { conectadoEm: null }, { conectadoEm: agora + 1 },
    { steamId: 'invalido' }, { iat: agora + 10 }, { exp: agora + 2 * dia },
    { conectadoEm: agora - 31 * dia },
  ])('recusa claims fora do contrato: %j', async (extra) => {
    const token = jwt.sign({ steamId, escopo: 'extensao-upload', conectadoEm: agora, iat: agora, exp: agora + dia, ...extra }, `${segredo}:extensao-upload`)
    const { app, db } = appCom()
    expect((await request(app).get('/').set('Authorization', `Bearer ${token}`)).status).toBe(401)
    expect(db.query).not.toHaveBeenCalled()
    expect(renovarTokenExtensao(token, segredo)).toBeNull()
  })

  it('exige Bearer e não aceita cookie, token de sessão ou outro algoritmo', async () => {
    const { app } = appCom()
    const token = assinarTokenExtensao({ steamId }, segredo).token
    expect((await request(app).get('/').set('Cookie', `resenha_token=${token}`)).status).toBe(401)
    expect((await request(app).get('/').set('Authorization', `Bearer ${signToken({ steamId }, segredo)}`)).status).toBe(401)
    const outroAlgoritmo = jwt.sign({ steamId, escopo: 'extensao-upload', conectadoEm: agora }, `${segredo}:extensao-upload`, { algorithm: 'HS384', expiresIn: '1d' })
    expect((await request(app).get('/').set('Authorization', `Bearer ${outroAlgoritmo}`)).status).toBe(401)
    expect((await request(app).get('/').set('Authorization', `Bearer ${token}`)).body).toEqual({ steamId })
  })

  it('logout revoga a conexão mesmo se um token foi renovado depois', async () => {
    const revogacao = new Date((agora + 10) * 1000).toISOString()
    const db = { query: vi.fn(async () => ({ rows: [{ tokens_validos_apos: revogacao }] })) }
    vi.setSystemTime((agora + 20) * 1000)
    const token = assinarTokenExtensao({ steamId, conectadoEm: agora }, segredo).token
    expect((await request(appCom(db).app).get('/').set('Authorization', `Bearer ${token}`)).status).toBe(401)
    expect(db.query).toHaveBeenCalledWith('select tokens_validos_apos from players where steam_id64 = $1', [steamId])
  })

  it('Jogador removido e banco indisponível falham fechados sem expor erro', async () => {
    const token = assinarTokenExtensao({ steamId }, segredo).token
    const removido = appCom({ query: vi.fn(async () => ({ rows: [] })) }).app
    expect((await request(removido).get('/').set('Authorization', `Bearer ${token}`)).status).toBe(401)
    const fora = appCom({ query: vi.fn(async () => { throw new Error('dado pessoal privado') }) }).app
    const res = await request(fora).get('/').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ erro: 'Erro interno' })
  })
})
