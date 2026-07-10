import { Router } from 'express'
import { calcularEstilos, calcularBadges, melhorSequenciaDeVitorias } from '../analise.js'

function pct(parte, total) {
  if (!total) return 0
  return Math.round((parte / total) * 1000) / 10
}

// Filtro opcional de período (?from=YYYY-MM-DD&to=YYYY-MM-DD) — anexa condições sobre
// m.played_at aos params e devolve o pedaço de SQL. `to` é inclusivo (fim do dia).
function periodoWhere(from, to, params) {
  let sql = ''
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    params.push(from)
    sql += ` and m.played_at >= $${params.length}`
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    params.push(to)
    sql += ` and m.played_at < ($${params.length}::date + interval '1 day')`
  }
  return sql
}

async function statsAgregados(db, steamId, from, to) {
  const params = [steamId]
  const periodo = periodoWhere(from, to, params)
  const { rows } = await db.query(
    `select count(*)::int as partidas,
            coalesce(sum(case when mp.won then 1 else 0 end), 0)::int as vitorias,
            coalesce(sum(mp.kills), 0)::int as kills,
            coalesce(sum(mp.deaths), 0)::int as deaths,
            coalesce(sum(mp.assists), 0)::int as assists,
            coalesce(sum(mp.headshot_kills), 0)::int as hs,
            coalesce(sum(mp.damage), 0)::int as damage,
            coalesce(sum(mp.rounds_played), 0)::int as rounds,
            avg(mp.rating) as rating,
            coalesce(sum(mp.utility_damage), 0)::int as utility_damage,
            coalesce(sum(mp.shots_fired), 0)::int as shots_fired,
            coalesce(sum(mp.shots_hit), 0)::int as shots_hit,
            coalesce(sum(mp.entry_kills), 0)::int as entry_kills,
            coalesce(sum(mp.entry_deaths), 0)::int as entry_deaths,
            coalesce(sum(mp.entry_wins), 0)::int as entry_wins,
            coalesce(sum(mp.trade_kills), 0)::int as trade_kills,
            coalesce(sum(mp.traded_deaths), 0)::int as traded_deaths,
            coalesce(sum(mp.clutch_wins), 0)::int as clutch_wins,
            coalesce(sum(mp.clutch_attempts), 0)::int as clutch_attempts,
            coalesce((select count(*) from highlights h join matches mh on mh.id = h.match_id
                      where h.steam_id64 = $1 and h.kind = 'ace'${periodo.replaceAll('m.', 'mh.')}), 0)::int as aces
     from match_players mp join matches m on m.id = mp.match_id
     where mp.steam_id64 = $1${periodo}`,
    params,
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
    shotsFired: a.shots_fired,
    shotsHit: a.shots_hit,
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
    aces: a.aces,
  }
}

// Melhor sequência de vitórias consecutivas, sempre no histórico INTEIRO (badge de
// conquista não deve sumir/reaparecer conforme o filtro de período da tela).
async function melhorSequencia(db, steamId) {
  const { rows } = await db.query(
    `select mp.won from match_players mp join matches m on m.id = mp.match_id
     where mp.steam_id64 = $1 and m.status = 'parsed' order by m.played_at asc nulls first`,
    [steamId],
  )
  return melhorSequenciaDeVitorias(rows.map((r) => r.won))
}

// Estilo de jogo do steamId, relativo à média do GRUPO todo (mesmo período da tela).
async function estiloDoJogador(db, steamId, from, to) {
  const params = []
  const periodo = periodoWhere(from, to, params)
  const { rows } = await db.query(
    `select mp.steam_id64,
            count(*)::int as partidas,
            coalesce(sum(mp.entry_kills), 0)::int as entry_kills,
            coalesce(sum(mp.entry_deaths), 0)::int as entry_deaths,
            coalesce(sum(mp.utility_damage), 0)::int as utility_damage,
            coalesce(sum(mp.rounds_played), 0)::int as rounds,
            coalesce(sum(mp.clutch_wins), 0)::int as clutch_wins,
            coalesce(sum(mp.clutch_attempts), 0)::int as clutch_attempts,
            coalesce(sum(mp.shots_fired), 0)::int as shots_fired,
            coalesce(sum(mp.shots_hit), 0)::int as shots_hit
     from match_players mp join matches m on m.id = mp.match_id
     where true${periodo}
     group by mp.steam_id64`,
    params,
  )
  const entrada = rows.map((r) => ({
    steamId: r.steam_id64,
    partidas: r.partidas,
    entryRate: r.partidas ? (r.entry_kills + r.entry_deaths) / r.partidas : 0,
    utilityPerRound: r.rounds ? r.utility_damage / r.rounds : 0,
    clutchPct: pct(r.clutch_wins, r.clutch_attempts),
    clutchAttempts: r.clutch_attempts,
    accuracy: pct(r.shots_hit, r.shots_fired),
  }))
  return calcularEstilos(entrada)[steamId] ?? null
}

async function evolucaoRating(db, steamId, from, to, limite = 20) {
  const params = [steamId]
  const periodo = periodoWhere(from, to, params)
  params.push(limite)
  const { rows } = await db.query(
    `select m.id, m.played_at, mp.rating
     from match_players mp join matches m on m.id = mp.match_id
     where mp.steam_id64 = $1 and m.status = 'parsed' and mp.rating is not null${periodo}
     order by m.played_at desc nulls last limit $${params.length}`,
    params,
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
    const { from, to } = req.query
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

    const confrontoParams = [a, b]
    const confrontoPeriodo = periodoWhere(from, to, confrontoParams)
    const [statsA, statsB, evolA, evolB, confrontoQ] = await Promise.all([
      statsAgregados(db, a, from, to),
      statsAgregados(db, b, from, to),
      evolucaoRating(db, a, from, to),
      evolucaoRating(db, b, from, to),
      db.query(
        `select mp_a.team as team_a, mp_b.team as team_b, mp_a.won as a_venceu
         from match_players mp_a
         join match_players mp_b on mp_b.match_id = mp_a.match_id and mp_b.steam_id64 = $2
         join matches m on m.id = mp_a.match_id
         where mp_a.steam_id64 = $1${confrontoPeriodo}`,
        confrontoParams,
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
  // Filtro opcional de período (?from/?to) em tudo menos a Sinergia (view pré-computada).
  router.get('/:steamId', requireAuth, async (req, res) => {
    const { steamId } = req.params
    const { from, to } = req.query
    const playerQ = await db.query(
      'select steam_id64, nick, avatar_url, is_admin from players where steam_id64 = $1',
      [steamId],
    )
    if (playerQ.rows.length === 0) return res.status(404).json({ erro: 'Jogador não encontrado' })
    const jogador = playerQ.rows[0]

    const mapaParams = [steamId]
    const mapaPeriodo = periodoWhere(from, to, mapaParams)
    const recentesParams = [steamId]
    const recentesPeriodo = periodoWhere(from, to, recentesParams)

    const [stats, porMapa, recentes, sinergia, evolucao, statsGerais, sequencia, estilo] = await Promise.all([
      statsAgregados(db, steamId, from, to),
      db.query(
        `select m.map, count(*)::int as partidas,
                coalesce(sum(case when mp.won then 1 else 0 end), 0)::int as vitorias,
                avg(mp.rating) as rating
         from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = $1${mapaPeriodo} group by m.map order by partidas desc`,
        mapaParams,
      ),
      db.query(
        `select m.id, m.map, m.played_at, m.score_a, m.score_b,
                mp.kills, mp.deaths, mp.rating, mp.won
         from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = $1 and m.status = 'parsed'${recentesPeriodo}
         order by m.played_at desc nulls last limit 20`,
        recentesParams,
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
      evolucaoRating(db, steamId, from, to),
      // Badges são conquista de carreira — sempre no histórico INTEIRO, não no período filtrado.
      statsAgregados(db, steamId),
      melhorSequencia(db, steamId),
      estiloDoJogador(db, steamId, from, to),
    ])

    const badges = calcularBadges({
      aces: statsGerais.aces,
      clutchWins: statsGerais.clutchWins,
      melhorSequencia: sequencia,
      accuracy: statsGerais.accuracy,
      entryKills: statsGerais.entryKills,
      partidas: statsGerais.partidas,
    })

    res.json({
      jogador: { steamId: jogador.steam_id64, nick: jogador.nick, avatarUrl: jogador.avatar_url },
      stats,
      evolucao,
      badges,
      estilo,
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
