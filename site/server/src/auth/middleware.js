import { verifyToken } from './jwt.js'

// `db` é usado pra checar revogação de sessão (finding #3 da auditoria de segurança):
// logout só limpava o cookie no navegador, o JWT em si continuava válido no servidor até
// expirar (7 dias) — se vazasse por qualquer via fora do navegador da vítima, continuava
// autenticado mesmo após o "logout". tokens_validos_apos (players) marca o instante do
// último logout; qualquer token com `iat` anterior a isso é rejeitado.
export function createRequireAuth(jwtSecret, db) {
  return async function requireAuth(req, res, next) {
    const payload = verifyToken(req.cookies?.resenha_token, jwtSecret)
    if (!payload) return res.status(401).json({ erro: 'Não autenticado' })
    try {
      const { rows } = await db.query(
        'select tokens_validos_apos from players where steam_id64 = $1',
        [payload.steamId],
      )
      const tokensValidosApos = rows[0]?.tokens_validos_apos
      if (tokensValidosApos && payload.iat && payload.iat * 1000 < new Date(tokensValidosApos).getTime()) {
        return res.status(401).json({ erro: 'Sessão expirada, faça login novamente' })
      }
    } catch {
      return res.status(500).json({ erro: 'Erro interno' })
    }
    req.player = { steamId: payload.steamId, isSuperAdmin: Boolean(payload.isSuperAdmin) }
    next()
  }
}

// Reconsulta players.is_super_admin no banco (fonte viva) em vez de confiar só no claim do
// JWT de 7 dias — assim rebaixar um admin tem efeito IMEDIATO, sem esperar o token expirar.
// Só custa uma query pros tokens que JÁ afirmam ser admin (raros); requisição comum é barrada
// na hora pelo claim, sem tocar no banco. Falha fechada (500 se a query cair).
export function createRequireSuperAdmin(db) {
  return async function requireSuperAdmin(req, res, next) {
    if (!req.player?.isSuperAdmin) return res.status(403).json({ erro: 'Apenas administradores' })
    let ehAdmin = false
    try {
      const { rows } = await db.query('select is_super_admin from players where steam_id64 = $1', [req.player.steamId])
      ehAdmin = Boolean(rows[0]?.is_super_admin)
    } catch {
      return res.status(500).json({ erro: 'Erro interno' })
    }
    if (!ehAdmin) return res.status(403).json({ erro: 'Apenas administradores' })
    next()
  }
}
