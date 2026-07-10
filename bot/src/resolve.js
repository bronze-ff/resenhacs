// Resolve share codes → links de download do .dem, via Game Coordinator do CS2.
// Loga UMA vez, resolve cada code em sequência, imprime JSON em stdout e sai.
//
// Uso: node src/resolve.js CODE1 CODE2 ...   (STEAM_BOT_USER/PASS no ambiente)
// Saída (stdout): [{ "shareCode": "...", "demoUrl": "http://...dem.bz2"|null, "matchTime": 1780536415|null }]
//
// Só o GC (cliente de CS2 logado) sabe o link do .dem de uma partida de matchmaking —
// nenhuma Web API entrega isso no CS2. Por isso a conta-bot. O link vem no campo `map`
// do último bloco de roundstatsall (padrão herdado do CS:GO). A conta precisa estar com
// o CS2 FECHADO em qualquer outro lugar, senão a Steam derruba com LoggedInElsewhere.
import SteamUser from 'steam-user'
import GlobalOffensive from 'globaloffensive'

// Mesmo codec de coletor/src/coletor/sharecode.py — usado só pra CORRELACIONAR a
// resposta do GC com o code pedido (ver decodeShareCode abaixo), não pra descobrir
// codes novos (isso é a API oficial da Steam, no coletor).
const DICTIONARY = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789'
const BASE = BigInt(DICTIONARY.length)

function decodeShareCode(code) {
  const limpo = code.replace('CSGO-', '').replaceAll('-', '')
  if (limpo.length !== 25) return null
  let big = 0n
  for (const ch of [...limpo].reverse()) {
    const idx = DICTIONARY.indexOf(ch)
    if (idx < 0) return null
    big = big * BASE + BigInt(idx)
  }
  // 18 bytes big-endian; matchId/reservationId são os primeiros 16 bytes, little-endian.
  const hex = big.toString(16).padStart(36, '0')
  const bytes = Buffer.from(hex, 'hex')
  const matchId = bytes.subarray(0, 8).reverse().readBigUInt64BE()
  return { matchId: matchId.toString() }
}

const user = process.env.STEAM_BOT_USER
const pass = process.env.STEAM_BOT_PASS
const codes = process.argv.slice(2)
if (!user || !pass || codes.length === 0) {
  console.error('Uso: STEAM_BOT_USER/PASS no ambiente + share codes como argumentos')
  process.exit(1)
}

const client = new SteamUser()
const csgo = new GlobalOffensive(client)
const resultados = []

// Guarda-chuva: se o GC travar de vez, imprime o que já tiver e sai com erro.
const timeoutGeral = setTimeout(() => {
  console.error('TIMEOUT_GERAL: GC não respondeu a tempo')
  process.stdout.write(JSON.stringify(resultados))
  process.exit(1)
}, 30000 + codes.length * 15000)

function extrairDemoUrl(match) {
  const blocos = match?.roundstatsall || []
  for (let i = blocos.length - 1; i >= 0; i--) {
    if (blocos[i]?.map) return blocos[i].map
  }
  return null
}

// Resolve um code: pede ao GC e espera o próximo matchList (com timeout por code).
// Correlaciona pelo matchid decodificado do PRÓPRIO code — sem isso, uma resposta
// atrasada do code anterior (chegou depois do timeout dele) seria confundida com a
// resposta do code atual e gravaria o demo/matchTime da partida ERRADA.
function resolverUm(code) {
  const esperado = decodeShareCode(code)
  return new Promise((resolve) => {
    const onList = (matches) => {
      const match = matches && matches[0]
      if (esperado && match?.matchid && String(match.matchid) !== esperado.matchId) {
        return // resposta de outro code (atrasada) — ignora, continua esperando a certa
      }
      csgo.removeListener('matchList', onList)
      clearTimeout(t)
      resolve({ shareCode: code, demoUrl: extrairDemoUrl(match), matchTime: match?.matchtime ?? null })
    }
    const t = setTimeout(() => {
      csgo.removeListener('matchList', onList)
      resolve({ shareCode: code, demoUrl: null, matchTime: null, erro: 'sem resposta do GC' })
    }, 15000)
    csgo.on('matchList', onList)
    csgo.requestGame(code)
  })
}

client.on('error', (err) => {
  console.error('ERRO_STEAM_USER', err.message)
  clearTimeout(timeoutGeral)
  process.exit(1)
})

client.on('loggedOn', () => {
  client.gamesPlayed([730])
})

// once: se o GC cair e reconectar no meio do lote (sessão longa, backfill grande), o
// handler rodando de novo resolveria tudo duas vezes e escreveria dois JSONs
// concatenados no stdout — o Python quebraria tentando fazer json.loads daquilo.
csgo.once('connectedToGC', async () => {
  for (const code of codes) {
    resultados.push(await resolverUm(code))
  }
  clearTimeout(timeoutGeral)
  process.stdout.write(JSON.stringify(resultados))
  client.logOff()
  setTimeout(() => process.exit(0), 300)
})

client.logOn({ accountName: user, password: pass })
