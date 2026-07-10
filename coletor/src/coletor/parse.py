"""Extração do .dem (demoparser2) → ParsedDemo (a IR que transform.py consome).

Validado contra um demo real de matchmaking (de_anubis). demoparser2 é nativo (Rust),
importado só aqui para os testes das transformações rodarem sem ele.

Descobertas da API (CS2 / valve_demo_2):
- round vem de `total_rounds_played` (0-based) passado em `other=`; não há evento round_end.
- dano = soma de `player_hurt.dmg_health` por atacante.
- assist = `player_death.assister_steamid`.
- placar = `team_rounds_total` (prop por jogador) lido no fim da partida.
- time fixo A/B: `team_num` no 1º `round_freeze_end` (2=TR→A, 3=CT→B); estável apesar
  da troca de lados no intervalo.
- warmup: filtra deaths por `is_warmup_period==False` e hurt por tick >= 1º freeze_end.
- played_at: o formato .dem NÃO guarda data/hora real em lugar nenhum (header, cvars,
  hltv_versioninfo — nada). Usamos a mtime do arquivo como proxy (é quando foi baixado,
  tipicamente minutos/horas após jogado — melhor disponível, mas aproximado).
"""

import datetime
import os


def _team_letter(team_number):
    return "A" if team_number == 2 else "B"


def _sid(v):
    import pandas as pd

    if v is None or (isinstance(v, float) and pd.isna(v)) or v == "":
        return None
    return str(int(v)) if isinstance(v, (int, float)) else str(v)


def parse_demo(path):
    import pandas as pd
    from demoparser2 import DemoParser

    parser = DemoParser(str(path))
    mapa = parser.parse_header().get("map_name")

    deaths = parser.parse_event("player_death", other=["total_rounds_played", "is_warmup_period"])
    deaths = deaths[deaths["is_warmup_period"] == False]  # noqa: E712

    freeze = parser.parse_event("round_freeze_end", other=["total_rounds_played"])
    first_freeze = int(freeze["tick"].min())

    hurt = parser.parse_event("player_hurt", other=["total_rounds_played"])
    hurt = hurt[hurt["tick"] >= first_freeze]

    win_panel = parser.parse_event("cs_win_panel_match")
    end_tick = (
        int(win_panel["tick"].iloc[0]) - 100 if len(win_panel) else int(deaths["tick"].max())
    )

    # Times fixos A/B pelo primeiro freeze_end.
    snap0 = parser.parse_ticks(["team_num"], ticks=[first_freeze])
    fixed = {_sid(r["steamid"]): _team_letter(int(r["team_num"])) for r in snap0.to_dict("records")}

    # Placar final: team_rounds_total de cada time no fim.
    snapf = parser.parse_ticks(["team_num", "team_rounds_total"], ticks=[end_tick])
    score = {"A": 0, "B": 0}
    for r in snapf.to_dict("records"):
        ft = fixed.get(_sid(r["steamid"]))
        if ft:
            score[ft] = int(r["team_rounds_total"])

    # Kills (para K/D via transform e highlights) + nomes + assists.
    # team_kill: mesmo time do atacante e da vítima — não deve contar como kill
    # de verdade (nem pra rating, nem pra highlight de multikill), só como morte.
    kills, names, assists = [], {}, {}
    for r in deaths.to_dict("records"):
        atk, vic, ast = _sid(r.get("attacker_steamid")), _sid(r.get("user_steamid")), _sid(r.get("assister_steamid"))
        kills.append(
            {
                "round_number": int(r["total_rounds_played"]) + 1,
                "attacker": atk,
                "victim": vic,
                "headshot": bool(r["headshot"]),
                "team_kill": bool(atk and vic and atk != vic and fixed.get(atk) == fixed.get(vic)),
            }
        )
        if atk:
            names[atk] = r.get("attacker_name") or ""
        if vic:
            names[vic] = r.get("user_name") or ""
        if ast:
            assists[ast] = assists.get(ast, 0) + 1

    # Dano por atacante.
    damage = {}
    for r in hurt.to_dict("records"):
        atk = _sid(r.get("attacker_steamid"))
        if atk:
            damage[atk] = damage.get(atk, 0) + int(r["dmg_health"])

    players = [
        {
            "steam_id64": sid,
            "nick": names.get(sid, ""),
            "team": ft,
            "kills": 0,
            "deaths": 0,
            "assists": assists.get(sid, 0),
            "headshot_kills": 0,
            "damage": damage.get(sid, 0),
        }
        for sid, ft in fixed.items()
        if sid
    ]

    # Rounds: vencedor por delta de team_rounds_total nos ticks de fim de round.
    rounds = []
    ended = parser.parse_event("round_officially_ended", other=["total_rounds_played"])
    end_ticks = sorted({int(t) for t in ended["tick"].tolist()})
    if end_ticks:
        snaps = parser.parse_ticks(["team_rounds_total"], ticks=end_ticks)
        by_tick = {}
        for r in snaps.to_dict("records"):
            ft = fixed.get(_sid(r["steamid"]))
            if ft:
                by_tick.setdefault(int(r["tick"]), {})[ft] = int(r["team_rounds_total"])
        prev = {"A": 0, "B": 0}
        for i, t in enumerate(end_ticks):
            cur = by_tick.get(t, prev)
            if cur.get("A", 0) > prev["A"]:
                winner = "A"
            elif cur.get("B", 0) > prev["B"]:
                winner = "B"
            else:
                winner = None
            rounds.append({"round_number": i + 1, "winner_team": winner, "win_reason": ""})
            prev = {"A": cur.get("A", prev["A"]), "B": cur.get("B", prev["B"])}

    played_at = datetime.datetime.fromtimestamp(
        os.path.getmtime(path), tz=datetime.timezone.utc
    ).isoformat()

    return {
        "map": mapa,
        "score_a": score["A"],
        "score_b": score["B"],
        "played_at": played_at,
        "rounds": rounds,
        "players": players,
        "kills": kills,
    }


def extract_replay(path, target_hz=8, demo_tick_rate=64):
    """Dados do Replay 2D numa passada: posições (com downsample) + kills.

    Devolve {"ticks": [{round, tick, players:[{id,nick,x,y,yaw,hp,team,alive}]}],
             "kills": [{round, tick, killer, victim, weapon, headshot}]}.
    O round de cada tick/kill é atribuído pelos limites de freeze_end (consistente
    entre posições e kills). Só validável contra um .dem real.
    """
    from demoparser2 import DemoParser

    parser = DemoParser(str(path))
    freeze = parser.parse_event("round_freeze_end", other=["total_rounds_played"])
    ended = parser.parse_event("round_officially_ended", other=["total_rounds_played"])
    inicios = sorted({int(t) for t in freeze["tick"].tolist()})
    fins = sorted({int(t) for t in ended["tick"].tolist()})  # dedupe: há 2 linhas por round

    passo = max(1, round(demo_tick_rate / target_hz))
    alvo = []
    limites = []
    for i, ini in enumerate(inicios):
        fim = fins[i] if i < len(fins) else ini + 64 * 115
        limites.append((i + 1, ini, fim))
        for t in range(ini, fim, passo):
            alvo.append(t)
    if not alvo:
        return {"ticks": [], "kills": []}

    def round_do_tick(t):
        for rnd, ini, fim in limites:
            if ini <= t <= fim:
                return rnd
        return limites[-1][0]

    # Posições (parse_ticks já traz a coluna "name").
    df = parser.parse_ticks(["X", "Y", "yaw", "health", "team_num", "is_alive"], ticks=alvo)
    por_tick = {}
    for r in df.to_dict("records"):
        sid = _sid(r.get("steamid"))
        if not sid:
            continue
        por_tick.setdefault(int(r["tick"]), []).append(
            {
                "id": sid,
                "nick": r.get("name") or "",
                "x": float(r.get("X") or 0),
                "y": float(r.get("Y") or 0),
                "yaw": float(r.get("yaw") or 0),
                "hp": int(r.get("health") or 0),
                "team": _team_letter(int(r.get("team_num") or 0)),
                "alive": bool(r.get("is_alive")),
            }
        )
    ticks = [{"round": round_do_tick(t), "tick": t, "players": por_tick[t]} for t in sorted(por_tick)]

    # Kills (fora do warmup).
    deaths = parser.parse_event("player_death", other=["total_rounds_played", "is_warmup_period"])
    deaths = deaths[deaths["is_warmup_period"] == False]  # noqa: E712
    kills = []
    for r in deaths.to_dict("records"):
        killer, victim = _sid(r.get("attacker_steamid")), _sid(r.get("user_steamid"))
        if not killer or not victim or killer == victim:
            continue
        tk = int(r["tick"])
        kills.append(
            {
                "round": round_do_tick(tk),
                "tick": tk,
                "killer": killer,
                "victim": victim,
                "weapon": r.get("weapon") or "",
                "headshot": bool(r.get("headshot")),
            }
        )

    # ---- Utilitárias + bomba ----
    def evento(nome):
        try:
            return parser.parse_event(nome).to_dict("records")
        except Exception:
            return []

    def _xy(r):
        return float(r.get("x") or 0), float(r.get("y") or 0)

    # Smokes e fogo: casa detonate/startburn com expired pelo entityid (duração real).
    def granadas_com_duracao(ev_ini, ev_fim, dur_padrao_s):
        fins = {}
        for r in evento(ev_fim):
            fins[r.get("entityid")] = int(r["tick"])
        saida = []
        for r in evento(ev_ini):
            x, y = _xy(r)
            t0 = int(r["tick"])
            t1 = fins.get(r.get("entityid"), t0 + int(dur_padrao_s * 64))
            saida.append({"round": round_do_tick(t0), "x": x, "y": y, "tickStart": t0, "tickEnd": t1})
        return saida

    smokes = granadas_com_duracao("smokegrenade_detonate", "smokegrenade_expired", 18)
    fires = granadas_com_duracao("inferno_startburn", "inferno_expire", 7)

    def granadas_instantaneas(nome):
        saida = []
        for r in evento(nome):
            x, y = _xy(r)
            t0 = int(r["tick"])
            saida.append({"round": round_do_tick(t0), "x": x, "y": y, "tick": t0})
        return saida

    flashes = granadas_instantaneas("flashbang_detonate")
    hes = granadas_instantaneas("hegrenade_detonate")

    blinds = []
    for r in evento("player_blind"):
        vic = _sid(r.get("user_steamid"))
        if not vic:
            continue
        t0 = int(r["tick"])
        blinds.append(
            {
                "round": round_do_tick(t0),
                "tick": t0,
                "victim": vic,
                "attacker": _sid(r.get("attacker_steamid")),
                "duration": float(r.get("blind_duration") or 0),
            }
        )

    def bomba(nome):
        saida = []
        for r in evento(nome):
            sid = _sid(r.get("user_steamid"))
            if not sid:
                continue
            t0 = int(r["tick"])
            saida.append({"round": round_do_tick(t0), "tick": t0, "steamid": sid})
        return saida

    bomb_pickups = bomba("bomb_pickup")
    bomb_drops = bomba("bomb_dropped")
    bomb_plants = bomba("bomb_planted")

    return {
        "ticks": ticks,
        "kills": kills,
        "smokes": smokes,
        "fires": fires,
        "flashes": flashes,
        "hes": hes,
        "blinds": blinds,
        "bombPickups": bomb_pickups,
        "bombDrops": bomb_drops,
        "bombPlants": bomb_plants,
    }
