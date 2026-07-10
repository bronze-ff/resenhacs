import { Router } from 'express'

function pct(parte, total) {
  if (!total) return 0
  return Math.round((parte / total) * 1000) / 10
}

export function createRankingRouter({ db, requireAuth }) {
  const router = Router()

  // Ranking interno do grupo: agrega os stats de cada Jogador em todas as Partidas.
  router.get('/', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      `select p.steam_id64, p.nick, p.avatar_url,
              count(mp.match_id)::int as partidas,
              coalesce(sum(case when mp.won then 1 else 0 end), 0)::int as vitorias,
              coalesce(sum(mp.kills), 0)::int as kills,
              coalesce(sum(mp.deaths), 0)::int as deaths,
              coalesce(sum(mp.headshot_kills), 0)::int as hs,
              avg(mp.rating) as rating,
              coalesce((select count(*) from highlights h
                        where h.steam_id64 = p.steam_id64 and h.kind = 'ace'), 0)::int as aces,
              coalesce(sum(mp.clutch_wins), 0)::int as clutch_wins,
              coalesce(sum(mp.clutch_attempts), 0)::int as clutch_attempts
       from players p
       left join match_players mp on mp.steam_id64 = p.steam_id64
       group by p.steam_id64, p.nick, p.avatar_url`,
    )

    const ranking = rows
      .map((r) => ({
        steamId: r.steam_id64,
        nick: r.nick,
        avatarUrl: r.avatar_url,
        partidas: r.partidas,
        vitorias: r.vitorias,
        winrate: pct(r.vitorias, r.partidas),
        kills: r.kills,
        kd: r.deaths ? Math.round((r.kills / r.deaths) * 100) / 100 : r.kills,
        hsPct: pct(r.hs, r.kills),
        rating: r.rating === null ? null : Math.round(Number(r.rating) * 100) / 100,
        aces: r.aces,
        clutchWins: r.clutch_wins,
        clutchAttempts: r.clutch_attempts,
        clutchPct: pct(r.clutch_wins, r.clutch_attempts),
      }))
      .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))

    res.json(ranking)
  })

  return router
}
