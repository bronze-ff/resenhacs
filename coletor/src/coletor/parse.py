"""Extração do .dem (demoparser2) → ParsedDemo (a IR que transform.py consome).

demoparser2 é um pacote nativo (Rust) importado só aqui, dentro da função, para que
os testes das transformações rodem sem ele. Esta função em si só é validável contra
um .dem real — mantê-la fina, delegando toda a lógica calculável para transform.py.
"""


def _team_letter(team_number):
    # No CS2: 2 = TERRORIST, 3 = CT. Mapeamos os dois lados fixos da Partida em A/B.
    return "A" if team_number == 2 else "B"


def parse_demo(path):
    from demoparser2 import DemoParser  # import isolado: só runtime precisa

    parser = DemoParser(str(path))

    header = parser.parse_header()
    mapa = header.get("map_name")

    deaths = parser.parse_event("player_death")
    kills = []
    for _, row in deaths.iterrows():
        atacante = row.get("attacker_steamid")
        kills.append(
            {
                "round_number": int(row.get("round") or 0),
                "attacker": str(atacante) if atacante else None,
                "victim": str(row.get("user_steamid")) if row.get("user_steamid") else None,
                "headshot": bool(row.get("headshot")),
            }
        )

    # Placar e times finais por jogador
    jogadores = parser.parse_ticks(["team_num", "player_name"], ticks=[parser.parse_header().get("playback_ticks", 0)])
    players = []
    for _, row in jogadores.iterrows():
        sid = row.get("steamid")
        if not sid:
            continue
        players.append(
            {
                "steam_id64": str(sid),
                "nick": row.get("player_name") or "",
                "team": _team_letter(int(row.get("team_num") or 0)),
                "kills": 0,
                "deaths": 0,
                "assists": 0,
                "headshot_kills": 0,
                "damage": 0,
            }
        )

    parsed = {
        "map": mapa,
        "score_a": 0,
        "score_b": 0,
        "rounds": [],
        "players": players,
        "kills": kills,
    }
    return parsed


def extract_ticks(path):
    """Extrai posições por tick para o Replay 2D (Fase 4). Só validável contra um .dem real.

    Devolve a lista de {round, tick, players:[{id,x,y,yaw,hp,team,alive}]} que
    replay.build_replay() consome. A normalização mundo→radar fica em replay.py.
    """
    from demoparser2 import DemoParser

    parser = DemoParser(str(path))
    df = parser.parse_ticks(["X", "Y", "yaw", "health", "team_num", "is_alive"])
    ticks = {}
    for _, row in df.iterrows():
        sid = row.get("steamid")
        if not sid:
            continue
        chave = int(row.get("round") or 0), int(row.get("tick") or 0)
        ticks.setdefault(chave, {"round": chave[0], "tick": chave[1], "players": []})
        ticks[chave]["players"].append(
            {
                "id": str(sid),
                "x": float(row.get("X") or 0),
                "y": float(row.get("Y") or 0),
                "yaw": float(row.get("yaw") or 0),
                "hp": int(row.get("health") or 0),
                "team": _team_letter(int(row.get("team_num") or 0)),
                "alive": bool(row.get("is_alive")),
            }
        )
    return [ticks[k] for k in sorted(ticks)]
