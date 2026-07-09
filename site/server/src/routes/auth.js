import { Router } from 'express'
import { buildSteamRedirectUrl } from '../steam/openid.js'
import { signToken } from '../auth/jwt.js'

export function createAuthRouter({ config, db, verifySteamLogin, fetchPersona, requireAuth }) {
  const router = Router()

  router.get('/steam', (req, res) => {
    res.redirect(buildSteamRedirectUrl(config.appUrl))
  })

  router.get('/steam/return', async (req, res) => {
    const login = await verifySteamLogin(req.query, config.appUrl)
    if (!login) return res.redirect(`${config.appUrl}/?erro=login-invalido`)
    const { steamId, nonce } = login

    // Replay: o nonce só vale uma vez. insert-on-conflict; se já existia, rowCount = 0.
    const nonceInsert = await db.query(
      'insert into used_openid_nonces (nonce) values ($1) on conflict (nonce) do nothing returning nonce',
      [nonce],
    )
    if (nonceInsert.rowCount === 0) return res.redirect(`${config.appUrl}/?erro=login-invalido`)

    const { rows } = await db.query(
      'select steam_id64, is_admin from players where steam_id64 = $1',
      [steamId],
    )
    if (rows.length === 0) return res.redirect(`${config.appUrl}/acesso-negado`)

    const persona = await fetchPersona(steamId)
    if (persona) {
      await db.query('update players set nick = $2, avatar_url = $3 where steam_id64 = $1', [
        steamId,
        persona.nick,
        persona.avatarUrl,
      ])
    }

    const token = signToken({ steamId, isAdmin: rows[0].is_admin }, config.jwtSecret)
    res.cookie('resenha_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
    res.redirect(config.appUrl)
  })

  router.get('/me', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      'select steam_id64, nick, avatar_url, is_admin from players where steam_id64 = $1',
      [req.player.steamId],
    )
    if (rows.length === 0) return res.status(401).json({ erro: 'Jogador não encontrado' })
    const p = rows[0]
    res.json({ steamId: p.steam_id64, nick: p.nick, avatarUrl: p.avatar_url, isAdmin: p.is_admin })
  })

  router.post('/logout', (req, res) => {
    res.clearCookie('resenha_token')
    res.json({ ok: true })
  })

  return router
}
