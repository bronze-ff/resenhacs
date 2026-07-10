"""Transformações puras do demo parseado → stats, rating e highlights.

Recebem uma "representação intermediária" (dicts/list simples) que parse.py extrai
do demoparser2, para serem testáveis sem um .dem real. Formato do ParsedDemo:

    {
      "map": "de_mirage",
      "score_a": 13, "score_b": 9,
      "rounds": [{"round_number": 1, "winner_team": "A", "win_reason": "..."}, ...],
      "players": [{"steam_id64": "7656...", "nick": "fih", "team": "A",
                   "kills": 20, "deaths": 15, "assists": 4,
                   "headshot_kills": 9, "damage": 2100}, ...],
      "kills": [{"round_number": 1, "attacker": "7656...", "victim": "7656...",
                 "headshot": True}, ...],
    }
"""

MULTIKILL_KIND = {3: "triple", 4: "quad", 5: "ace"}


def kills_por_round_por_jogador(kills):
    """{steam_id64: {round_number: qtd_kills}} — só kills 'de verdade' (attacker != None)."""
    saida = {}
    for k in kills:
        atk = k.get("attacker")
        if not atk or atk == k.get("victim"):
            continue  # suicídio/dano de mundo não conta
        saida.setdefault(atk, {}).setdefault(k["round_number"], 0)
        saida[atk][k["round_number"]] += 1
    return saida


def fill_kd_from_kills(players, kills):
    """Deriva kills/deaths/headshot_kills de cada jogador a partir da lista de kills.

    Usado no pipeline real (parse.py fornece o roster + as kills; dano/assist vêm de
    outros eventos do demo). Não é chamado por enrich() para os testes poderem passar
    jogadores já agregados.
    """
    k, d, hs = {}, {}, {}
    for e in kills:
        atk, vic = e.get("attacker"), e.get("victim")
        if atk and atk != vic:
            k[atk] = k.get(atk, 0) + 1
            if e.get("headshot"):
                hs[atk] = hs.get(atk, 0) + 1
        if vic:
            d[vic] = d.get(vic, 0) + 1
    return [
        {
            **p,
            "kills": k.get(p["steam_id64"], p.get("kills", 0)),
            "deaths": d.get(p["steam_id64"], p.get("deaths", 0)),
            "headshot_kills": hs.get(p["steam_id64"], p.get("headshot_kills", 0)),
        }
        for p in players
    ]


def multikill_highlights(kills):
    """Highlights de multi-kill (triple/quad/ace) a partir das kills por round."""
    por_jogador = kills_por_round_por_jogador(kills)
    highlights = []
    for steam_id, por_round in por_jogador.items():
        for round_number, qtd in sorted(por_round.items()):
            if qtd >= 3:
                kind = MULTIKILL_KIND[min(qtd, 5)]
                highlights.append(
                    {
                        "steam_id64": steam_id,
                        "round_number": round_number,
                        "kind": kind,
                        "description": f"{kind.upper()} no round {round_number}",
                    }
                )
    return highlights


def _distribuicao_multikills(por_round):
    """Conta em quantos rounds o jogador fez exatamente 1,2,3,4,5 kills → (k1..k5)."""
    contagem = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    for qtd in por_round.values():
        capped = min(qtd, 5)
        if capped >= 1:
            contagem[capped] += 1
    return contagem


def hltv_rating(kills, deaths, rounds, k):
    """Aproximação do HLTV Rating 1.0. `k` é o dict {1:..,5:..} de _distribuicao_multikills."""
    if rounds <= 0:
        return 0.0
    kill_rating = kills / rounds / 0.679
    survival_rating = (rounds - deaths) / rounds / 0.317
    pontos_multi = 1 * k[1] + 4 * k[2] + 9 * k[3] + 16 * k[4] + 25 * k[5]
    multi_rating = pontos_multi / rounds / 1.277
    return round((kill_rating + 0.7 * survival_rating + multi_rating) / 2.7, 2)


def enrich(parsed):
    """Preenche won, rounds_played e rating em cada player; devolve o ParsedDemo pronto pro banco."""
    rounds_total = len(parsed["rounds"]) or (parsed.get("score_a", 0) + parsed.get("score_b", 0))
    vencedor = "A" if parsed.get("score_a", 0) > parsed.get("score_b", 0) else "B"
    kpr = kills_por_round_por_jogador(parsed.get("kills", []))

    players = []
    for p in parsed["players"]:
        por_round = kpr.get(p["steam_id64"], {})
        dist = _distribuicao_multikills(por_round)
        rating = hltv_rating(p.get("kills", 0), p.get("deaths", 0), rounds_total, dist)
        players.append(
            {
                **p,
                "rounds_played": rounds_total,
                "won": p["team"] == vencedor,
                "rating": rating,
            }
        )

    return {**parsed, "players": players, "highlights": multikill_highlights(parsed.get("kills", []))}
