import { Router } from 'express'

function pct(parte, total) {
  if (!total) return 0
  return Math.round((parte / total) * 1000) / 10
}

async function statsAgregados(db, steamId) {
  const { rows } = await db.query(
    `select count(*)::int as partidas,
            coalesce(sum(case when won then 1 else 0 end), 0)::int as vitorias,
            coalesce(sum(kills), 0)::int as kills,
            coalesce(sum(deaths), 0)::int as deaths,
            coalesce(sum(assists), 0)::int as assists,
            coalesce(sum(headshot_kills), 0)::int as hs,
            coalesce(sum(damage), 0)::int as damage,
            coalesce(sum(rounds_played), 0)::int as rounds,
            avg(rating) as rating,
            coalesce(sum(utility_damage), 0)::int as utility_damage,
            coalesce(sum(shots_fired), 0)::int as shots_fired,
            coalesce(sum(shots_hit), 0)::int as shots_hit,
            coalesce(sum(entry_kills), 0)::int as entry_kills,
            coalesce(sum(entry_deaths), 0)::int as entry_deaths,
            coalesce(sum(entry_wins), 0)::int as entry_wins,
            coalesce(sum(trade_kills), 0)::int as trade_kills,
            coalesce(sum(traded_deaths), 0)::int as traded_deaths,
            coalesce(sum(clutch_wins), 0)::int as clutch_wins,
            coalesce(sum(clutch_attempts), 0)::int as clutch_attempts
     from match_players where steam_id64 = $1`,
    [steamId],
  )
  const a = rows[0]
  return {
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
    // Estilo Leetify: precisão, dano de utilitária, entries, trades, clutch.
    accuracy: pct(a.shots_hit, a.shots_fired),
    utilityDamage: a.utility_damage,
    utilityDamagePerRound: a.rounds ? Math.round((a.utility_damage / a.rounds) * 10) / 10 : 0,
    entryKills: a.entry_kills,
    entryDeaths: a.entry_deaths,
    entryWinPct: pct(a.entry_wins, a.entry_kills),
    tradeKills: a.trade_kills,
    tradedDeaths: a.traded_deaths,
    clutchWins: a.clutch_wins,
    clutchAttempts: a.clutch_attempts,
    clutchPct: pct(a.clutch_wins, a.clutch_attempts),
  }
}

async function evolucaoRating(db, steamId, limite = 20) {
  const { rows } = await db.query(
    `select m.id, m.played_at, mp.rating
     from match_players mp join matches m on m.id = mp.match_id
     where mp.steam_id64 = $1 and m.status = 'parsed' and mp.rating is not null
     order by m.played_at desc nulls last limit $2`,
    [steamId, limite],
  )
  return rows
    .map((r) => ({ matchId: r.id, playedAt: r.played_at, rating: Number(r.rating) }))
    .reverse() // cronológico, pro gráfico ler da esquerda pra direita
}

export function createProfileRouter({ db, requireAuth }) {
  const router = Router()

  // Comparação entre 2 Jogadores: stats lado a lado + confronto direto (mesmo time / times opostos).
  // Precisa vir antes de '/:steamId' — senão o Express casaria "compare" como um steamId.
  router.get('/compare', requireAuth, async (req, res) => {
    const a = String(req.query.a ?? '')
    const b = String(req.query.b ?? '')
    if (!/^\d{17}$/.test(a) || !/^\d{17}$/.test(b) || a === b) {
      return res.status(400).json({ erro: 'Informe dois SteamID64 diferentes (a e b)' })
    }
    const playersQ = await db.query(
      'select steam_id64, nick, avatar_url from players where steam_id64 in ($1, $2)',
      [a, b],
    )
    const jogadorA = playersQ.rows.find((p) => p.steam_id64 === a)
    const jogadorB = playersQ.rows.find((p) => p.steam_id64 === b)
    if (!jogadorA || !jogadorB) return res.status(404).json({ erro: 'Jogador não encontrado' })

    const [statsA, statsB, evolA, evolB, confrontoQ] = await Promise.all([
      statsAgregados(db, a),
      statsAgregados(db, b),
      evolucaoRating(db, a),
      evolucaoRating(db, b),
      db.query(
        `select mp_a.team as team_a, mp_b.team as team_b, mp_a.won as a_venceu
         from match_players mp_a
         join match_players mp_b on mp_b.match_id = mp_a.match_id and mp_b.steam_id64 = $2
         where mp_a.steam_id64 = $1`,
        [a, b],
      ),
    ])

    const confronto = confrontoQ.rows
    const mesmoTime = confronto.filter((r) => r.team_a === r.team_b)
    const timesOpostos = confronto.filter((r) => r.team_a !== r.team_b)
    const aVenceuOpostos = timesOpostos.filter((r) => r.a_venceu).length

    res.json({
      a: { steamId: jogadorA.steam_id64, nick: jogadorA.nick, avatarUrl: jogadorA.avatar_url, stats: statsA, evolucao: evolA },
      b: { steamId: jogadorB.steam_id64, nick: jogadorB.nick, avatarUrl: jogadorB.avatar_url, stats: statsB, evolucao: evolB },
      confronto: {
        partidasJuntos: confronto.length,
        mesmoTime: mesmoTime.length,
        mesmoTimeVitorias: mesmoTime.filter((r) => r.a_venceu).length,
        timesOpostos: timesOpostos.length,
        aVenceu: aVenceuOpostos,
        bVenceu: timesOpostos.length - aVenceuOpostos,
      },
    })
  })

  // Perfil do Jogador: stats agregados, por mapa, partidas recentes e Sinergia.
  router.get('/:steamId', requireAuth, async (req, res) => {
    const { steamId } = req.params
    const playerQ = await db.query(
      'select steam_id64, nick, avatar_url, is_admin from players where steam_id64 = $1',
      [steamId],
    )
    if (playerQ.rows.length === 0) return res.status(404).json({ erro: 'Jogador não encontrado' })
    const jogador = playerQ.rows[0]

    const [stats, porMapa, recentes, sinergia, evolucao] = await Promise.all([
      statsAgregados(db, steamId),
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
      evolucaoRating(db, steamId),
    ])

    res.json({
      jogador: { steamId: jogador.steam_id64, nick: jogador.nick, avatarUrl: jogador.avatar_url },
      stats,
      evolucao,
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
