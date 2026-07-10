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

  // Detalhe: placar dos 10 Participantes, rounds, highlights e clipes.
  router.get('/:id', requireAuth, async (req, res) => {
    const { id } = req.params
    const matchQ = await db.query(
      'select id, map, played_at, score_a, score_b, source, status, demo_url, replay_url from matches where id = $1',
      [id],
    )
    if (matchQ.rows.length === 0) return res.status(404).json({ erro: 'Partida não encontrada' })
    const m = matchQ.rows[0]

    const [players, rounds, highlights, clips] = await Promise.all([
      db.query(
        `select steam_id64, nick, team, kills, deaths, assists, headshot_kills,
                damage, rounds_played, rating, won, is_tracked, team_kills
         from match_players where match_id = $1
         order by team, rating desc nulls last, kills desc`,
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
