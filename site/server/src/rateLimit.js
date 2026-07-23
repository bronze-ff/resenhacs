import rateLimit from 'express-rate-limit'

// Auditoria finding #1 (ausência total de rate limiting): sem isso qualquer rota — login,
// geração de clipe pago no Allstar, upload, webhook — fica aberta a abuso ilimitado por
// um único IP (força bruta, scraping, estourar custo de API paga de terceiro).
//
// Em teste, o vitest já seta NODE_ENV=test sozinho (sem precisar configurar nada aqui) e
// os arquivos de teste disparam dezenas de requisições supertest seguidas pro mesmo app,
// todas do mesmo IP de loopback — e como os limiters abaixo são singletons de módulo, o
// contador é compartilhado por TODOS os testes de um mesmo arquivo. Pulamos o rate limit
// nesse ambiente pra suíte não esbarrar em 429 por causa dela mesma, não do código testado.
const pulaEmTeste = () => process.env.NODE_ENV === 'test'

// Limite generoso pra uso normal do produto, aplicado GLOBALMENTE em toda a API.
export const limiteGeral = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: { erro: 'Muitas requisições. Tente novamente em instantes.' },
  skip: pulaEmTeste,
})

// Limite apertado pra rotas sensíveis (login, webhook, geração de clipe pago, upload) —
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
})
