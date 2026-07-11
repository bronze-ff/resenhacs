// Ponto de entrada único da API na Vercel (Root Directory do projeto = site/server).
// Todo o tráfego é roteado pra cá pelo rewrite "/(.*)" → "/api" no vercel.json; a Vercel
// preserva o req.url original, então o Express interno (que já espera rotas prefixadas
// com /api/...) recebe o path real e roteia normalmente. Esse padrão (função única +
// rewrite) é o jeito canônico de rodar Express na Vercel — não depende da detecção de
// framework nem do catch-all [...path] do sistema de arquivos, que se mostrou não-confiável.
//
// Config/db/app são criados uma vez por módulo: em invocações "quentes" da mesma
// instância da função, o pool de conexões (pg.Pool) é reaproveitado em vez de recriado
// a cada request — essencial pra não estourar o limite de conexões do Postgres.
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
