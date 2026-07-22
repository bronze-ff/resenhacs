import rateLimit from 'express-rate-limit'

// Auditoria finding #9 (ausência de rate limiting como defesa em profundidade): sem isso,
// rotas sensíveis ficam abertas a abuso ilimitado por um único IP mesmo com
// requireAuth/requireSuperAdmin no lugar. Neste worktree, hoje, `limiteEstrito` só está
// aplicado nas rotas de competições (admin + submissões) — webhook/upload/login ainda
// contam só com o `limiteGeral` global (ver app.js) até alguém aplicar `limiteEstrito`
// neles também.
//
// Portado de `main` (commit 510ff47) pro worktree `worktree-amizades-substitui-grupos`, que
// divergiu antes desse commit e nunca recebeu o arquivo. Ver Task 7 do plano de Competições
// de Clipes e a correção pós-revisão dessa mesma task.
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

// Limite apertado pra rotas sensíveis (hoje: admin de competições e submissões — ver
// routes/competicoes.js) — outras rotas sensíveis (login, webhook, upload) ainda
// podem importar e aplicar este mesmo limiter quando alguém tratar disso.
export const limiteEstrito = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: { erro: 'Muitas tentativas. Tente novamente em instantes.' },
  skip: pulaEmTeste,
})
