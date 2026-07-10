import { Router } from 'express'

function pct(parte, total) {
  if (!total) return 0
  return Math.round((parte / total) * 1000) / 10
}

export function createProfileRouter({ db, requireAuth }) {
  const router = Router()

  // Perfil do Jogador: stats agregados, por mapa, partidas recentes e Sinergia.
  router.get('/:steamId', requireAuth, async (req, res) => {
    const { steamId } = req.params
    const playerQ = await db.query(
      'select steam_id64, nick, avatar_url, is_admin from players where steam_id64 = $1',
      [steamId],
    )
    if (playerQ.rows.length === 0) return res.status(404).json({ erro: 'Jogador não encontrado' })
    const jogador = playerQ.rows[0]

    const [agg, porMapa, recentes, sinergia] = await Promise.all([
      db.query(
        `select count(*)::int as partidas,
                coalesce(sum(case when won then 1 else 0 end), 0)::int as vitorias,
                coalesce(sum(kills), 0)::int as kills,
                coalesce(sum(deaths), 0)::int as deaths,
                coalesce(sum(assists), 0)::int as assists,
                coalesce(sum(headshot_kills), 0)::int as hs,
                coalesce(sum(damage), 0)::int as damage,
                coalesce(sum(rounds_played), 0)::int as rounds,
                avg(rating) as rating
         from match_players where steam_id64 = $1`,
        [steamId],
      ),
      db.query(
        `select m.map, count(*)::int as partidas,
                coalesce(sum(case when mp.won then 1 else 0 end), 0)::int as vitorias,
                avg(mp.rating) as rating
         from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = $1 group by m.map order by partidas desc`,
        [steamId],
      ),
      db.query(
        `select m.id, m.map, m.played_at, m.score_a, m.score_b,
                mp.kills, mp.deaths, mp.rating, mp.won
         from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = $1 and m.status = 'parsed'
         order by m.played_at desc nulls last limit 20`,
        [steamId],
      ),
      db.query(
        `select p.steam_id64, p.nick, p.avatar_url, sp.partidas, sp.vitorias
         from (
           select case when steam_id_1 = $1 then steam_id_2 else steam_id_1 end as parceiro,
                  partidas, vitorias
           from synergy_pairs where steam_id_1 = $1 or steam_id_2 = $1
         ) sp
         join players p on p.steam_id64 = sp.parceiro
         order by sp.partidas desc`,
        [steamId],
      ),
    ])

    const a = agg.rows[0]
    res.json({
      jogador: { steamId: jogador.steam_id64, nick: jogador.nick, avatarUrl: jogador.avatar_url },
      stats: {
        partidas: a.partidas,
        vitorias: a.vitorias,
        winrate: pct(a.vitorias, a.partidas),
        kills: a.kills,
        deaths: a.deaths,
        assists: a.assists,
        kd: a.deaths ? Math.round((a.kills / a.deaths) * 100) / 100 : a.kills,
        hsPct: pct(a.hs, a.kills),
        adr: a.rounds ? Math.round((a.damage / a.rounds) * 10) / 10 : 0,
        rating: a.rating === null ? null : Math.round(Number(a.rating) * 100) / 100,
      },
      porMapa: porMapa.rows.map((r) => ({
        map: r.map,
        partidas: r.partidas,
        vitorias: r.vitorias,
        winrate: pct(r.vitorias, r.partidas),
        rating: r.rating === null ? null : Math.round(Number(r.rating) * 100) / 100,
      })),
      recentes: recentes.rows.map((r) => ({
        id: r.id,
        map: r.map,
        playedAt: r.played_at,
        scoreA: r.score_a,
        scoreB: r.score_b,
        kills: r.kills,
        deaths: r.deaths,
        rating: r.rating === null ? null : Number(r.rating),
        won: r.won,
      })),
      sinergia: sinergia.rows.map((s) => ({
        steamId: s.steam_id64,
        nick: s.nick,
        avatarUrl: s.avatar_url,
        partidas: s.partidas,
        vitorias: s.vitorias,
        winrate: pct(s.vitorias, s.partidas),
      })),
    })
  })

  return router
}
