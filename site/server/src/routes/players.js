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
    // Retroage is_tracked: partidas antigas desse steamId (de antes de entrar na
    // whitelist) passam a contar pra Sinergia e pro perfil, não só as futuras.
    await db.query('update match_players set is_tracked = true where steam_id64 = $1', [steamId])
    res.status(201).json({ ok: true })
  })

  // Promove um Participante (já visto em alguma Partida) a Jogador com um clique,
  // sem precisar digitar o SteamID64 na mão — puxa o nick do histórico de partidas.
  router.post('/promote', requireAuth, requireAdmin, async (req, res) => {
    const steamId = String(req.body?.steamId ?? '')
    if (!/^\d{17}$/.test(steamId)) {
      return res.status(400).json({ erro: 'steamId deve ser o SteamID64 (17 dígitos)' })
    }
    const nickQ = await db.query(
      `select mp.nick from match_players mp join matches m on m.id = mp.match_id
       where mp.steam_id64 = $1 order by m.played_at desc nulls last limit 1`,
      [steamId],
    )
    const nick = nickQ.rows[0]?.nick ?? ''
    await db.query(
      'insert into players (steam_id64, nick) values ($1, $2) on conflict (steam_id64) do nothing',
      [steamId, nick],
    )
    await db.query('update match_players set is_tracked = true where steam_id64 = $1', [steamId])
    res.status(201).json({ ok: true, nick })
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
