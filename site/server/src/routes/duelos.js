import { Router } from 'express'
import { partidaVisivelExpr } from '../friendships.js'
import { calcularDuelos, comPercentuais, somarDuelos } from '../trades.js'

// Duelos de abertura e trocas (ver ../trades.js). Duas leituras:
// - GET /api/profile/:steamId/duelos — agregado das últimas 30 Partidas do Jogador
//   visíveis ao viewer (regra de amizade de friendships.js).
// - GET /api/matches/:id/duelos — por Jogador, numa Partida visível ao viewer.
// Rotas em arquivo próprio pra não mexer em profile.js/matches.js; os paths não colidem
// com os de lá ('/:steamId' e '/:id' são exatos).

const PARTIDAS_PERFIL = 30

const SQL_KILLS = `select match_id, round_number, tick, killer, victim
  from kill_positions
  where match_id = any($1::uuid[]) and coalesce(is_team_kill, false) = false`

async function carregarPartidas(db, ids) {
  const [playersQ, roundsQ, killsQ] = await Promise.all([
    db.query('select match_id, steam_id64, nick, team from match_players where match_id = any($1::uuid[])', [ids]),
    db.query('select match_id, round_number, side_a from rounds where match_id = any($1::uuid[])', [ids]),
    db.query(SQL_KILLS, [ids]),
  ])
  const porPartida = new Map(ids.map((id) => [id, { players: [], rounds: [], kills: [] }]))
  for (const p of playersQ.rows) {
    porPartida.get(p.match_id)?.players.push({ steamId: p.steam_id64, team: p.team, nick: p.nick })
  }
  for (const r of roundsQ.rows) {
    porPartida.get(r.match_id)?.rounds.push({ roundNumber: r.round_number, sideA: r.side_a })
  }
  for (const k of killsQ.rows) {
    porPartida.get(k.match_id)?.kills.push({ roundNumber: k.round_number, tick: k.tick, killer: k.killer, victim: k.victim })
  }
  return porPartida
}

export function createDuelosPerfilRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/:steamId/duelos', requireAuth, async (req, res) => {
    const { steamId } = req.params
    if (!/^\d{17}$/.test(steamId)) return res.status(400).json({ erro: 'SteamID inválido' })
    const { rows } = await db.query(
      `select m.id
       from match_players mp join matches m on m.id = mp.match_id
       where mp.steam_id64 = $1 and m.status = 'parsed' and ${partidaVisivelExpr('m', '$2')}
       order by m.played_at desc nulls last
       limit ${PARTIDAS_PERFIL}`,
      [steamId, req.player.steamId],
    )
    const ids = rows.map((r) => r.id)
    if (ids.length === 0) return res.json({ partidas: 0, ...somarDuelos([]) })
    const porPartida = await carregarPartidas(db, ids)
    const lista = []
    for (const dados of porPartida.values()) lista.push(calcularDuelos(dados)[steamId])
    res.json({ partidas: ids.length, ...somarDuelos(lista) })
  })

  return router
}

export function createDuelosPartidaRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/:id/duelos', requireAuth, async (req, res) => {
    const { id } = req.params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ erro: 'Partida não encontrada' })
    const matchQ = await db.query(
      `select m.id from matches m where m.id = $1 and ${partidaVisivelExpr('m', '$2')}`,
      [id, req.player.steamId],
    )
    if (matchQ.rows.length === 0) return res.status(404).json({ erro: 'Partida não encontrada' })
    const dados = (await carregarPartidas(db, [id])).get(id)
    const duelos = calcularDuelos(dados)
    res.json({
      jogadores: dados.players.map((p) => ({
        steamId: p.steamId,
        nick: p.nick,
        team: p.team,
        ...comPercentuais(duelos[p.steamId]),
      })),
    })
  })

  return router
}
