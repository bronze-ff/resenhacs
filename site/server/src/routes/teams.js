import { Router } from 'express'

async function ehAdminDoGrupo(db, groupId, steamId) {
  const { rows } = await db.query(
    'select role from group_members where group_id = $1 and steam_id64 = $2',
    [groupId, steamId],
  )
  return rows[0]?.role === 'admin'
}

function validarMembros(body) {
  const membros = Array.isArray(body?.membros) ? body.membros.filter((s) => /^\d{17}$/.test(s)) : []
  if (membros.length === 0) return null
  return membros
}

export function createTeamsRouter({ db, requireAuth, requireGroupMember }) {
  const router = Router()

  router.post('/', requireAuth, requireGroupMember, async (req, res) => {
    if (!(await ehAdminDoGrupo(db, req.groupId, req.player.steamId))) {
      return res.status(403).json({ erro: 'Só o admin do grupo cria Times' })
    }
    const nome = String(req.body?.nome ?? '').trim()
    const membros = validarMembros(req.body)
    if (!nome) return res.status(400).json({ erro: 'Nome do Time é obrigatório' })
    if (!membros) return res.status(400).json({ erro: 'Informe ao menos 1 membro (steamId válido)' })

    const client = await db.connect()
    try {
      await client.query('begin')
      const { rows } = await client.query(
        'insert into teams (group_id, nome, criado_por) values ($1, $2, $3) returning id, nome, publico',
        [req.groupId, nome, req.player.steamId],
      )
      const time = rows[0]
      for (const steamId of membros) {
        await client.query(
          'insert into team_members (team_id, steam_id64) values ($1, $2) on conflict do nothing',
          [time.id, steamId],
        )
      }
      await client.query('commit')
      res.status(201).json({ id: time.id, nome: time.nome, publico: time.publico, membros })
    } catch (err) {
      await client.query('rollback')
      throw err
    } finally {
      client.release()
    }
  })

  router.get('/', requireAuth, requireGroupMember, async (req, res) => {
    const { rows } = await db.query(
      `select t.id, t.nome, t.publico,
              coalesce(json_agg(jsonb_build_object('steamId', p.steam_id64, 'nick', p.nick, 'avatarUrl', coalesce(p.avatar_url, sa.avatar_url)))
                filter (where p.steam_id64 is not null), '[]') as membros
       from teams t
       left join team_members tm on tm.team_id = t.id
       left join players p on p.steam_id64 = tm.steam_id64
       left join steam_avatares sa on sa.steam_id64 = p.steam_id64
       where t.group_id = $1
       group by t.id, t.nome, t.publico
       order by t.nome`,
      [req.groupId],
    )
    res.json(rows.map((t) => ({ id: t.id, nome: t.nome, publico: t.publico, membros: t.membros })))
  })

  router.patch('/:id', requireAuth, requireGroupMember, async (req, res) => {
    if (!(await ehAdminDoGrupo(db, req.groupId, req.player.steamId))) {
      return res.status(403).json({ erro: 'Só o admin do grupo edita Times' })
    }
    const dono = await db.query('select id from teams where id = $1 and group_id = $2', [req.params.id, req.groupId])
    if (dono.rows.length === 0) return res.status(404).json({ erro: 'Time não encontrado' })

    const sets = []
    const params = []
    if (typeof req.body?.nome === 'string' && req.body.nome.trim()) {
      params.push(req.body.nome.trim())
      sets.push(`nome = $${params.length}`)
    }
    if (typeof req.body?.publico === 'boolean') {
      params.push(req.body.publico)
      sets.push(`publico = $${params.length}`)
    }
    if (sets.length > 0) {
      params.push(req.params.id)
      await db.query(`update teams set ${sets.join(', ')} where id = $${params.length}`, params)
    }
    if (Array.isArray(req.body?.membros)) {
      const membros = validarMembros(req.body)
      if (!membros) return res.status(400).json({ erro: 'membros precisa ter ao menos 1 steamId válido' })
      await db.query('delete from team_members where team_id = $1', [req.params.id])
      for (const steamId of membros) {
        await db.query('insert into team_members (team_id, steam_id64) values ($1, $2)', [req.params.id, steamId])
      }
    }
    res.json({ ok: true })
  })

  router.delete('/:id', requireAuth, requireGroupMember, async (req, res) => {
    if (!(await ehAdminDoGrupo(db, req.groupId, req.player.steamId))) {
      return res.status(403).json({ erro: 'Só o admin do grupo apaga Times' })
    }
    const { rowCount } = await db.query('delete from teams where id = $1 and group_id = $2', [req.params.id, req.groupId])
    if (rowCount === 0) return res.status(404).json({ erro: 'Time não encontrado' })
    res.json({ ok: true })
  })

  // Autoriza ver um Time: membro do grupo dono do Time, OU o Time é público.
  async function autorizaTime(teamId, steamId) {
    const { rows } = await db.query(
      `select t.id, t.nome, t.group_id, t.publico, g.nome as grupo_nome
       from teams t join groups g on g.id = t.group_id
       where t.id = $1`,
      [teamId],
    )
    const time = rows[0]
    if (!time) return null
    if (time.publico) return time
    const membro = await db.query(
      'select 1 from group_members where group_id = $1 and steam_id64 = $2',
      [time.group_id, steamId],
    )
    return membro.rows.length > 0 ? time : null
  }

  async function statsDoTime(teamId) {
    const { rows } = await db.query(
      `with membros as (select steam_id64 from team_members where team_id = $1),
            presencas as (
              select mp.match_id, mp.team, mp.rating, mp.kills, mp.deaths, mp.won
              from match_players mp
              join membros me on me.steam_id64 = mp.steam_id64
              join matches m on m.id = mp.match_id
              where m.status = 'parsed'
            ),
            grupos as (
              select match_id, team, count(*) as presentes, bool_or(won) as venceu,
                     avg(rating) as rating_medio,
                     sum(kills) as kills_total, sum(deaths) as deaths_total
              from presencas
              group by match_id, team
              having count(*) >= 2
            )
       select count(*)::int as partidas,
              coalesce(sum(case when venceu then 1 else 0 end), 0)::int as vitorias,
              avg(rating_medio) as rating,
              coalesce(sum(kills_total), 0)::int as kills,
              coalesce(sum(deaths_total), 0)::int as deaths
       from grupos`,
      [teamId],
    )
    const r = rows[0]
    return {
      partidas: r.partidas,
      vitorias: r.vitorias,
      winrate: r.partidas ? Math.round((r.vitorias / r.partidas) * 1000) / 10 : 0,
      rating: r.rating === null ? null : Math.round(Number(r.rating) * 100) / 100,
      kd: r.deaths ? Math.round((r.kills / r.deaths) * 100) / 100 : r.kills,
    }
  }

  router.get('/compare', requireAuth, async (req, res) => {
    const a = String(req.query.a ?? '')
    const b = String(req.query.b ?? '')
    if (!a || !b || a === b) return res.status(400).json({ erro: 'Informe dois teamId diferentes (a e b)' })

    const [timeA, timeB] = await Promise.all([autorizaTime(a, req.player.steamId), autorizaTime(b, req.player.steamId)])
    if (!timeA) return res.status(403).json({ erro: 'Time A não é público nem do seu grupo' })
    if (!timeB) return res.status(403).json({ erro: 'Time B não é público nem do seu grupo' })

    const [statsA, statsB, confrontoQ] = await Promise.all([
      statsDoTime(a),
      statsDoTime(b),
      db.query(
        `with membros_a as (select steam_id64 from team_members where team_id = $1),
              membros_b as (select steam_id64 from team_members where team_id = $2),
              lado_a as (
                select mp.match_id, mp.team, count(*) as presentes, bool_or(mp.won) as venceu
                from match_players mp join membros_a ma on ma.steam_id64 = mp.steam_id64
                group by mp.match_id, mp.team having count(*) >= 2
              ),
              lado_b as (
                select mp.match_id, mp.team, bool_or(mp.won) as venceu
                from match_players mp join membros_b mb on mb.steam_id64 = mp.steam_id64
                group by mp.match_id, mp.team having count(*) >= 2
              )
         select la.venceu as a_venceu
         from lado_a la join lado_b lb on lb.match_id = la.match_id and lb.team <> la.team`,
        [a, b],
      ),
    ])

    const confronto = confrontoQ.rows
    res.json({
      a: { id: timeA.id, nome: timeA.nome, grupoNome: timeA.grupo_nome, stats: statsA },
      b: { id: timeB.id, nome: timeB.nome, grupoNome: timeB.grupo_nome, stats: statsB },
      confronto: {
        partidasJuntos: confronto.length,
        aVenceu: confronto.filter((r) => r.a_venceu).length,
        bVenceu: confronto.filter((r) => !r.a_venceu).length,
      },
    })
  })

  return router
}
