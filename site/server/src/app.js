import path from 'node:path'
import express from 'express'
import cookieParser from 'cookie-parser'
import { createAuthRouter } from './routes/auth.js'
import { createPlayersRouter } from './routes/players.js'
import { createRequireAuth } from './auth/middleware.js'

export function createApp({ config, db, verifySteamLogin, fetchPersona, staticDir } = {}) {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())

  app.get('/api/health', (req, res) => res.json({ ok: true }))

  const requireAuth = createRequireAuth(config.jwtSecret)
  app.use('/api/auth', createAuthRouter({ config, db, verifySteamLogin, fetchPersona, requireAuth }))
  app.use('/api/players', createPlayersRouter({ db, requireAuth }))

  if (staticDir) {
    app.use(express.static(staticDir))
    app.get(/^\/(?!api\/).*/, (req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'))
    })
  }

  return app
}
