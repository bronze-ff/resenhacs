import { Router } from 'express'

function pct(parte, total) {
  if (!total) return 0
  return Math.round((parte / total) * 1000) / 10
}

export function createRankingPublicoRouter({ db }) {
  const router = Router()

  router.get('/jogadores', async (req, res) => {
    const { rows } = await db.query(
      `select p.steam_id64, p.nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url,
              count(mp.match_id)::int as partidas,
              coalesce(sum(case when mp.won then 1 else 0 end), 0)::int as vitorias,
              coalesce(sum(mp.kills), 0)::int as kills,
              coalesce(sum(mp.deaths), 0)::int as deaths,
              avg(mp.rating) as rating
       from players p
       left join steam_avatares sa on sa.steam_id64 = p.steam_id64
       left join match_players mp on mp.steam_id64 = p.steam_id64
       where p.ranking_publico = true
       group by p.steam_id64, p.nick, p.avatar_url, sa.avatar_url
       having count(mp.match_id) > 0
       order by avg(mp.rating) desc nulls last`,
      [],
    )
    res.json(
      rows.map((r) => ({
        steamId: r.steam_id64,
        nick: r.nick,
        avatarUrl: r.avatar_url,
        partidas: r.partidas,
        vitorias: r.vitorias,
        winrate: pct(r.vitorias, r.partidas),
        kd: r.deaths ? Math.round((r.kills / r.deaths) * 100) / 100 : r.kills,
        rating: r.rating === null ? null : Math.round(Number(r.rating) * 100) / 100,
      })),
    )
  })

  router.get('/times', async (req, res) => {
    const { rows } = await db.query(
      `with membros as (
         select tm.team_id, tm.steam_id64 from team_members tm
       ),
       presencas as (
         select me.team_id, mp.match_id, mp.team, mp.rating, mp.won
         from match_players mp
         join membros me on me.steam_id64 = mp.steam_id64
         join matches m on m.id = mp.match_id
         where m.status = 'parsed'
       ),
       grupos as (
         select team_id, match_id, team, count(*) as presentes, bool_or(won) as venceu, avg(rating) as rating_medio
         from presencas
         group by team_id, match_id, team
         having count(*) >= 2
       )
       select t.id, t.nome, g.nome as grupo_nome,
              coalesce(count(gr.match_id), 0)::int as partidas,
              coalesce(sum(case when gr.venceu then 1 else 0 end), 0)::int as vitorias,
              avg(gr.rating_medio) as rating
       from teams t
       join groups g on g.id = t.group_id
       left join grupos gr on gr.team_id = t.id
       where t.publico = true
       group by t.id, t.nome, g.nome
       order by avg(gr.rating_medio) desc nulls last`,
      [],
    )
    res.json(
      rows.map((t) => ({
        id: t.id,
        nome: t.nome,
        grupoNome: t.grupo_nome,
        partidas: t.partidas,
        vitorias: t.vitorias,
        winrate: pct(t.vitorias, t.partidas),
        rating: t.rating === null ? null : Math.round(Number(t.rating) * 100) / 100,
      })),
    )
  })

  return router
}
