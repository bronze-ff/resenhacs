import { Router } from 'express'

const TIPOS_VALIDOS = new Set(['smoke', 'flash', 'he', 'molotov'])

export function createLineupsRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const cond = []
    const params = []
    const { map, tipo, origem } = req.query
    if (map && /^[a-z0-9_]+$/.test(map)) {
      params.push(map)
      cond.push(`map = $${params.length}`)
    }
    if (tipo && TIPOS_VALIDOS.has(tipo)) {
      params.push(tipo)
      cond.push(`tipo = $${params.length}`)
    }
    if (origem === 'grupo' || origem === 'pro') {
      params.push(origem)
      cond.push(`origem = $${params.length}`)
    }
    const where = cond.length ? `where ${cond.join(' and ')}` : ''
    const { rows } = await db.query(
      `select id, match_id, round_number, map, tipo, thrower_steam_id, thrower_nick,
              thrower_x, thrower_y, thrower_yaw, thrower_pitch, target_x, target_y,
              tick, origem
       from lineups ${where} order by created_at desc limit 300`,
      params,
    )
    res.json(
      rows.map((l) => ({
        id: l.id,
        matchId: l.match_id,
        roundNumber: l.round_number,
        map: l.map,
        tipo: l.tipo,
        throwerSteamId: l.thrower_steam_id,
        throwerNick: l.thrower_nick,
        throwerX: Number(l.thrower_x),
        throwerY: Number(l.thrower_y),
        throwerYaw: Number(l.thrower_yaw),
        throwerPitch: Number(l.thrower_pitch),
        targetX: Number(l.target_x),
        targetY: Number(l.target_y),
        tick: l.tick,
        origem: l.origem,
      })),
    )
  })

  return router
}
