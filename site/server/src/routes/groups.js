import { Router } from 'express'

export function createGroupsRouter({ db }) {
  const router = Router()

  router.post('/', async (req, res) => {
    const nome = String(req.body?.nome ?? '').trim()
    if (!nome || nome.length > 60) {
      return res.status(400).json({ erro: 'Nome do grupo é obrigatório (até 60 caracteres)' })
    }
    const client = await db.connect()
    try {
      await client.query('begin')
      const { rows } = await client.query(
        'insert into groups (nome, criado_por) values ($1, $2) returning id, nome',
        [nome, req.player.steamId],
      )
      const grupo = rows[0]
      await client.query(
        "insert into group_members (group_id, steam_id64, role) values ($1, $2, 'admin')",
        [grupo.id, req.player.steamId],
      )
      await client.query('update players set grupo_ativo_id = $1 where steam_id64 = $2', [
        grupo.id,
        req.player.steamId,
      ])
      await client.query('commit')
      res.status(201).json({ id: grupo.id, nome: grupo.nome })
    } catch (err) {
      await client.query('rollback')
      throw err
    } finally {
      client.release()
    }
  })

  router.get('/meus', async (req, res) => {
    const { rows } = await db.query(
      `select g.id, g.nome, gm.role
       from group_members gm join groups g on g.id = gm.group_id
       where gm.steam_id64 = $1 order by g.nome`,
      [req.player.steamId],
    )
    res.json(rows.map((r) => ({ id: r.id, nome: r.nome, role: r.role })))
  })

  router.put('/ativo', async (req, res) => {
    const groupId = String(req.body?.groupId ?? '')
    const { rows } = await db.query(
      'select 1 from group_members where group_id = $1 and steam_id64 = $2',
      [groupId, req.player.steamId],
    )
    if (rows.length === 0) return res.status(403).json({ erro: 'Você não pertence a esse grupo' })
    await db.query('update players set grupo_ativo_id = $1 where steam_id64 = $2', [
      groupId,
      req.player.steamId,
    ])
    res.json({ ok: true, groupId })
  })

  router.post('/:id/convites', async (req, res) => {
    const { rows: membro } = await db.query(
      'select role from group_members where group_id = $1 and steam_id64 = $2',
      [req.params.id, req.player.steamId],
    )
    if (membro.length === 0 || membro[0].role !== 'admin') {
      return res.status(403).json({ erro: 'Só o admin do grupo pode gerar convite' })
    }
    const { rows } = await db.query(
      'insert into group_invites (group_id, criado_por) values ($1, $2) returning token',
      [req.params.id, req.player.steamId],
    )
    res.status(201).json({ token: rows[0].token })
  })

  return router
}

export function createConvitesRouter({ db }) {
  const router = Router()

  router.get('/:token', async (req, res) => {
    const { rows } = await db.query(
      `select gi.revogado_em, g.nome
       from group_invites gi join groups g on g.id = gi.group_id
       where gi.token = $1`,
      [req.params.token],
    )
    if (rows.length === 0) return res.status(404).json({ erro: 'Convite não encontrado' })
    if (rows[0].revogado_em) return res.status(410).json({ erro: 'Convite revogado' })
    res.json({ grupoNome: rows[0].nome })
  })

  router.post('/:token/aceitar', async (req, res) => {
    const { rows } = await db.query(
      `select gi.group_id, gi.revogado_em, g.nome
       from group_invites gi join groups g on g.id = gi.group_id
       where gi.token = $1`,
      [req.params.token],
    )
    if (rows.length === 0) return res.status(404).json({ erro: 'Convite não encontrado' })
    if (rows[0].revogado_em) return res.status(410).json({ erro: 'Convite revogado' })
    const groupId = rows[0].group_id
    await db.query(
      `insert into group_members (group_id, steam_id64) values ($1, $2)
       on conflict (group_id, steam_id64) do nothing`,
      [groupId, req.player.steamId],
    )
    await db.query('update players set grupo_ativo_id = $1 where steam_id64 = $2', [
      groupId,
      req.player.steamId,
    ])
    // Retroage: as partidas do grupo em que o novo membro já aparece (o SteamID dele já está
    // em match_players, gravado quando outro membro processou a demo) passam a contar como dele
    // — tracked, entram no ranking e no resultado do grupo, não só no perfil. Só vira um flag;
    // não ingere nada, então não há como duplicar partida (a dedup é no Coletor, por
    // fingerprint/share_code, quando ele baixar as demos antigas do próprio código dele).
    await db.query(
      `update match_players mp set is_tracked = true
       from matches m
       where m.id = mp.match_id and m.group_id = $1 and mp.steam_id64 = $2`,
      [groupId, req.player.steamId],
    )
    res.json({ ok: true, groupId, nome: rows[0].nome })
  })

  return router
}
