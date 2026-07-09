import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'
import { createDb } from './db.js'
import { createApp } from './app.js'
import { verifySteamAssertion } from './steam/openid.js'
import { createFetchPersona } from './steam/api.js'

const config = loadConfig()
const db = createDb(config.databaseUrl)
const staticDir = config.isProduction
  ? path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist')
  : null

const app = createApp({
  config,
  db,
  verifySteamLogin: verifySteamAssertion,
  fetchPersona: createFetchPersona(config.steamApiKey),
  staticDir,
})

app.listen(config.port, () => {
  console.log(`Resenha API na porta ${config.port}`)
})
