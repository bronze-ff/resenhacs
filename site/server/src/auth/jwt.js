import jwt from 'jsonwebtoken'

export function signToken({ steamId, isSuperAdmin }, secret) {
  return jwt.sign({ steamId, isSuperAdmin }, secret, { expiresIn: '7d' })
}

export function verifyToken(token, secret) {
  try {
    return jwt.verify(token, secret)
  } catch {
    return null
  }
}
