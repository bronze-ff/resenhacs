import { Router } from 'express'

const TIPOS_VALIDOS = new Set(['smoke', 'flash', 'he', 'molotov'])

export function createLineupsRouter({ db, requireAuth, requireGroupMember }) {
  const router = Router()

  // Lineups são auto-extraídos das demos reais do grupo — escopados ao group_id do grupo
  // ativo (join em matches), senão vazariam SteamID+nick+matchId de partidas de outros grupos.
  router.get('/', requireAuth, requireGroupMember, async (req, res) => {
    const cond = ['m.group_id = $1']
    const params = [req.groupId]
    const { map, tipo, origem } = req.query
    if (map && /^[a-z0-9_]+$/.test(map)) {
      params.push(map)
      cond.push(`l.map = $${params.length}`)
    }
    if (tipo && TIPOS_VALIDOS.has(tipo)) {
      params.push(tipo)
      cond.push(`l.tipo = $${params.length}`)
    }
    if (origem === 'grupo' || origem === 'pro') {
      params.push(origem)
      cond.push(`l.origem = $${params.length}`)
    }
    const where = `where ${cond.join(' and ')}`
    const { rows } = await db.query(
      `select l.id, l.match_id, l.round_number, l.map, l.tipo, l.thrower_steam_id, l.thrower_nick,
              l.thrower_x, l.thrower_y, l.thrower_yaw, l.thrower_pitch, l.target_x, l.target_y,
              l.tick, l.origem
       from lineups l join matches m on m.id = l.match_id ${where} order by l.created_at desc limit 300`,
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
