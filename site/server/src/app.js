import path from 'node:path'
import express from 'express'
import cookieParser from 'cookie-parser'
import { createAuthRouter } from './routes/auth.js'
import { createFriendshipsRouter } from './routes/friendships.js'
import { createPlayersRouter } from './routes/players.js'
import { createMinhaContaRouter } from './routes/minhaConta.js'
import { createPrimeirosPassosRouter } from './routes/primeirosPassos.js'
import { createFaceitRouter } from './routes/faceit.js'
import { createFaceitSincronizacaoRouter } from './routes/faceitSincronizacao.js'
import { createMatchesRouter } from './routes/matches.js'
import { createKillsRouter } from './routes/kills.js'
import { createClipesReaisRouter } from './routes/clipesReais.js'
import { createProfileRouter } from './routes/profile.js'
import { createClipsRouter } from './routes/clips.js'
import { createClipesRouter } from './routes/clipes.js'
import { createCompeticoesRouter } from './routes/competicoes.js'
import { createRankingRouter } from './routes/ranking.js'
import { createSessionsRouter } from './routes/sessions.js'
import { createRecordesRouter } from './routes/recordes.js'
import { createLadoPorMapaRouter } from './routes/ladoPorMapa.js'
import { createMapasRouter } from './routes/mapas.js'
import { createDuelosPerfilRouter, createDuelosPartidaRouter } from './routes/duelos.js'
import { createAllstarRouter } from './routes/allstar.js'
import { createUploadRouter } from './routes/upload.js'
import { createLineupsRouter } from './routes/lineups.js'
import { createTaticasRouter } from './routes/taticas.js'
import { createTaticasCuradasRouter } from './routes/taticasCuradas.js'
import { createPartidasProRouter } from './routes/partidasPro.js'
import { createGranadasRouter } from './routes/granadas.js'
import { createCursoRouter } from './routes/curso.js'
import { createRivalidadesRouter } from './routes/rivalidades.js'
import { createPremiosRouter } from './routes/premios.js'
import { createQuadrosRouter } from './routes/quadros.js'
import { createRequireAuth } from './auth/middleware.js'
import { capturarErro } from './observabilidade/sentry.js'
import { limiteGeral } from './rateLimit.js'
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

export function createApp({
  config,
  db,
  verifySteamLogin,
  fetchPersona,
  fetchBans,
  fetchFriendList = async () => [],
  staticDir,
  r2Client: r2ClientOverride,
  faceitFetchImpl,
  demoSlap,
} = {}) {
  const app = express()
  // Não anunciar a stack (X-Powered-By: Express) pra quem varre o site atrás de alvo.
  app.disable('x-powered-by')
  // Em produção (Vercel) a função fica atrás de UM proxy (o edge deles), que sempre manda
  // X-Forwarded-For; sem confiar nesse hop o express-rate-limit não consegue identificar o
  // IP do cliente e lança erro de validação em TODA requisição (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR),
  // derrubando a API inteira. "1" confia só no primeiro hop — não em qualquer proxy (evita
  // o outro erro deles, trust proxy permissivo, que abriria brecha pra spoofar IP e burlar o limite).
  app.set('trust proxy', 1)
  app.use(express.json())
  app.use(cookieParser())
  app.use(limiteGeral)
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('X-Frame-Options', 'DENY')
    res.set('Referrer-Policy', 'same-origin')
    next()
  })

  patchRouterAsync()

  app.get('/api/health', (req, res) => res.json({ ok: true }))

  const requireAuth = createRequireAuth(config.jwtSecret, db)
  const r2Client = r2ClientOverride !== undefined ? r2ClientOverride : createR2Client(config)
  app.use('/api/auth', createAuthRouter({ config, db, verifySteamLogin, fetchPersona, fetchFriendList, requireAuth }))
  app.use('/api/amigos', createFriendshipsRouter({ db, requireAuth }))
  app.use('/api/players', createPlayersRouter({ db, requireAuth, fetchBans }))
  app.use('/api/minha-conta', createMinhaContaRouter({ db, requireAuth, config }))
  app.use('/api/primeiros-passos', createPrimeirosPassosRouter({ db, requireAuth }))
  app.use('/api/faceit-sincronizacao', createFaceitSincronizacaoRouter({ db, requireAuth }))
  app.use('/api/faceit', requireAuth, createFaceitRouter({ config, db, ...(faceitFetchImpl ? { fetchImpl: faceitFetchImpl } : {}) }))
  app.use('/api/matches', createKillsRouter({ db, requireAuth }))
  app.use('/api/matches', createClipesReaisRouter({ db, requireAuth, r2Client, r2Bucket: config.r2Bucket, config, demoSlap }))
  app.use('/api/matches', createMatchesRouter({ db, requireAuth, r2Client, r2Bucket: config.r2Bucket, config }))
  app.use('/api/profile', createProfileRouter({ db, requireAuth }))
  app.use('/api/clips', createClipsRouter({ db, requireAuth }))
  app.use('/api/clipes', createClipesRouter({ db, requireAuth }))
  app.use('/api/competicoes', createCompeticoesRouter({ db, requireAuth }))
  app.use('/api/ranking', createRankingRouter({ db, requireAuth }))
  app.use('/api/sessions', createSessionsRouter({ db, requireAuth }))
  app.use('/api/recordes', createRecordesRouter({ db, requireAuth }))
  app.use('/api/lado-mapa', createLadoPorMapaRouter({ db, requireAuth }))
  app.use('/api/mapas', createMapasRouter({ db, requireAuth }))
  app.use('/api/profile', createDuelosPerfilRouter({ db, requireAuth }))
  app.use('/api/matches', createDuelosPartidaRouter({ db, requireAuth }))
  app.use('/api/allstar', createAllstarRouter({ db, config }))
  app.use('/api/lineups', createLineupsRouter({ db, requireAuth }))
  app.use('/api/taticas', createTaticasRouter({ db, requireAuth }))
  app.use('/api/taticas-curadas', createTaticasCuradasRouter({ db, requireAuth }))
  app.use('/api/partidas-pro-fila', createPartidasProRouter({ db, requireAuth, r2Client, r2Bucket: config.r2Bucket }))
  app.use('/api/granadas', createGranadasRouter({ db, requireAuth }))
  app.use('/api/curso', createCursoRouter({ db, requireAuth, r2Client, r2Bucket: config.r2Bucket }))
  app.use('/api/rivalidades', createRivalidadesRouter({ db, requireAuth }))
  app.use('/api/premios', createPremiosRouter({ db, requireAuth }))
  app.use('/api/quadros', createQuadrosRouter({ db, requireAuth }))

  app.use('/api/upload', createUploadRouter({ db, requireAuth, r2Client, r2Bucket: config.r2Bucket }))

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
    capturarErro(err)
    const tipo = err instanceof TypeError ? 'TypeError' : err instanceof SyntaxError ? 'SyntaxError' : 'Error'
    const sqlstate = typeof err?.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code) ? err.code : null
    console.error('api: erro não tratado', { tipo, sqlstate })
    if (!res.headersSent) res.status(500).json({ erro: 'Erro interno' })
  })

  return app
}
