import { Router } from 'express'
import { keyFromR2Url, streamObject } from '../r2.js'

export function createMatchesRouter({ db, requireAuth, r2Client, r2Bucket }) {
  const router = Router()

  // Feed: Partidas parseadas, com os Jogadores do grupo que jogaram cada uma.
  // Filtros opcionais: ?from=YYYY-MM-DD&to=YYYY-MM-DD&map=de_mirage&source=valve_mm|upload
  router.get('/', requireAuth, async (req, res) => {
    const cond = ["m.status = 'parsed'"]
    const params = []
    const { from, to, map, source } = req.query
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
      params.push(from)
      cond.push(`m.played_at >= $${params.length}`)
    }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      params.push(to)
      // inclusivo: até o fim do dia informado
      cond.push(`m.played_at < ($${params.length}::date + interval '1 day')`)
    }
    if (map && /^[a-z0-9_]+$/.test(map)) {
      params.push(map)
      cond.push(`m.map = $${params.length}`)
    }
    if (source === 'valve_mm' || source === 'upload') {
      params.push(source)
      cond.push(`m.source = $${params.length}`)
    }
    const { rows } = await db.query(
      `select m.id, m.map, m.played_at, m.score_a, m.score_b, m.status, m.source,
         coalesce(json_agg(json_build_object('steamId', mp.steam_id64, 'nick', mp.nick, 'won', mp.won))
           filter (where mp.is_tracked), '[]') as tracked
       from matches m
       left join match_players mp on mp.match_id = m.id
       where ${cond.join(' and ')}
       group by m.id
       order by m.played_at desc nulls last, m.created_at desc
       limit 200`,
      params,
    )
    res.json(
      rows.map((m) => ({
        id: m.id,
        map: m.map,
        playedAt: m.played_at,
        scoreA: m.score_a,
        scoreB: m.score_b,
        source: m.source,
        tracked: m.tracked,
      })),
    )
  })

  // Status da sincronização: quantas Partidas descobertas ainda esperam download/parse.
  // (Precisa vir antes de '/:id' — senão o Express casaria "sync-status" como um id.)
  router.get('/sync-status', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      `select
         count(*) filter (where status = 'pending')::int as pending,
         count(*) filter (where status = 'failed')::int as failed,
         count(*) filter (where status = 'parsed')::int as parsed,
         max(played_at) filter (where status = 'parsed') as last_played_at
       from matches`,
    )
    const r = rows[0]
    res.json({ pending: r.pending, failed: r.failed, parsed: r.parsed, lastPlayedAt: r.last_played_at })
  })

  // Detalhe: placar dos 10 Participantes, rounds, highlights e clipes.
  router.get('/:id', requireAuth, async (req, res) => {
    const { id } = req.params
    const matchQ = await db.query(
      'select id, map, played_at, score_a, score_b, source, status, demo_url, replay_url from matches where id = $1',
      [id],
    )
    if (matchQ.rows.length === 0) return res.status(404).json({ erro: 'Partida não encontrada' })
    const m = matchQ.rows[0]

    const [players, rounds, highlights, clips, econ] = await Promise.all([
      db.query(
        `select mp.steam_id64, mp.nick, mp.team, mp.kills, mp.deaths, mp.assists, mp.headshot_kills,
                mp.damage, mp.rounds_played, mp.rating, mp.won, mp.is_tracked, mp.team_kills,
                mp.he_damage, mp.molotov_damage, mp.smokes_thrown, mp.flashes_thrown,
                mp.he_thrown, mp.molotovs_thrown, mp.enemies_flashed, mp.teammates_flashed,
                mp.enemy_flash_duration, mp.teammate_flash_duration,
                mp.he_team_damage, mp.molotov_team_damage, mp.flash_assists, p.avatar_url
         from match_players mp
         left join players p on p.steam_id64 = mp.steam_id64
         where mp.match_id = $1
         order by mp.team, mp.rating desc nulls last, mp.kills desc`,
        [id],
      ),
      db.query(
        'select round_number, winner_team, win_reason from rounds where match_id = $1 order by round_number',
        [id],
      ),
      db.query(
        `select h.id, h.steam_id64, h.round_number, h.kind, h.description, h.frame, mp.nick
         from highlights h
         left join match_players mp on mp.match_id = h.match_id and mp.steam_id64 = h.steam_id64
         where h.match_id = $1 order by h.round_number`,
        [id],
      ),
      db.query(
        `select id, steam_id64, url, provider, title, highlight_id
         from clips where match_id = $1 order by created_at`,
        [id],
      ),
      db.query(
        `select round_number, team, equip_value, buy_type
         from match_round_econ where match_id = $1 order by round_number`,
        [id],
      ),
    ])

    res.json({
      id: m.id,
      map: m.map,
      playedAt: m.played_at,
      scoreA: m.score_a,
      scoreB: m.score_b,
      source: m.source,
      status: m.status,
      // O R2 é privado de propósito (dados reais dos participantes) — nunca expor a
      // URL bruta do bucket. O client busca via esses paths, autenticados e
      // proxiados pelo próprio servidor (ver rotas /:id/demo e /:id/replay abaixo).
      demoUrl: m.demo_url ? `/api/matches/${m.id}/demo` : null,
      replayUrl: m.replay_url ? `/api/matches/${m.id}/replay` : null,
      players: players.rows.map((p) => ({
        steamId: p.steam_id64,
        nick: p.nick,
        avatarUrl: p.avatar_url,
        team: p.team,
        kills: p.kills,
        teamKills: p.team_kills,
        deaths: p.deaths,
        assists: p.assists,
        headshotKills: p.headshot_kills,
        damage: p.damage,
        roundsPlayed: p.rounds_played,
        rating: p.rating === null ? null : Number(p.rating),
        won: p.won,
        isTracked: p.is_tracked,
        utilitaria: {
          heDamage: p.he_damage,
          molotovDamage: p.molotov_damage,
          smokesThrown: p.smokes_thrown,
          flashesThrown: p.flashes_thrown,
          heThrown: p.he_thrown,
          molotovsThrown: p.molotovs_thrown,
          enemiesFlashed: p.enemies_flashed,
          teammatesFlashed: p.teammates_flashed,
          enemyFlashDuration: Number(p.enemy_flash_duration),
          teammateFlashDuration: Number(p.teammate_flash_duration),
          heTeamDamage: p.he_team_damage,
          molotovTeamDamage: p.molotov_team_damage,
          flashAssists: p.flash_assists,
        },
      })),
      rounds: rounds.rows.map((r) => ({
        roundNumber: r.round_number,
        winnerTeam: r.winner_team,
        winReason: r.win_reason,
      })),
      highlights: highlights.rows.map((h) => ({
        id: h.id,
        steamId: h.steam_id64,
        nick: h.nick,
        roundNumber: h.round_number,
        kind: h.kind,
        description: h.description,
        frame: h.frame,
      })),
      clips: clips.rows.map((c) => ({
        id: c.id,
        steamId: c.steam_id64,
        url: c.url,
        provider: c.provider,
        title: c.title,
        highlightId: c.highlight_id,
      })),
      economia: econ.rows.map((e) => ({
        roundNumber: e.round_number,
        team: e.team,
        equipValue: e.equip_value,
        buyType: e.buy_type,
      })),
    })
  })

  // Proxy autenticado pro replay 2D — nunca expõe a URL/credenciais do R2 ao client.
  router.get('/:id/replay', requireAuth, async (req, res) => {
    if (!r2Client) return res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })
    const { rows } = await db.query('select replay_url from matches where id = $1', [req.params.id])
    const key = keyFromR2Url(rows[0]?.replay_url, r2Bucket)
    if (!key) return res.status(404).json({ erro: 'Replay não disponível' })
    try {
      await streamObject(r2Client, r2Bucket, key, res)
    } catch {
      res.status(502).json({ erro: 'Falha ao buscar o replay no R2' })
    }
  })

  // Idem para o .dem bruto (arquivado por completude — ADR-0002 — não usado pela UI ainda).
  router.get('/:id/demo', requireAuth, async (req, res) => {
    if (!r2Client) return res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })
    const { rows } = await db.query('select demo_url from matches where id = $1', [req.params.id])
    const key = keyFromR2Url(rows[0]?.demo_url, r2Bucket)
    if (!key) return res.status(404).json({ erro: 'Demo não disponível' })
    try {
      await streamObject(r2Client, r2Bucket, key, res)
    } catch {
      res.status(502).json({ erro: 'Falha ao buscar o demo no R2' })
    }
  })

  return router
}
