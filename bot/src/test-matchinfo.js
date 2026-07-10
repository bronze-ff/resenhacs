// Testa requestGame() com um share code real, pra ver a estrutura completa da
// resposta do Game Coordinator e confirmar onde vem a URL de download do demo.
import SteamUser from 'steam-user'
import GlobalOffensive from 'globaloffensive'

const user = process.env.STEAM_BOT_USER
const pass = process.env.STEAM_BOT_PASS
const shareCode = process.argv[2]
if (!user || !pass || !shareCode) {
  console.error('Uso: STEAM_BOT_USER/PASS no ambiente + share code como argumento')
  process.exit(1)
}

const client = new SteamUser()
const csgo = new GlobalOffensive(client)

const timeout = setTimeout(() => {
  console.error('TIMEOUT: nada aconteceu em 60s')
  process.exit(1)
}, 60000)

client.on('error', (err) => {
  console.error('ERRO_STEAM_USER', err.message)
  clearTimeout(timeout)
  process.exit(1)
})

client.on('loggedOn', () => {
  console.log('LOGIN_OK')
  client.gamesPlayed([730])
})

csgo.on('connectedToGC', () => {
  console.log('GC_CONECTADO, pedindo match info pro share code:', shareCode)
  csgo.requestGame(shareCode)
})

csgo.on('matchList', (matches) => {
  console.log('MATCH_LIST recebido, quantidade:', matches?.length)
  console.log(JSON.stringify(matches, null, 2))
  clearTimeout(timeout)
  client.logOff()
  setTimeout(() => process.exit(0), 500)
})

console.log('logando na Steam...')
client.logOn({ accountName: user, password: pass })
