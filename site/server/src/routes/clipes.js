import { Router } from 'express'
import { partidaVisivelExpr } from '../friendships.js'
import { calcularPontuacao } from '../clipesScore.js'

const PERIODOS = {
  semana: "and m.played_at >= now() - interval '7 days'",
  mes: "and m.played_at >= now() - interval '30 days'",
  sempre: '',
}

// Verifica, pra um round específico de um jogador, se TODOS os kills dele naquele
// round foram headshot — vira o bônus "ALL HEADSHOTS" da pontuação (ver clipesScore.js).
async function todosHeadshotNoRound(db, { matchId, roundNumber, steamId }) {
  const { rows } = await db.query(
    `select count(*) filter (where kp.headshot) as hs, count(*) as total
     from kill_positions kp
     where kp.match_id = $1 and kp.round_number = $2 and kp.killer = $3`,
    [matchId, roundNumber, steamId],
  )
  const hs = Number(rows[0]?.hs ?? 0)
  const total = Number(rows[0]?.total ?? 0)
  return total > 0 && hs === total
}

export function createClipesRouter({ db, requireAuth }) {
  const router = Router()

  // Clipes reais do Allstar (status='Processed'), escopados por amizade e período,
  // com pontuação própria (a Allstar não expõe a fórmula deles) + leaderboard de
  // jogadores. Links manuais (tabela `clips`) ficam de fora — não têm highlight/round
  // pra pontuar. Ver docs/superpowers/specs/2026-07-21-aba-clipes-design.md.
  //
  // allstar_clips não depende mais de highlight_id (migração 0042 — clipe virou "por
  // jogador+partida", ver allstarClip.js): a query lê match_id/steam_id64/round_number
  // direto da própria allstar_clips, e só tenta achar um `kind` (ace/clutch/etc.) via
  // subquery em highlights pra reaproveitar a pontuação quando o round que a Allstar
  // escolheu bateu com um highlight nosso. Sem bater, kind vem null — a fórmula já usa
  // um piso padrão (calcularPontuacao) em vez de excluir o clipe da lista.
  router.get('/', requireAuth, async (req, res) => {
    const periodo = PERIODOS[req.query.periodo] !== undefined ? req.query.periodo : 'sempre'
    const eu = req.player.steamId
    const { rows } = await db.query(
      `select ac.id, ac.clip_url, ac.clip_snapshot_url,
              ac.round_number, ac.match_id, ac.steam_id64,
              (select h.kind from highlights h
               where h.match_id = ac.match_id and h.steam_id64 = ac.steam_id64 and h.round_number = ac.round_number
               limit 1) as kind,
              m.map, m.played_at,
              coalesce(p.nick, mp.nick) as nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url
       from allstar_clips ac
       join matches m on m.id = ac.match_id
       left join players p on p.steam_id64 = ac.steam_id64
       left join match_players mp on mp.match_id = ac.match_id and mp.steam_id64 = ac.steam_id64
       left join steam_avatares sa on sa.steam_id64 = ac.steam_id64
       where ac.status = 'Processed' and ${partidaVisivelExpr('m', '$1')} ${PERIODOS[periodo]}
       order by m.played_at desc`,
      [eu],
    )

    const clipes = await Promise.all(
      rows.map(async (r) => {
        const todosHeadshot = await todosHeadshotNoRound(db, {
          matchId: r.match_id, roundNumber: r.round_number, steamId: r.steam_id64,
        })
        return {
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
          pontuacao: calcularPontuacao({ kind: r.kind, todosHeadshot }),
        }
      }),
    )
    clipes.sort((a, b) => b.pontuacao.total - a.pontuacao.total)

    const porJogador = new Map()
    for (const c of clipes) {
      const atual = porJogador.get(c.steamId) ?? { steamId: c.steamId, nick: c.nick, avatarUrl: c.avatarUrl, clipes: 0, melhorPontuacao: 0 }
      atual.clipes += 1
      atual.melhorPontuacao = Math.max(atual.melhorPontuacao, c.pontuacao.total)
      porJogador.set(c.steamId, atual)
    }
    const leaderboard = [...porJogador.values()].sort((a, b) => b.melhorPontuacao - a.melhorPontuacao)

    res.json({ clipes, leaderboard })
  })

  return router
}
