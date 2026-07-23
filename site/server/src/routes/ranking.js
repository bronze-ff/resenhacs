import { Router } from 'express'
import { calcularEstilos } from '../analise.js'
import { partidaVisivelExpr } from '../friendships.js'

function pct(parte, total) {
  if (!total) return 0
  return Math.round((parte / total) * 1000) / 10
}

export function createRankingRouter({ db, requireAuth }) {
  const router = Router()

  // Ranking interno: agrega os stats de cada Jogador em todas as Partidas visíveis ao
  // viewer (eu + amigos accepted). Filtro opcional de período:
  // ?from=YYYY-MM-DD&to=YYYY-MM-DD (sobre matches.played_at).
  router.get('/', requireAuth, async (req, res) => {
    const params = [req.player.steamId]
    let periodo = ''
    const { from, to } = req.query
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
      params.push(from)
      periodo += ` and m.played_at >= $${params.length}`
    }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      params.push(to)
      periodo += ` and m.played_at < ($${params.length}::date + interval '1 day')`
    }
    // Forma recente: rating médio das últimas 5 Partidas de CARREIRA (não do período
    // filtrado acima — "recente" perde o sentido se o filtro já corta pra uma janela
    // velha) vs a média geral de carreira. row_number() por Jogador ordenado por
    // played_at desc marca as 5 mais novas; o resto entra só na média geral.
    const formaQ = await db.query(
      `select steam_id64,
              avg(rating) filter (where rn <= 5) as recente,
              avg(rating) as geral,
              count(*)::int as total
       from (
         select mp.steam_id64, mp.rating,
                row_number() over (partition by mp.steam_id64 order by m.played_at desc nulls last) as rn
         from match_players mp
         join matches m on m.id = mp.match_id
         where mp.is_tracked and ${partidaVisivelExpr('m', '$1')} and mp.rating is not null
       ) t
       group by steam_id64`,
      [req.player.steamId],
    )
    // Diferença mínima pra não piscar seta por ruído estatístico; abaixo disso é "estável".
    const LIMIAR_FORMA = 0.05
    const formaPorJogador = new Map()
    for (const f of formaQ.rows) {
      if (f.total < 5 || f.recente === null || f.geral === null) continue
      const delta = Number(f.recente) - Number(f.geral)
      formaPorJogador.set(f.steam_id64, {
        tendencia: delta > LIMIAR_FORMA ? 'subindo' : delta < -LIMIAR_FORMA ? 'caindo' : 'estavel',
        recente: Math.round(Number(f.recente) * 100) / 100,
        geral: Math.round(Number(f.geral) * 100) / 100,
      })
    }

    const { rows } = await db.query(
      `select p.steam_id64, p.nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url,
              count(mp.match_id)::int as partidas,
              coalesce(sum(case when mp.won then 1 else 0 end), 0)::int as vitorias,
              coalesce(sum(mp.kills), 0)::int as kills,
              coalesce(sum(mp.deaths), 0)::int as deaths,
              coalesce(sum(mp.headshot_kills), 0)::int as hs,
              avg(mp.rating) as rating,
              coalesce((select count(*) from highlights h
                        join matches m on m.id = h.match_id
                        where h.steam_id64 = p.steam_id64 and h.kind = 'ace' and ${partidaVisivelExpr('m', '$1')}${periodo}), 0)::int as aces,
              coalesce(sum(mp.clutch_wins), 0)::int as clutch_wins,
              coalesce(sum(mp.clutch_attempts), 0)::int as clutch_attempts,
              coalesce(sum(mp.entry_kills), 0)::int as entry_kills,
              coalesce(sum(mp.entry_deaths), 0)::int as entry_deaths,
              coalesce(sum(mp.utility_damage), 0)::int as utility_damage,
              coalesce(sum(mp.rounds_played), 0)::int as rounds,
              coalesce(sum(mp.shots_fired), 0)::int as shots_fired,
              coalesce(sum(mp.shots_hit), 0)::int as shots_hit
       from (
         select $1::text as steam_id64
         union
         select case when f.player_a = $1 then f.player_b else f.player_a end
         from friendships f
         where (f.player_a = $1 or f.player_b = $1) and f.status = 'accepted'
       ) gm
       join players p on p.steam_id64 = gm.steam_id64
       left join steam_avatares sa on sa.steam_id64 = p.steam_id64
       left join (
         select mp.* from match_players mp
         join matches m on m.id = mp.match_id
         where ${partidaVisivelExpr('m', '$1')}${periodo}
       ) mp on mp.steam_id64 = p.steam_id64
       group by p.steam_id64, p.nick, p.avatar_url, sa.avatar_url`,
      params,
    )

    // Insumos pra classificação de estilo (relativa à média do grupo — ver analise.js).
    const entradaEstilos = rows.map((r) => ({
      steamId: r.steam_id64,
      partidas: r.partidas,
      entryRate: r.partidas ? (r.entry_kills + r.entry_deaths) / r.partidas : 0,
      utilityPerRound: r.rounds ? r.utility_damage / r.rounds : 0,
      clutchPct: pct(r.clutch_wins, r.clutch_attempts),
      clutchAttempts: r.clutch_attempts,
      accuracy: pct(r.shots_hit, r.shots_fired),
    }))
    const estilos = calcularEstilos(entradaEstilos)

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
        entryKills: r.entry_kills,
        entryDeaths: r.entry_deaths,
        entryWinPct: pct(r.entry_kills, r.entry_kills + r.entry_deaths),
        estilo: estilos[r.steam_id64],
        forma: formaPorJogador.get(r.steam_id64) ?? null,
      }))
      .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))

    res.json(ranking)
  })

  return router
}
