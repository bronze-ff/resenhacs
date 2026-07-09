import { Router } from 'express'
import { requireAdmin } from '../auth/middleware.js'

export function createPlayersRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      'select steam_id64, nick, avatar_url, is_admin from players order by nick',
    )
    res.json(
      rows.map((p) => ({
        steamId: p.steam_id64,
        nick: p.nick,
        avatarUrl: p.avatar_url,
        isAdmin: p.is_admin,
      })),
    )
  })

  router.post('/', requireAuth, requireAdmin, async (req, res) => {
    const steamId = String(req.body?.steamId ?? '')
    if (!/^\d{17}$/.test(steamId)) {
      return res.status(400).json({ erro: 'steamId deve ser o SteamID64 (17 dígitos)' })
    }
    await db.query(
      'insert into players (steam_id64) values ($1) on conflict (steam_id64) do nothing',
      [steamId],
    )
    res.status(201).json({ ok: true })
  })

  // Onboarding: o próprio Jogador informa seu código de autenticação de histórico e
  // o último share code, sementes de que o Coletor (Fase 2) precisa para achar Partidas.
  router.put('/me', requireAuth, async (req, res) => {
    const matchAuthCode = String(req.body?.matchAuthCode ?? '').trim()
    const lastShareCode = String(req.body?.lastShareCode ?? '').trim()
    if (!/^[\w-]{4,32}$/.test(matchAuthCode)) {
      return res.status(400).json({ erro: 'Código de autenticação inválido' })
    }
    if (!/^CSGO(-\S{5}){5}$/.test(lastShareCode)) {
      return res.status(400).json({ erro: 'Share code inválido (formato CSGO-…-…-…-…-…)' })
    }
    await db.query(
      'update players set match_auth_code = $2, last_share_code = $3 where steam_id64 = $1',
      [req.player.steamId, matchAuthCode, lastShareCode],
    )
    res.json({ ok: true })
  })

  return router
}
