import jwt from 'jsonwebtoken'

const DIA = 86400
const ESCOPO = 'extensao-upload'
const STEAM_ID = /^\d{17}$/
const chave = (segredo) => typeof segredo === 'string' && segredo ? `${segredo}:${ESCOPO}` : null

export function assinarTokenExtensao({ steamId, conectadoEm = Math.floor(Date.now() / 1000) }, segredo) {
  const iat = Math.floor(Date.now() / 1000)
  if (!chave(segredo) || typeof steamId !== 'string' || !STEAM_ID.test(steamId) ||
    !Number.isSafeInteger(conectadoEm) || conectadoEm < 0 || conectadoEm > iat || conectadoEm + 30 * DIA <= iat) return null
  const exp = Math.min(iat + DIA, conectadoEm + 30 * DIA)
  const token = jwt.sign({ steamId, escopo: ESCOPO, conectadoEm, iat, exp }, chave(segredo), { algorithm: 'HS256' })
  return { token, expiraEm: new Date(exp * 1000).toISOString() }
}

function verificar(token, segredo) {
  try {
    if (!chave(segredo) || typeof token !== 'string' || token.length > 2048) return null
    const payload = jwt.verify(token, chave(segredo), { algorithms: ['HS256'] })
    const { steamId, escopo, conectadoEm, iat, exp } = payload
    if (escopo !== ESCOPO || typeof steamId !== 'string' || !STEAM_ID.test(steamId) ||
      !Number.isSafeInteger(conectadoEm) || !Number.isSafeInteger(iat) || !Number.isSafeInteger(exp) ||
      conectadoEm < 0 || conectadoEm > iat || iat > Math.floor(Date.now() / 1000) ||
      exp <= iat || exp > iat + DIA || exp > conectadoEm + 30 * DIA) return null
    return payload
  } catch { return null }
}

export function renovarTokenExtensao(token, segredo) {
  const payload = verificar(token, segredo)
  return payload ? assinarTokenExtensao(payload, segredo) : null
}

export function createRequireExtensao(segredo, db) {
  return async (req, res, next) => {
    const token = req.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
    const payload = verificar(token, segredo)
    if (!payload) return res.status(401).json({ erro: 'Não autenticado' })
    try {
      const { rows } = await db.query('select tokens_validos_apos from players where steam_id64 = $1', [payload.steamId])
      if (!rows.length) return res.status(401).json({ erro: 'Não autenticado' })
      // A conexão também é revogada: renovar não pode ressuscitar token após logout.
      if (rows[0].tokens_validos_apos && payload.conectadoEm * 1000 < new Date(rows[0].tokens_validos_apos).getTime()) {
        return res.status(401).json({ erro: 'Não autenticado' })
      }
    } catch { return res.status(500).json({ erro: 'Erro interno' }) }
    req.player = { steamId: payload.steamId }
    next()
  }
}
