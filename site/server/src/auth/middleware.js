import { verifyToken } from './jwt.js'

export function createRequireAuth(jwtSecret) {
  return function requireAuth(req, res, next) {
    const payload = verifyToken(req.cookies?.resenha_token, jwtSecret)
    if (!payload) return res.status(401).json({ erro: 'Não autenticado' })
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createRequireGroupMember(db) {
  return async function requireGroupMember(req, res, next) {
    const groupId = req.get('X-Group-Id')
    if (!groupId || !UUID_RE.test(groupId)) {
      return res.status(400).json({ erro: 'Cabeçalho X-Group-Id ausente ou inválido' })
    }
    const { rows } = await db.query(
      'select 1 from group_members where group_id = $1 and steam_id64 = $2',
      [groupId, req.player.steamId],
    )
    if (rows.length === 0) return res.status(403).json({ erro: 'Você não pertence a esse grupo' })
    req.groupId = groupId
    next()
  }
}
