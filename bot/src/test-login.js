// Teste isolado: só confirma que login + conexão ao Game Coordinator funcionam
// com a conta-bot, antes de construir o resto da integração em cima.
import SteamUser from 'steam-user'
import GlobalOffensive from 'globaloffensive'

const user = process.env.STEAM_BOT_USER
const pass = process.env.STEAM_BOT_PASS
if (!user || !pass) {
  console.error('Faltando STEAM_BOT_USER / STEAM_BOT_PASS no ambiente')
  process.exit(1)
}

const client = new SteamUser()
const csgo = new GlobalOffensive(client)

const timeout = setTimeout(() => {
  console.error('TIMEOUT: nada aconteceu em 45s')
  process.exit(1)
}, 45000)

client.on('steamGuard', (domain, callback, lastCodeWrong) => {
  console.log('STEAM_GUARD_PEDIDO domain=%s lastCodeWrong=%s', domain, lastCodeWrong)
  console.log('(precisa de código — não deveríamos ter chegado aqui, já que Guard está desativado)')
})

client.on('error', (err) => {
  console.error('ERRO_STEAM_USER', err.eresult ? `eresult=${err.eresult}` : '', err.message)
  clearTimeout(timeout)
  process.exit(1)
})

client.on('loggedOn', (details) => {
  console.log('LOGIN_OK steamid=%s', client.steamID?.getSteamID64())
  console.log('conectando ao Game Coordinator do CS2...')
  client.gamesPlayed([730]) // precisa "jogar" CS2 pra GC responder
})

csgo.on('connectedToGC', () => {
  console.log('GC_CONECTADO — bot pronto pra pedir match info')
  clearTimeout(timeout)
  client.logOff()
  setTimeout(() => process.exit(0), 1000)
})

csgo.on('disconnectedFromGC', (reason) => {
  console.log('GC_DESCONECTADO reason=%s', reason)
})

console.log('logando na Steam...')
client.logOn({ accountName: user, password: pass })
