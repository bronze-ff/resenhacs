import { Router } from 'express'
import { partidaVisivelExpr } from '../friendships.js'

// Lista de kills de UMA Partida (kill_positions), com team kill e flags do player_death
// (migration 0054). Base pra clipar um TK proposital e pros prêmios/conquistas. Aqui o
// TK VEM na lista (teamKill: true) — quem conta kill "de verdade" filtra do lado dele.
// Coordenadas são de MUNDO (as mesmas gravadas pelo Coletor), não normalizadas pro radar.
const STEAM_ID64 = /^\d{17}$/

function jogador(steamId, nick) {
  if (!steamId) return null
  return { steamId, nick: nick ?? null }
}

function numOuNull(v) {
  return v == null ? null : Number(v)
}

export function createKillsRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/:id/kills', requireAuth, async (req, res) => {
    const { id } = req.params
    // `jogador` = kills que ele fez; `vitima` = mortes dele (fails e coaching do clipe).
    const filtro = req.query.jogador
    const vitima = req.query.vitima
    for (const v of [filtro, vitima]) {
      if (v != null && (typeof v !== 'string' || !STEAM_ID64.test(v))) {
        return res.status(400).json({ erro: 'jogador inválido' })
      }
    }

    const matchQ = await db.query(
      `select id from matches where id = $1 and ${partidaVisivelExpr('matches', '$2')}`,
      [id, req.player.steamId],
    )
    if (matchQ.rows.length === 0) return res.status(404).json({ erro: 'Partida não encontrada' })

    const { rows } = await db.query(
      `select kp.round_number, kp.tick, kp.killer, kp.victim, kp.assister, kp.weapon, kp.headshot,
              kp.is_team_kill, kp.wallbang, kp.thrusmoke, kp.attackerblind, kp.noscope,
              kp.killer_x, kp.killer_y, kp.victim_x, kp.victim_y,
              mk.nick as killer_nick, mv.nick as victim_nick, ma.nick as assister_nick
       from kill_positions kp
       left join match_players mk on mk.match_id = kp.match_id and mk.steam_id64 = kp.killer
       left join match_players mv on mv.match_id = kp.match_id and mv.steam_id64 = kp.victim
       left join match_players ma on ma.match_id = kp.match_id and ma.steam_id64 = kp.assister
       where kp.match_id = $1 and ($2::text is null or kp.killer = $2) and ($3::text is null or kp.victim = $3)
       order by kp.round_number, kp.tick`,
      [id, filtro ?? null, vitima ?? null],
    )

    res.json(
      rows.map((k) => ({
        round: k.round_number,
        tick: k.tick,
        killer: jogador(k.killer, k.killer_nick),
        victim: { steamId: k.victim, nick: k.victim_nick ?? null },
        assister: jogador(k.assister, k.assister_nick),
        weapon: k.weapon ?? '',
        headshot: Boolean(k.headshot),
        teamKill: Boolean(k.is_team_kill),
        wallbang: Boolean(k.wallbang),
        thrusmoke: Boolean(k.thrusmoke),
        attackerblind: Boolean(k.attackerblind),
        noscope: Boolean(k.noscope),
        killerX: numOuNull(k.killer_x),
        killerY: numOuNull(k.killer_y),
        victimX: numOuNull(k.victim_x),
        victimY: numOuNull(k.victim_y),
      })),
    )
  })

  return router
}
