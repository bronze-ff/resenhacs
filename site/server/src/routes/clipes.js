import { Router } from 'express'
import { partidaVisivelExpr } from '../friendships.js'

const PERIODOS = {
  semana: "and m.played_at >= now() - interval '7 days'",
  mes: "and m.played_at >= now() - interval '30 days'",
  sempre: '',
}

// Clipes reais do Allstar (status='Processed'), escopados por amizade e período. A
// pontuação já vem gravada em allstar_clips (webhook, ver routes/allstar.js) — esta
// rota só lê, não recalcula nada. Leaderboard NÃO existe mais aqui (fica só dentro de
// cada Competição, ver routes/competicoes.js) — ranking sempre-ativo-de-tudo virou
// ranking-por-competição. `allstar_clips` não guarda match_id/steam_id64/round_number
// direto (só highlight_id) — junta com `highlights`, mesmo padrão já usado no webhook
// (routes/allstar.js). Ver docs/superpowers/specs/2026-07-22-competicoes-clipes-design.md.
export function createClipesRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const periodo = PERIODOS[req.query.periodo] !== undefined ? req.query.periodo : 'sempre'
    const eu = req.player.steamId
    const { rows } = await db.query(
      `select ac.id, ac.clip_url, ac.clip_snapshot_url, ac.pontuacao_total, ac.pontuacao_detalhe,
              h.round_number, h.match_id, h.steam_id64, h.kind,
              m.map, m.played_at,
              coalesce(p.nick, mp.nick) as nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url
       from allstar_clips ac
       join highlights h on h.id = ac.highlight_id
       join matches m on m.id = h.match_id
       left join players p on p.steam_id64 = h.steam_id64
       left join match_players mp on mp.match_id = h.match_id and mp.steam_id64 = h.steam_id64
       left join steam_avatares sa on sa.steam_id64 = h.steam_id64
       where ac.status = 'Processed' and ${partidaVisivelExpr('m', '$1')} ${PERIODOS[periodo]}
       order by ac.pontuacao_total desc nulls last`,
      [eu],
    )

    const clipes = rows.map((r) => ({
      id: r.id,
      matchId: r.match_id,
      steamId: r.steam_id64,
      nick: r.nick,
      avatarUrl: r.avatar_url,
      clipUrl: r.clip_url,
      clipSnapshotUrl: r.clip_snapshot_url,
      kind: r.kind,
      roundNumber: r.round_number,
      map: r.map,
      playedAt: r.played_at,
      pontuacao: r.pontuacao_detalhe ?? { total: r.pontuacao_total ?? 0 },
    }))

    res.json({ clipes })
  })

  return router
}
