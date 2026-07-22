import { Router } from 'express'
import { createRequireSuperAdmin } from '../auth/middleware.js'

export function createPlayersRouter({ db, requireAuth, fetchBans }) {
  const router = Router()
  const requireSuperAdmin = createRequireSuperAdmin(db)

  // Alerta de ban/smurf: cruza eu + meus amigos accepted com GetPlayerBans da Steam —
  // "a conta de algum amigo tomou VAC/Overwatch ban?" Precisa vir antes de
  // qualquer rota "/:algo" (não tem hoje em players.js, mas por hábito/segurança).
  router.get('/bans', requireAuth, async (req, res) => {
    if (!fetchBans) return res.status(503).json({ erro: 'Checagem de ban não configurada (falta STEAM_API_KEY)' })
    const eu = req.player.steamId
    // Escopado por amizade: checa ban só de mim + amigos accepted, não do roster global do
    // sistema inteiro (era vazamento de SteamID+nick de todo mundo pra qualquer logado).
    const { rows } = await db.query(
      `select p.steam_id64, p.nick
       from players p
       where p.steam_id64 = $1 or p.steam_id64 in (
         select case when f.player_a = $1 then f.player_b else f.player_a end
         from friendships f where (f.player_a = $1 or f.player_b = $1) and f.status = 'accepted')
       order by p.nick`,
      [eu],
    )
    const bans = await fetchBans(rows.map((p) => p.steam_id64))
    const porId = new Map(bans.map((b) => [b.steamId, b]))
    res.json(
      rows.map((p) => ({
        steamId: p.steam_id64,
        nick: p.nick,
        ban: porId.get(p.steam_id64) ?? null,
      })),
    )
  })

  router.get('/', requireAuth, async (req, res) => {
    const eu = req.player.steamId
    const { rows } = await db.query(
      `select p.steam_id64, p.nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url, p.is_super_admin
       from players p
       left join steam_avatares sa on sa.steam_id64 = p.steam_id64
       where p.steam_id64 = $1 or p.steam_id64 in (
         select case when f.player_a = $1 then f.player_b else f.player_a end
         from friendships f where (f.player_a = $1 or f.player_b = $1) and f.status = 'accepted')
       order by p.nick`,
      [eu],
    )
    res.json(
      rows.map((p) => ({
        steamId: p.steam_id64,
        nick: p.nick,
        avatarUrl: p.avatar_url,
        // isSuperAdmin só vai no próprio registro do jogador logado — pra qualquer amigo,
        // isso é reconhecimento de alvo de maior privilégio (client não usa esse campo
        // pros outros jogadores da lista, só pro `jogador` do /api/auth/me).
        ...(p.steam_id64 === eu ? { isSuperAdmin: p.is_super_admin } : {}),
      })),
    )
  })

  router.post('/', requireAuth, requireSuperAdmin, async (req, res) => {
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
  router.post('/promote', requireAuth, requireSuperAdmin, async (req, res) => {
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

  router.put('/me/tour-concluido', requireAuth, async (req, res) => {
    await db.query('update players set tour_concluido = true where steam_id64 = $1', [req.player.steamId])
    res.json({ ok: true })
  })

  return router
}
