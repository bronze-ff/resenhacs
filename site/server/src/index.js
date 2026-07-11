import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'
import { createDb } from './db.js'
import { createApp } from './app.js'
import { verifySteamAssertion } from './steam/openid.js'
import { createFetchPersona, createFetchBans } from './steam/api.js'

const config = loadConfig()
const db = createDb(config.databaseUrl)
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const staticDir = config.isProduction ? path.join(repoRoot, 'site/client/dist') : null

// index.js só roda local/self-hosted (a Vercel usa api/index.js, que não define
// isso) — o repo inteiro está presente no checkout, então dá pra assumir coletor/
// do lado, sem precisar configurar COLETOR_DIR/COLETOR_PYTHON no .env na maioria dos casos.
const coletorDir = config.coletorDir ?? path.join(repoRoot, 'coletor')
const pythonBin =
  config.pythonBin ??
  path.join(coletorDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')

const app = createApp({
  config: { ...config, coletorDir, pythonBin },
  db,
  verifySteamLogin: verifySteamAssertion,
  fetchPersona: createFetchPersona(config.steamApiKey),
  fetchBans: createFetchBans(config.steamApiKey),
  staticDir,
})

app.listen(config.port, () => {
  console.log(`Resenha API na porta ${config.port}`)
})
