import path from 'node:path'
import express from 'express'
import cookieParser from 'cookie-parser'
import { createAuthRouter } from './routes/auth.js'
import { createPlayersRouter } from './routes/players.js'
import { createMatchesRouter } from './routes/matches.js'
import { createProfileRouter } from './routes/profile.js'
import { createClipsRouter } from './routes/clips.js'
import { createRankingRouter } from './routes/ranking.js'
import { createUploadRouter } from './routes/upload.js'
import { createRequireAuth } from './auth/middleware.js'
import { createR2Client } from './r2.js'

export function createApp({ config, db, verifySteamLogin, fetchPersona, staticDir, execFileImpl, r2Client: r2ClientOverride } = {}) {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())

  app.get('/api/health', (req, res) => res.json({ ok: true }))

  const requireAuth = createRequireAuth(config.jwtSecret)
  const r2Client = r2ClientOverride !== undefined ? r2ClientOverride : createR2Client(config)
  app.use('/api/auth', createAuthRouter({ config, db, verifySteamLogin, fetchPersona, requireAuth }))
  app.use('/api/players', createPlayersRouter({ db, requireAuth }))
  app.use('/api/matches', createMatchesRouter({ db, requireAuth, r2Client, r2Bucket: config.r2Bucket }))
  app.use('/api/profile', createProfileRouter({ db, requireAuth }))
  app.use('/api/clips', createClipsRouter({ db, requireAuth }))
  app.use('/api/ranking', createRankingRouter({ db, requireAuth }))

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

  return app
}
