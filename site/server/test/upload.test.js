import { describe, it, expect, vi, afterAll } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = {
  jwtSecret: 's',
  appUrl: 'http://localhost:5173',
  isProduction: false,
  coletorDir: '/fake/coletor',
  pythonBin: '/fake/python',
}
const cookie = `resenha_token=${signToken({ steamId: '76561198000000009', isAdmin: false }, config.jwtSecret)}`

const demoFalso = path.join(os.tmpdir(), 'resenha-test.dem')
fs.writeFileSync(demoFalso, 'conteudo falso de demo')
afterAll(() => fs.rm(demoFalso, () => {}))

function appWith(execFileImpl) {
  const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
  return createApp({ config, db, execFileImpl })
}

describe('POST /api/upload', () => {
  it('sem login: 401', async () => {
    // sem .attach() de propósito: requireAuth roda antes do multer e rejeita pelo
    // cookie, sem precisar ler o corpo — anexar um arquivo aqui cria uma corrida de
    // ECONNRESET no supertest (servidor responde 401 antes do upload terminar).
    const app = appWith()
    const res = await request(app).post('/api/upload')
    expect(res.status).toBe(401)
  })

  it('sem arquivo: 400', async () => {
    const app = appWith()
    const res = await request(app).post('/api/upload').set('Cookie', cookie)
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/nenhum arquivo/i)
  })

  it('extensão errada: 400', async () => {
    const txtFalso = path.join(os.tmpdir(), 'resenha-test.txt')
    fs.writeFileSync(txtFalso, 'x')
    const app = appWith()
    const res = await request(app).post('/api/upload').set('Cookie', cookie).attach('demo', txtFalso)
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/\.dem/)
    fs.rmSync(txtFalso)
  })

  it('share code inválido: 400', async () => {
    const app = appWith()
    const res = await request(app)
      .post('/api/upload')
      .set('Cookie', cookie)
      .field('shareCode', 'nao-e-um-share-code')
      .attach('demo', demoFalso)
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/share code/i)
  })

  it('data inválida: 400', async () => {
    const app = appWith()
    const res = await request(app)
      .post('/api/upload')
      .set('Cookie', cookie)
      .field('playedAt', 'ontem à noite')
      .attach('demo', demoFalso)
    expect(res.status).toBe(400)
  })

  it('sucesso: chama o coletor e devolve o matchId extraído do stdout', async () => {
    const execFileImpl = vi.fn((bin, args, opts, cb) => {
      cb(null, 'parseando e gravando...\ningest: Partida gravada abc-123\n', '')
    })
    const app = appWith(execFileImpl)
    const res = await request(app)
      .post('/api/upload')
      .set('Cookie', cookie)
      .field('shareCode', 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee')
      .field('playedAt', '2026-07-09T20:15')
      .attach('demo', demoFalso)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, matchId: 'abc-123' })
    const [bin, args, opts] = execFileImpl.mock.calls[0]
    expect(bin).toBe(config.pythonBin)
    expect(args).toEqual(
      expect.arrayContaining([
        '-m', 'coletor.main', 'ingest',
        '--source', 'upload',
        '--share-code', 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee',
        '--played-at', '2026-07-09T20:15',
      ]),
    )
    expect(opts.cwd).toBe(config.coletorDir)
  })

  it('falha no coletor: 500 com o stderr', async () => {
    const execFileImpl = vi.fn((bin, args, opts, cb) => {
      cb(new Error('exit 1'), '', 'Traceback: algo quebrou')
    })
    const app = appWith(execFileImpl)
    const res = await request(app).post('/api/upload').set('Cookie', cookie).attach('demo', demoFalso)
    expect(res.status).toBe(500)
    expect(res.body.detalhe).toContain('Traceback')
  })
})
