// Ponto de entrada único da API na Vercel (Root Directory do projeto = site/server).
// Só /api/* é roteado pra cá, pelo rewrite "/api/(.*)" → "/api" no vercel.json. A Vercel
// preserva o req.url original, então o Express (rotas prefixadas com /api/...) recebe o
// path real. Path fora de /api não casa o rewrite e a plataforma responde 404 (404.html)
// sem invocar esta função. O arquivo api/index.js ainda existe em /api exato pelo
// filesystem; esse path não tem rota no Express.
//
// Config/db/app são criados uma vez por módulo: em invocações "quentes" da mesma
// instância da função, o pool de conexões (pg.Pool) é reaproveitado em vez de recriado
// a cada request — essencial pra não estourar o limite de conexões do Postgres.
import '../src/observabilidade/sentry.js'
import { loadConfig } from '../src/config.js'
import { createDb } from '../src/db.js'
import { createApp } from '../src/app.js'
import { verifySteamAssertion } from '../src/steam/openid.js'
import { createFetchPersona, createFetchBans } from '../src/steam/api.js'

const config = loadConfig()
const db = createDb(config.databaseUrl)

const app = createApp({
  config,
  db,
  verifySteamLogin: verifySteamAssertion,
  fetchPersona: createFetchPersona(config.steamApiKey),
  fetchBans: createFetchBans(config.steamApiKey),
  // staticDir: undefined — nesta topologia o client é um projeto Vercel à parte
  // (site/client), servido como site estático; esta função só responde /api/*.
})

export default app
