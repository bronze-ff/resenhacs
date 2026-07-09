import jwt from 'jsonwebtoken'

export function signToken({ steamId, isAdmin }, secret) {
  return jwt.sign({ steamId, isAdmin }, secret, { expiresIn: '7d' })
}

export function verifyToken(token, secret) {
  try {
    return jwt.verify(token, secret)
  } catch {
    return null
  }
}
