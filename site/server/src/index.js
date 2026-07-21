import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'
import { createDb } from './db.js'
import { createApp } from './app.js'
import { verifySteamAssertion } from './steam/openid.js'
import { createFetchPersona, createFetchBans, createFetchFriendList } from './steam/api.js'

const config = loadConfig()
const db = createDb(config.databaseUrl)
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const staticDir = config.isProduction ? path.join(repoRoot, 'site/client/dist') : null

const app = createApp({
  config,
  db,
  verifySteamLogin: verifySteamAssertion,
  fetchPersona: createFetchPersona(config.steamApiKey),
  fetchBans: createFetchBans(config.steamApiKey),
  fetchFriendList: createFetchFriendList(config.steamApiKey),
  staticDir,
})

app.listen(config.port, () => {
  console.log(`Resenha API na porta ${config.port}`)
})
