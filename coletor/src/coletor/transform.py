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
    """{steam_id64: {round_number: qtd_kills}} — só kills 'de verdade' contra o time
    inimigo (exclui suicídio/dano de mundo E team kill — não deve inflar multikill/rating)."""
    saida = {}
    for k in kills:
        atk = k.get("attacker")
        if not atk or atk == k.get("victim") or k.get("team_kill"):
            continue
        saida.setdefault(atk, {}).setdefault(k["round_number"], 0)
        saida[atk][k["round_number"]] += 1
    return saida


def fill_kd_from_kills(players, kills):
    """Deriva kills/deaths/headshot_kills/team_kills de cada jogador a partir da lista
    de kills. Team kill NÃO conta como kill (nem headshot), mas a vítima ainda morreu —
    conta como death normalmente. team_kills fica à parte, só informativo.

    Usado no pipeline real (parse.py fornece o roster + as kills; dano/assist vêm de
    outros eventos do demo). Não é chamado por enrich() para os testes poderem passar
    jogadores já agregados.
    """
    k, d, hs, tk = {}, {}, {}, {}
    for e in kills:
        atk, vic = e.get("attacker"), e.get("victim")
        if atk and atk != vic:
            if e.get("team_kill"):
                tk[atk] = tk.get(atk, 0) + 1
            else:
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
            "team_kills": tk.get(p["steam_id64"], p.get("team_kills", 0)),
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


def attach_replay_frames(highlights, replay_rounds):
    """Preenche 'frame' (índice dentro do round, casa com o Replay 2D) em cada highlight,
    pra Partida.jsx poder abrir o Replay 2D já no momento exato. Highlights que já têm
    'frame' (ex.: clutch, calculado em main.py junto com o replay) passam direto. Pros
    de multi-kill, usa a última kill do jogador no round. Se o round/jogador não aparecer
    no replay (falhou a extração, mapa não calibrado etc.), fica frame=None."""
    by_round = {r["round"]: r for r in replay_rounds}
    saida = []
    for h in highlights:
        if "frame" in h:
            saida.append(h)
            continue
        rnd = by_round.get(h["round_number"])
        frame = None
        if rnd:
            kills_do_jogador = [k for k in rnd.get("kills", []) if k["killer"] == h["steam_id64"]]
            if kills_do_jogador:
                frame = kills_do_jogador[-1]["t"]
        saida.append({**h, "frame": frame})
    return saida


def _distribuicao_multikills(por_round):
    """Conta em quantos rounds o jogador fez exatamente 1,2,3,4,5 kills → (k1..k5)."""
    contagem = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    for qtd in por_round.values():
        capped = min(qtd, 5)
        if capped >= 1:
            contagem[capped] += 1
    return contagem


JANELA_TRADE_TICKS = 5 * 64  # 5s a 64 tick — janela padrão de trade usada pela maioria das ferramentas de stats


def _agrupar_por_round(kills):
    saida = {}
    for k in kills:
        saida.setdefault(k["round_number"], []).append(k)
    return saida


def entry_duels(kills, teams, winner_by_round):
    """Primeiro kill 'de verdade' (não TK) de cada round = entry duel. Devolve uma lista
    de {round_number, attacker, victim, venceu} (venceu = o time do atacante ganhou o round)."""
    saida = []
    for round_number, round_kills in _agrupar_por_round(kills).items():
        reais = [k for k in round_kills if not k.get("team_kill") and k.get("attacker") and k["attacker"] != k["victim"]]
        if not reais:
            continue
        primeiro = min(reais, key=lambda k: k["tick"])
        venceu = winner_by_round.get(round_number) == teams.get(primeiro["attacker"])
        saida.append({"round_number": round_number, "attacker": primeiro["attacker"], "victim": primeiro["victim"], "venceu": venceu})
    return saida


def trade_kills(kills, teams, janela=JANELA_TRADE_TICKS):
    """Uma kill é 'trade' quando vinga um companheiro morto há pouco: o atacante mata,
    dentro da janela, quem tinha acabado de matar um teammate dele. Devolve lista de
    {round_number, attacker, avenged_teammate}."""
    saida = []
    for round_number, round_kills in _agrupar_por_round(kills).items():
        ordenado = sorted((k for k in round_kills if not k.get("team_kill") and k.get("attacker")), key=lambda k: k["tick"])
        for i, k in enumerate(ordenado):
            atk, vic, tick = k["attacker"], k["victim"], k["tick"]
            atk_time = teams.get(atk)
            for j in range(i - 1, -1, -1):
                anterior = ordenado[j]
                if tick - anterior["tick"] > janela:
                    break
                if anterior["attacker"] == vic and teams.get(anterior["victim"]) == atk_time:
                    saida.append({"round_number": round_number, "attacker": atk, "avenged_teammate": anterior["victim"]})
                    break
    return saida


def clutch_outcomes(kills, teams, winner_by_round):
    """Detecta tentativas de clutch (último vivo de um time vs 1+ inimigos) por round.

    Registra o clutcher de CADA time separadamente: num 1v1 os DOIS últimos vivos estão
    clutchando — um ganha, o outro perde (é assim que o Leetify conta, validado round a
    round contra partidas reais). O bug antigo travava no PRIMEIRO time a chegar a 1 vivo
    (`inicio is None`), que num 1v1 é quase sempre o eventual PERDEDOR: o vencedor do
    clutch nunca era registrado e o total de vitórias vinha ~0. Além disso, `venceu` não
    exige mais sobrevivência — se o round é ganho pelo time do clutcher (ex.: bomba
    explode depois dele morrer), conta como clutch vencido, igual ao Leetify.

    Devolve lista de {steam_id64, round_number, vs, venceu, salvou}. `salvou` = sobreviveu
    mas o round foi perdido (salvou a arma — o "SAVE" do Leetify)."""
    saida = []
    for round_number, round_kills in _agrupar_por_round(kills).items():
        ordenado = sorted((k for k in round_kills if not k.get("team_kill")), key=lambda k: k["tick"])
        alive = set(teams.keys())
        # Primeiro instante em que CADA time ficou com exatamente 1 vivo contra 1+ inimigo.
        inicio_por_time = {}
        for k in ordenado:
            alive.discard(k["victim"])
            vivos = {"A": [], "B": []}
            for s in alive:
                t = teams.get(s)
                if t in vivos:
                    vivos[t].append(s)
            for lado, outro in (("A", "B"), ("B", "A")):
                if len(vivos[lado]) == 1 and len(vivos[outro]) >= 1 and lado not in inicio_por_time:
                    inicio_por_time[lado] = {"steamid": vivos[lado][0], "vs": len(vivos[outro]), "tick": k["tick"]}
        for lado, info in inicio_por_time.items():
            sobreviveu = not any(
                k["victim"] == info["steamid"] and k["tick"] >= info["tick"] for k in ordenado
            )
            venceu = winner_by_round.get(round_number) == lado
            saida.append(
                {
                    "steam_id64": info["steamid"],
                    "round_number": round_number,
                    "vs": info["vs"],
                    "venceu": venceu,
                    "salvou": sobreviveu and not venceu,
                }
            )
    return saida


def kast_pct(kills, trades, jogadores, rounds_total):
    """% de rounds em que o jogador teve Kill, Assist, Sobreviveu ou foi
    vingado (Traded) — uma das 4 condições já conta o round.
    `trades` é a lista JÁ COMPUTADA por trade_kills(kills, teams) — não
    recalcula aqui pra não duplicar trabalho que enrich() já fez.
    `jogadores` é a lista/set dos steam_id64 dos participantes da partida.
    kills precisa ter "assister" (parse.py) — ausência é tratada como None,
    sem quebrar (fixtures antigas de teste continuam funcionando, só sem
    contar o componente de assist). rounds_total<=0 devolve {}."""
    if rounds_total <= 0:
        return {}
    por_round = _agrupar_por_round(kills)
    vingados_por_round = {}
    for t in trades:
        vingados_por_round.setdefault(t["round_number"], set()).add(t["avenged_teammate"])

    atende = {sid: 0 for sid in jogadores}
    for round_number in range(1, rounds_total + 1):
        round_kills = por_round.get(round_number, [])
        morreram = {k["victim"] for k in round_kills if k.get("victim")}
        mataram = {
            k["attacker"] for k in round_kills
            if k.get("attacker") and not k.get("team_kill") and k["attacker"] != k.get("victim")
        }
        assistiram = {k["assister"] for k in round_kills if k.get("assister")}
        vingados = vingados_por_round.get(round_number, set())
        for sid in jogadores:
            if sid in mataram or sid in assistiram or sid in vingados or sid not in morreram:
                atende[sid] += 1
    return {sid: round(cont / rounds_total * 100, 1) for sid, cont in atende.items()}


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
    """Preenche won, rounds_played, rating e os stats estilo Leetify (entry, trade,
    clutch) em cada player; devolve o ParsedDemo pronto pro banco."""
    # Total de rounds = soma do placar (autoritativo); cai para len(rounds) se não houver placar.
    rounds_total = (parsed.get("score_a", 0) + parsed.get("score_b", 0)) or len(parsed["rounds"])
    score_a, score_b = parsed.get("score_a", 0), parsed.get("score_b", 0)
    # Placar igual é empate — não existe "vencedor" pra decidir won=True/False (o bug
    # antigo forçava B como vencedor sempre que score_a não fosse estritamente maior,
    # marcando todo empate como derrota do time A).
    vencedor = "A" if score_a > score_b else "B" if score_b > score_a else None
    kills = parsed.get("kills", [])
    kpr = kills_por_round_por_jogador(kills)

    teams = {p["steam_id64"]: p["team"] for p in parsed["players"]}
    winner_by_round = {r["round_number"]: r.get("winner_team") for r in parsed.get("rounds", [])}
    tem_tick = all("tick" in k for k in kills)  # testes antigos passam kills sem tick — pula os stats novos

    entry = entry_duels(kills, teams, winner_by_round) if tem_tick else []
    trades = trade_kills(kills, teams) if tem_tick else []
    kast = kast_pct(kills, trades, teams.keys(), rounds_total) if tem_tick else {}
    clutches = clutch_outcomes(kills, teams, winner_by_round) if tem_tick else []

    entry_kills, entry_deaths, entry_wins = {}, {}, {}
    for e in entry:
        entry_kills[e["attacker"]] = entry_kills.get(e["attacker"], 0) + 1
        entry_deaths[e["victim"]] = entry_deaths.get(e["victim"], 0) + 1
        if e["venceu"]:
            entry_wins[e["attacker"]] = entry_wins.get(e["attacker"], 0) + 1

    trade_count, traded_deaths = {}, {}
    for t in trades:
        trade_count[t["attacker"]] = trade_count.get(t["attacker"], 0) + 1
        traded_deaths[t["avenged_teammate"]] = traded_deaths.get(t["avenged_teammate"], 0) + 1

    clutch_wins, clutch_attempts, clutch_saves = {}, {}, {}
    for c in clutches:
        clutch_attempts[c["steam_id64"]] = clutch_attempts.get(c["steam_id64"], 0) + 1
        if c["venceu"]:
            clutch_wins[c["steam_id64"]] = clutch_wins.get(c["steam_id64"], 0) + 1
        elif c.get("salvou"):
            clutch_saves[c["steam_id64"]] = clutch_saves.get(c["steam_id64"], 0) + 1

    players = []
    for p in parsed["players"]:
        sid = p["steam_id64"]
        por_round = kpr.get(sid, {})
        dist = _distribuicao_multikills(por_round)
        rating = hltv_rating(p.get("kills", 0), p.get("deaths", 0), rounds_total, dist)
        players.append(
            {
                **p,
                "rounds_played": rounds_total,
                "won": None if vencedor is None else p["team"] == vencedor,
                "rating": rating,
                "kast_pct": kast.get(sid),
                "entry_kills": entry_kills.get(sid, 0),
                "entry_deaths": entry_deaths.get(sid, 0),
                "entry_wins": entry_wins.get(sid, 0),
                "trade_kills": trade_count.get(sid, 0),
                "traded_deaths": traded_deaths.get(sid, 0),
                "clutch_wins": clutch_wins.get(sid, 0),
                "clutch_attempts": clutch_attempts.get(sid, 0),
                "clutch_saves": clutch_saves.get(sid, 0),
            }
        )

    # Highlights de clutch: só as tentativas REALMENTE vencidas (round ganho de verdade,
    # não só "matei todo mundo mas o round foi perdido por outro motivo" — bomba
    # explodindo depois da eliminação, por exemplo). Mesma fonte que os contadores
    # clutch_wins/clutch_attempts acima, pra Highlights e Ranking nunca discordarem
    # (existiu um bug assim: replay.py tinha um detector PRÓPRIO, mais permissivo,
    # que gerava Highlights de clutch que o Ranking não contava como vitória).
    clutch_highlights = [
        {
            "steam_id64": c["steam_id64"],
            "round_number": c["round_number"],
            "kind": f"clutch_1v{c['vs']}",
            "description": f"CLUTCH 1v{c['vs']} no round {c['round_number']}",
        }
        for c in clutches
        if c["venceu"]
    ]

    return {
        **parsed,
        "players": players,
        "highlights": multikill_highlights(kills) + clutch_highlights,
    }
