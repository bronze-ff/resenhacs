"""Construção dos frames do Replay 2D a partir das posições do demo.

A extração das posições por tick (parse.py/extract_ticks) precisa de um .dem real,
mas a normalização mundo→radar e o downsample são puros e testáveis. O resultado é
um JSON compacto (subido para o R2, ver ADR-0002) que a engine no browser reproduz.

Calibração de cada mapa (pos_x, pos_y, scale) vem dos arquivos de overview da Valve;
os valores abaixo são os públicos conhecidos e podem ser afinados por mapa.
"""

RADAR_SIZE = 1024

MAP_CALIBRATION = {
    "de_mirage": {"pos_x": -3230, "pos_y": 1713, "scale": 5.00},
    "de_dust2": {"pos_x": -2476, "pos_y": 3239, "scale": 4.40},
    "de_inferno": {"pos_x": -2087, "pos_y": 3870, "scale": 4.90},
    "de_nuke": {"pos_x": -3453, "pos_y": 2887, "scale": 7.00},
    "de_overpass": {"pos_x": -4831, "pos_y": 1781, "scale": 5.20},
    "de_vertigo": {"pos_x": -3168, "pos_y": 1762, "scale": 4.00},
    "de_ancient": {"pos_x": -2953, "pos_y": 2164, "scale": 5.00},
    "de_anubis": {"pos_x": -2796, "pos_y": 3328, "scale": 5.22},
}


def _clamp01(v):
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def world_to_radar(x, y, cal, size=RADAR_SIZE):
    """(x, y) do mundo → (nx, ny) normalizado em 0..1 no espaço do radar (origem topo-esquerda)."""
    px = (x - cal["pos_x"]) / cal["scale"]
    py = (cal["pos_y"] - y) / cal["scale"]
    return (round(_clamp01(px / size), 4), round(_clamp01(py / size), 4))


def build_replay(map_name, ticks, target_hz=8, demo_tick_rate=64):
    """Monta o replay JSON. `ticks` = lista de {round, tick, players:[{id,x,y,yaw,hp,team,alive}]}.

    Faz downsample de demo_tick_rate para ~target_hz mantendo 1 a cada `passo` ticks.
    """
    cal = MAP_CALIBRATION.get(map_name)
    passo = max(1, round(demo_tick_rate / target_hz))

    por_round = {}
    for t in ticks:
        if (t["tick"] // passo) * passo != t["tick"]:
            continue  # mantém só ticks múltiplos do passo (downsample determinístico)
        players = []
        for p in t["players"]:
            if cal:
                nx, ny = world_to_radar(p["x"], p["y"], cal)
            else:
                nx, ny = p["x"], p["y"]  # sem calibração: passthrough (engine avisa)
            players.append(
                {
                    "id": p["id"],
                    "x": nx,
                    "y": ny,
                    "yaw": round(p.get("yaw", 0), 1),
                    "hp": p.get("hp", 100),
                    "team": p["team"],
                    "alive": bool(p.get("alive", True)),
                }
            )
        por_round.setdefault(t["round"], []).append({"t": t["tick"] // passo, "players": players})

    return {
        "map": map_name,
        "calibrated": cal is not None,
        "tickRate": target_hz,
        "rounds": [{"round": r, "frames": por_round[r]} for r in sorted(por_round)],
    }
