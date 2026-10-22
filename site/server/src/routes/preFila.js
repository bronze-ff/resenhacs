import { Router } from 'express'
import { partidaVisivelExpr } from '../friendships.js'
import { montarPreFila } from '../preFila.js'

export function createPreFilaRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const eu = req.player.steamId
    const amigos = typeof req.query.jogadores === 'string' ? req.query.jogadores.split(',') : []
    if (amigos.length < 1 || amigos.length > 4 || new Set(amigos).size !== amigos.length
      || amigos.some(id => id.length !== 17 || !/^\d{17}$/.test(id) || id === eu)) {
      return res.status(400).json({ erro: 'Escolha de 1 a 4 amigos.' })
    }
    const ids = [eu, ...amigos]
    const params = [ids, eu]
    const jogadoresQ = await db.query(
      `select p.steam_id64, coalesce(p.nick, '') as nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url
       from players p
       left join steam_avatares sa on sa.steam_id64 = p.steam_id64
       where p.steam_id64 = any($1::text[])
         and (p.steam_id64 = $2 or exists (
           select 1 from friendships f where f.status = 'accepted'
             and ((f.player_a = $2 and f.player_b = p.steam_id64)
               or (f.player_b = $2 and f.player_a = p.steam_id64))))`,
      params,
    )
    const porId = new Map(jogadoresQ.rows.map(r => [r.steam_id64, r]))
    if (ids.some(id => !porId.has(id))) {
      return res.status(400).json({ erro: 'Só amigos entram na Pré-fila.' })
    }

    const [grupo, individual, duplas] = await Promise.all([
      db.query(
        `select map, count(*)::int as partidas,
                count(*) filter (where won)::int as vitorias,
                count(*) filter (where won is not null)::int as decididas
         from (
           select m.id, m.map, bool_or(mp.won) as won
           from match_players mp join matches m on m.id = mp.match_id
           where mp.steam_id64 = any($1::text[]) and m.status = 'parsed' and m.map is not null
             and ${partidaVisivelExpr('m', '$2')}
           group by m.id, m.map, mp.team
           having count(distinct mp.steam_id64) = cardinality($1::text[])
         ) grupo
         group by map`,
        params,
      ),
      db.query(
        `select m.map, count(*)::int as partidas,
                count(*) filter (where mp.won)::int as vitorias,
                count(*) filter (where mp.won is not null)::int as decididas
         from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = any($1::text[]) and m.status = 'parsed' and m.map is not null
           and ${partidaVisivelExpr('m', '$2')}
         group by m.map`,
        params,
      ),
      db.query(
        `select mp1.steam_id64 as a, mp2.steam_id64 as b, count(*)::int as partidas,
                count(*) filter (where mp1.won)::int as vitorias,
                count(*) filter (where mp1.won is not null)::int as decididas
         from match_players mp1 join matches m on m.id = mp1.match_id
         join match_players mp2 on mp2.match_id = mp1.match_id and mp2.team = mp1.team
           and mp1.steam_id64 < mp2.steam_id64
         where mp1.steam_id64 = any($1::text[]) and mp2.steam_id64 = any($1::text[])
           and m.status = 'parsed' and ${partidaVisivelExpr('m', '$2')}
         group by mp1.steam_id64, mp2.steam_id64`,
        params,
      ),
    ])
    const jogadores = ids.map(id => {
      const r = porId.get(id)
      return { steamId: id, nick: r.nick, avatarUrl: r.avatar_url }
    })
    res.json(montarPreFila({ jogadores, grupo: grupo.rows, individual: individual.rows, duplas: duplas.rows }))
  })

  return router
}
