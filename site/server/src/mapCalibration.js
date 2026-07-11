// Port JS de coletor/src/coletor/replay.py (MAP_CALIBRATION + world_to_radar) — projeta
// coordenadas de MUNDO (guardadas em kill_positions) pro espaço normalizado 0..1 do radar,
// mesma convenção que o replay JSON já usa (consumido por MapaCalor.jsx). Mantém os dois
// em sincronia manualmente; são poucos números e mudam raramente (calibração por mapa).
const RADAR_SIZE = 1024

const MAP_CALIBRATION = {
  de_mirage: { pos_x: -3230, pos_y: 1713, scale: 5.00 },
  de_dust2: { pos_x: -2476, pos_y: 3239, scale: 4.40 },
  de_inferno: { pos_x: -2087, pos_y: 3870, scale: 4.90 },
  de_nuke: { pos_x: -3453, pos_y: 2887, scale: 7.00 },
  de_overpass: { pos_x: -4831, pos_y: 1781, scale: 5.20 },
  de_vertigo: { pos_x: -3168, pos_y: 1762, scale: 4.00 },
  de_ancient: { pos_x: -2953, pos_y: 2164, scale: 5.00 },
  de_anubis: { pos_x: -2796, pos_y: 3328, scale: 5.22 },
  de_train: { pos_x: -2308, pos_y: 2078, scale: 4.082077 },
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function isMapaCalibrado(map) {
  return Object.prototype.hasOwnProperty.call(MAP_CALIBRATION, map)
}

// (x, y) do mundo -> (nx, ny) normalizado 0..1, origem no topo-esquerda do radar.
export function worldToRadar(x, y, map) {
  const cal = MAP_CALIBRATION[map]
  if (!cal) return null
  const px = (x - cal.pos_x) / cal.scale
  const py = (cal.pos_y - y) / cal.scale
  return [clamp01(px / RADAR_SIZE), clamp01(py / RADAR_SIZE)]
}
