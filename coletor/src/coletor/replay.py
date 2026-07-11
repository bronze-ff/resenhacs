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
    "de_train": {"pos_x": -2308, "pos_y": 2078, "scale": 4.082077},
}


def _clamp01(v):
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def world_to_radar(x, y, cal, size=RADAR_SIZE):
    """(x, y) do mundo → (nx, ny) normalizado em 0..1 no espaço do radar (origem topo-esquerda)."""
    px = (x - cal["pos_x"]) / cal["scale"]
    py = (cal["pos_y"] - y) / cal["scale"]
    return (round(_clamp01(px / size), 4), round(_clamp01(py / size), 4))


def detect_clutch(round_kills, teams):
    """Detecta um clutch VENCIDO no round (pro anel dourado no Replay 2D): último vivo
    de um time que zera os inimigos sobrevivendo.

    round_kills em ordem cronológica. Devolve {steamid, vs, tick} ou None. Checa o
    clutcher de CADA time (num 1v1 os dois clutcham) e devolve o que efetivamente
    limpou os inimigos — o bug antigo travava no 1º a chegar a 1 vivo (o perdedor num
    1v1), fazendo o anel sumir em clutch 1v1 vencido. Ver transform.clutch_outcomes."""
    alive = set(teams.keys())
    inicio_por_time = {}
    for k in round_kills:
        alive.discard(k["victim"])
        vivos = {"A": [], "B": []}
        for s in alive:
            t = teams.get(s)
            if t in vivos:
                vivos[t].append(s)
        for lado, outro in (("A", "B"), ("B", "A")):
            if len(vivos[lado]) == 1 and len(vivos[outro]) >= 1 and lado not in inicio_por_time:
                inicio_por_time[lado] = {"steamid": vivos[lado][0], "vs": len(vivos[outro]), "tick": k["tick"]}
    for time_surv, inicio in inicio_por_time.items():
        surv, faltam = inicio["steamid"], inicio["vs"]
        morreu = False
        for k in round_kills:
            if k["tick"] < inicio["tick"]:
                continue
            if k["victim"] == surv:
                morreu = True
                break
            if teams.get(k["victim"]) != time_surv:
                faltam -= 1
        if not morreu and faltam <= 0:
            return inicio  # esse time limpou os inimigos → clutch vencido
    return None


def build_replay(map_name, ticks, kills=None, extras=None, target_hz=8):
    """Monta o replay JSON a partir das posições (`ticks`), kills e `extras`
    (smokes/fires/flashes/hes/blinds/bomb* de extract_replay). Normaliza mundo→radar,
    reindexa frames por round, casa cada evento ao frame certo, e detecta clutch.
    """
    import bisect

    cal = MAP_CALIBRATION.get(map_name)
    extras = extras or {}

    def norm(x, y):
        return world_to_radar(x, y, cal) if cal else (round(x, 2), round(y, 2))

    por_round, ticks_round = {}, {}
    names, teams = {}, {}
    for t in ticks:
        players = []
        for p in t["players"]:
            nx, ny = norm(p["x"], p["y"])
            players.append(
                {
                    "id": p["id"], "x": nx, "y": ny,
                    "yaw": round(p.get("yaw", 0), 1), "hp": p.get("hp", 100),
                    "team": p["team"], "alive": bool(p.get("alive", True)),
                }
            )
            if p.get("nick"):
                names[p["id"]] = p["nick"]
            teams[p["id"]] = p["team"]
        frames = por_round.setdefault(t["round"], [])
        frames.append({"t": len(frames), "players": players})
        ticks_round.setdefault(t["round"], []).append(t["tick"])

    def idx(round_no, tick):
        rt = ticks_round.get(round_no)
        return None if not rt else min(bisect.bisect_left(rt, tick), len(rt) - 1)

    def por_round_group(lista):
        g = {}
        for e in lista:
            g.setdefault(e["round"], []).append(e)
        return g

    kills_g = por_round_group(kills or [])
    hits_g = por_round_group(extras.get("hits", []))
    smokes_g = por_round_group(extras.get("smokes", []))
    fires_g = por_round_group(extras.get("fires", []))
    flashes_g = por_round_group(extras.get("flashes", []))
    hes_g = por_round_group(extras.get("hes", []))
    blinds_g = por_round_group(extras.get("blinds", []))
    pickups_g = por_round_group(extras.get("bombPickups", []))
    drops_g = por_round_group(extras.get("bombDrops", []))
    plants_g = por_round_group(extras.get("bombPlants", []))

    rounds_out = []
    for r in sorted(por_round):
        frames = por_round[r]
        rk = sorted(kills_g.get(r, []), key=lambda k: k["tick"])
        kills_round = [
            {"t": idx(r, k["tick"]), "killer": k["killer"], "victim": k["victim"],
             "weapon": k.get("weapon", ""), "headshot": bool(k.get("headshot"))}
            for k in rk
        ]
        # Tiros que acertaram mas não mataram (traçado de bala em todo hit, não só
        # kill — pedido do usuário). Mesmo formato de kills_round pro client tratar
        # igual, só sem gerar caveira/entrar no kill feed.
        hits_round = [
            {"t": idx(r, h["tick"]), "killer": h["killer"], "victim": h["victim"],
             "weapon": h.get("weapon", ""), "headshot": bool(h.get("headshot"))}
            for h in sorted(hits_g.get(r, []), key=lambda h: h["tick"])
        ]

        def janela(e):
            nx, ny = norm(e["x"], e["y"])
            return {"x": nx, "y": ny, "tStart": idx(r, e["tickStart"]), "tEnd": idx(r, e["tickEnd"])}

        def instante(e):
            nx, ny = norm(e["x"], e["y"])
            return {"x": nx, "y": ny, "t": idx(r, e["tick"])}

        smokes = [janela(e) for e in smokes_g.get(r, [])]
        fires = [janela(e) for e in fires_g.get(r, [])]
        flashes = [instante(e) for e in flashes_g.get(r, [])]
        hes = [instante(e) for e in hes_g.get(r, [])]
        blinds = [
            {"t": idx(r, e["tick"]), "tEnd": idx(r, e["tick"] + int(e["duration"] * 64)),
             "victim": e["victim"]}
            for e in blinds_g.get(r, [])
        ]

        # Portador da bomba: pickup ativa até o próximo drop/plant/fim do round.
        eventos = (
            [(e["tick"], "pega", e["steamid"]) for e in pickups_g.get(r, [])]
            + [(e["tick"], "solta", None) for e in drops_g.get(r, [])]
            + [(e["tick"], "planta", None) for e in plants_g.get(r, [])]
        )
        eventos.sort()
        fim_round = ticks_round[r][-1]
        bomba, atual, desde = [], None, None
        for tick, tipo, sid in eventos:
            if tipo == "pega":
                if atual is None:
                    atual, desde = sid, tick
            elif atual is not None:
                bomba.append({"tStart": idx(r, desde), "tEnd": idx(r, tick), "carrier": atual})
                atual = None
        if atual is not None:
            bomba.append({"tStart": idx(r, desde), "tEnd": idx(r, fim_round), "carrier": atual})

        # Plant: posição = onde o plantador estava no frame do plant.
        plant = None
        if plants_g.get(r):
            pl = plants_g[r][0]
            ti = idx(r, pl["tick"])
            pos = next((p for p in frames[ti]["players"] if p["id"] == pl["steamid"]), None)
            if pos:
                plant = {"t": ti, "x": pos["x"], "y": pos["y"]}

        clutch = detect_clutch(rk, teams)
        clutch_out = {"steamid": clutch["steamid"], "vs": clutch["vs"], "t": idx(r, clutch["tick"])} if clutch else None

        rounds_out.append({
            "round": r, "frames": frames, "kills": kills_round, "hits": hits_round,
            "smokes": smokes, "fires": fires, "flashes": flashes, "hes": hes,
            "blinds": blinds, "bomb": bomba, "bombPlant": plant, "clutch": clutch_out,
        })

    return {
        "map": map_name, "calibrated": cal is not None, "tickRate": target_hz,
        "names": names, "teams": teams, "rounds": rounds_out,
    }
