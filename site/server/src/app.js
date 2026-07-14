import path from 'node:path'
import express from 'express'
import cookieParser from 'cookie-parser'
import { createAuthRouter } from './routes/auth.js'
import { createPlayersRouter } from './routes/players.js'
import { createMatchesRouter } from './routes/matches.js'
import { createProfileRouter } from './routes/profile.js'
import { createClipsRouter } from './routes/clips.js'
import { createRankingRouter } from './routes/ranking.js'
import { createSessionsRouter } from './routes/sessions.js'
import { createUploadRouter } from './routes/upload.js'
import { createLineupsRouter } from './routes/lineups.js'
import { createTaticasRouter } from './routes/taticas.js'
import { createTaticasCuradasRouter } from './routes/taticasCuradas.js'
import { createPartidasProRouter } from './routes/partidasPro.js'
import { createGranadasRouter } from './routes/granadas.js'
import { createRequireAuth } from './auth/middleware.js'
import { createR2Client } from './r2.js'

// Express 4 NÃO encaminha rejections de handler async pro error middleware: uma query
// que lance (ex.: cast de uuid inválido em /api/matches/abc) viraria unhandled rejection
// e mataria a função serverless (FUNCTION_INVOCATION_FAILED). No Express 4 os métodos de
// rota vivem como propriedades da função Router exportada (que é o prototype dos routers
// via setPrototypeOf) — embrulhamos cada um pra capturar a promise e chamar next(err).
function patchRouterAsync() {
  const embrulha = (fn) =>
    typeof fn === 'function' && fn.length < 4
      ? function embrulhado(req, res, next) {
          const out = fn.call(this, req, res, next)
          if (out && typeof out.catch === 'function') out.catch(next)
          return out
        }
      : fn
  for (const metodo of ['get', 'post', 'put', 'patch', 'delete']) {
    const original = express.Router[metodo]
    if (typeof original === 'function' && !original.__comEmbrulho) {
      express.Router[metodo] = function (...args) {
        return original.apply(
          this,
          args.map((a) => (Array.isArray(a) ? a.map(embrulha) : embrulha(a))),
        )
      }
      express.Router[metodo].__comEmbrulho = true
    }
  }
}

export function createApp({ config, db, verifySteamLogin, fetchPersona, fetchBans, staticDir, execFileImpl, r2Client: r2ClientOverride } = {}) {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('X-Frame-Options', 'DENY')
    res.set('Referrer-Policy', 'same-origin')
    next()
  })

  patchRouterAsync()

  app.get('/api/health', (req, res) => res.json({ ok: true }))

  const requireAuth = createRequireAuth(config.jwtSecret)
  const r2Client = r2ClientOverride !== undefined ? r2ClientOverride : createR2Client(config)
  app.use('/api/auth', createAuthRouter({ config, db, verifySteamLogin, fetchPersona, requireAuth }))
  app.use('/api/players', createPlayersRouter({ db, requireAuth, fetchBans }))
  app.use('/api/matches', createMatchesRouter({ db, requireAuth, r2Client, r2Bucket: config.r2Bucket }))
  app.use('/api/profile', createProfileRouter({ db, requireAuth }))
  app.use('/api/clips', createClipsRouter({ db, requireAuth }))
  app.use('/api/ranking', createRankingRouter({ db, requireAuth }))
  app.use('/api/sessions', createSessionsRouter({ db, requireAuth }))
  app.use('/api/lineups', createLineupsRouter({ db, requireAuth }))
  app.use('/api/taticas', createTaticasRouter({ db, requireAuth }))
  app.use('/api/taticas-curadas', createTaticasCuradasRouter({ db, requireAuth }))
  app.use('/api/partidas-pro-fila', createPartidasProRouter({ db, requireAuth, r2Client, r2Bucket: config.r2Bucket }))
  app.use('/api/granadas', createGranadasRouter({ db, requireAuth }))

  // Upload manual via web só existe quando o Coletor Python está no mesmo host
  // (dev/self-hosted). Na Vercel (serverless) config.coletorDir/pythonBin ficam
  // indefinidos e a rota nem é montada — evita um 500 confuso em produção.
  if (config.coletorDir && config.pythonBin) {
    app.use(
      '/api/upload',
      createUploadRouter({
        requireAuth,
        coletorDir: config.coletorDir,
        pythonBin: config.pythonBin,
        ...(execFileImpl ? { execFileImpl } : {}),
      }),
    )
  }

  if (staticDir) {
    app.use(express.static(staticDir))
    app.get(/^\/(?!api\/).*/, (req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'))
    })
  }

  // Error handler global (par do patchRouterAsync): erro vira 500 JSON logado,
  // nunca crash da função. eslint-disable: o Express identifica error middleware
  // pela ARIDADE, os 4 parâmetros são obrigatórios mesmo sem usar o next.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(`erro não tratado em ${req.method} ${req.path}:`, err)
    if (!res.headersSent) res.status(500).json({ erro: 'Erro interno' })
  })

  return app
}
