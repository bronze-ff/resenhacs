import { verifyToken } from './jwt.js'

export function createRequireAuth(jwtSecret) {
  return function requireAuth(req, res, next) {
    const payload = verifyToken(req.cookies?.resenha_token, jwtSecret)
    if (!payload) return res.status(401).json({ erro: 'Não autenticado' })
    req.player = { steamId: payload.steamId, isAdmin: Boolean(payload.isAdmin) }
    next()
  }
}

export function requireAdmin(req, res, next) {
  if (!req.player?.isAdmin) return res.status(403).json({ erro: 'Apenas administradores' })
  next()
}
