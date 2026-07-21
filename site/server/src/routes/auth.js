import { Router } from 'express'
import { buildSteamRedirectUrl } from '../steam/openid.js'
import { signToken } from '../auth/jwt.js'
import { parCanonico } from '../friendships.js'

export function createAuthRouter({ config, db, verifySteamLogin, fetchPersona, fetchFriendList, requireAuth }) {
  const router = Router()

  router.get('/steam', (req, res) => {
    const returnTo = String(req.query.returnTo ?? '')
    // só aceita path relativo interno — nunca um destino externo (open redirect).
    if (/^\/[a-zA-Z0-9/_-]*$/.test(returnTo)) {
      res.cookie('resenha_post_login', returnTo, { httpOnly: true, secure: config.isProduction, sameSite: 'lax', maxAge: 5 * 60 * 1000 })
    }
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

    // Login aberto: qualquer conta Steam entra (privacidade vem do isolamento por grupo,
    // não de uma whitelist global). Upsert em vez de lookup-que-bloqueia. `conta_criada_em`
    // marca a conta como real (usado pelo auto-friend abaixo, e por lógica futura de
    // amizade): no insert vira `now()`; num conflito, `coalesce` preserva o valor já
    // gravado (nunca sobrescreve) e só carimba se ainda estava null (linha pré-migração).
    const insertQ = await db.query(
      `insert into players (steam_id64, conta_criada_em) values ($1, now())
       on conflict (steam_id64) do update set conta_criada_em = coalesce(players.conta_criada_em, now())
       returning steam_id64, is_super_admin`,
      [steamId],
    )
    const jogador = insertQ.rows[0] ?? (await db.query(
      'select steam_id64, is_super_admin from players where steam_id64 = $1',
      [steamId],
    )).rows[0]

    const persona = await fetchPersona(steamId)
    if (persona) {
      await db.query('update players set nick = $2, avatar_url = $3 where steam_id64 = $1', [
        steamId,
        persona.nick,
        persona.avatarUrl,
      ])
    }

    // Auto-friend: amigos Steam que já têm conta no Resenha viram amizade accepted direta
    // (aceite implícito). Best-effort — perfil Steam privado devolve lista vazia; falha de
    // rede não pode atrapalhar o login (try/catch, mesmo padrão do fetch de bans).
    try {
      const steamFriends = await fetchFriendList(steamId)
      if (steamFriends.length > 0) {
        const comConta = await db.query(
          'select steam_id64 from players where steam_id64 = any($1) and conta_criada_em is not null',
          [steamFriends],
        )
        for (const { steam_id64: amigo } of comConta.rows) {
          const [a, b] = parCanonico(steamId, amigo)
          await db.query(
            `insert into friendships (player_a, player_b, status, requested_by, accepted_at)
             values ($1, $2, 'accepted', $3, now()) on conflict (player_a, player_b) do nothing`,
            [a, b, steamId],
          )
        }
      }
    } catch (e) {
      console.error('auto-friend Steam falhou (ignorado):', e.message)
    }

    const token = signToken({ steamId, isSuperAdmin: jogador.is_super_admin }, config.jwtSecret)
    res.cookie('resenha_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
    const destino = req.cookies?.resenha_post_login
    res.clearCookie('resenha_post_login')
    res.redirect(destino ? `${config.appUrl}${destino}` : config.appUrl)
  })

  router.get('/me', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      'select steam_id64, nick, avatar_url, is_super_admin, grupo_ativo_id, faceit_nick, tour_concluido from players where steam_id64 = $1',
      [req.player.steamId],
    )
    if (rows.length === 0) return res.status(401).json({ erro: 'Jogador não encontrado' })
    const p = rows[0]
    let souAdminDoGrupo
    if (p.grupo_ativo_id) {
      const papel = await db.query(
        'select role from group_members where group_id = $1 and steam_id64 = $2',
        [p.grupo_ativo_id, p.steam_id64],
      )
      souAdminDoGrupo = papel.rows[0]?.role === 'admin'
    }
    res.json({
      steamId: p.steam_id64,
      nick: p.nick,
      avatarUrl: p.avatar_url,
      isSuperAdmin: p.is_super_admin,
      grupoAtivoId: p.grupo_ativo_id,
      faceitNick: p.faceit_nick,
      tourConcluido: p.tour_concluido,
      ...(souAdminDoGrupo !== undefined ? { souAdminDoGrupo } : {}),
    })
  })

  router.post('/logout', (req, res) => {
    res.clearCookie('resenha_token')
    res.json({ ok: true })
  })

  return router
}
