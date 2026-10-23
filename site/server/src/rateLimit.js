import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { verifyToken } from './auth/jwt.js'

// Auditoria finding #1 (ausência total de rate limiting): sem isso qualquer rota — login,
// geração de clipe pago no Allstar, upload, webhook — fica aberta a abuso ilimitado por
// um único IP (força bruta, scraping, estourar custo de API paga de terceiro).
//
// O site (projeto resenha) reescreve /api no CDN para este projeto. A Vercel, quando está
// atrás de proxy, substitui X-Forwarded-For pelo IP de quem conectou na função — o proxy,
// não cada visitante. Todo mundo cairia no mesmo balde. Quem tem sessão vale pelo steamId
// do JWT (assinatura conferida). Sem cookie, a chave continua o IP: a extensão FACEIT chama
// este host direto, com o IP real, e o anônimo no site divide o balde do proxy.
//
// Em teste, o vitest já seta NODE_ENV=test sozinho (sem precisar configurar nada aqui) e
// os arquivos de teste disparam dezenas de requisições supertest seguidas pro mesmo app,
// todas do mesmo IP de loopback — e como os limiters abaixo são singletons de módulo, o
// contador é compartilhado por TODOS os testes de um mesmo arquivo. Pulamos o rate limit
// nesse ambiente pra suíte não esbarrar em 429 por causa dela mesma, não do código testado.
const pulaEmTeste = () => process.env.NODE_ENV === 'test'
const STEAM_ID = /^[0-9]{17}$/

function ipDe(req) {
  const ip = req?.ip || req?.socket?.remoteAddress
  return typeof ip === 'string' && ip ? ip : '127.0.0.1'
}

function steamIdDaSessao(req, secret) {
  if (typeof secret !== 'string' || !secret) return null
  const token = req?.cookies?.resenha_token
  if (typeof token !== 'string' || !token) return null
  const payload = verifyToken(token, secret)
  const steamId = payload?.steamId
  return typeof steamId === 'string' && STEAM_ID.test(steamId) ? steamId : null
}

// O express-rate-limit chama keyGenerator(req, res). O segundo argumento só é segredo
// nos testes; em produção é o res, e o JWT_SECRET vem do ambiente.
function segredoDe(secret) {
  return typeof secret === 'string' ? secret : process.env.JWT_SECRET
}

// ipKeyGenerator precisa aparecer aqui: o express-rate-limit recusa keyGenerator que
// devolve IP sem passar por ele (IPv6 inteiro vira uma chave por endereço).
export function chaveLimite(req, secret) {
  const steamId = steamIdDaSessao(req, segredoDe(secret))
  if (steamId) return `jogador:${steamId}`
  return ipKeyGenerator(ipDe(req))
}

// No limite estrito, anônimo inclui o path. Senão um POST anônimo em /api/upload
// gastaria o mesmo balde de 10/min do webhook do Allstar, que também chega sem cookie
// e pelo mesmo IP de saída do rewrite.
export function chaveLimiteEstrito(req, secret) {
  const steamId = steamIdDaSessao(req, segredoDe(secret))
  if (steamId) return `jogador:${steamId}`
  const caminho = typeof req?.path === 'string' ? req.path : ''
  return `${ipKeyGenerator(ipDe(req))}:${caminho}`
}

// Limite generoso pra uso normal do produto, aplicado GLOBALMENTE em toda a API.
export const limiteGeral = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: { erro: 'Muitas requisições. Tente novamente em instantes.' },
  skip: pulaEmTeste,
  keyGenerator: chaveLimite,
})

// Limite apertado pra rotas sensíveis (webhook, geração de clipe pago, upload) —
// não é aplicado a nenhuma rota aqui; outras partes do código importam e aplicam nas
// rotas específicas que precisarem, além do limiteGeral global.
export const limiteEstrito = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: { erro: 'Muitas tentativas. Tente novamente em instantes.' },
  skip: pulaEmTeste,
  keyGenerator: chaveLimiteEstrito,
})
