import jwt from 'jsonwebtoken'

export function signToken({ steamId, isSuperAdmin }, secret) {
  return jwt.sign({ steamId, isSuperAdmin }, secret, { expiresIn: '7d', algorithm: 'HS256' })
}

export function verifyToken(token, secret) {
  try {
    // Fixa o algoritmo: sem isso, a validacao aceitaria qualquer alg da lib — defesa em
    // profundidade contra confusao de algoritmo caso o segredo vire par de chaves no futuro.
    return jwt.verify(token, secret, { algorithms: ['HS256'] })
  } catch {
    return null
  }
}
