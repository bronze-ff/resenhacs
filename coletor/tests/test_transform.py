import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import transform


def test_multikill_highlights():
    kills = (
        [{"round_number": 1, "attacker": "A", "victim": f"v{i}", "headshot": False} for i in range(5)]
        + [{"round_number": 2, "attacker": "A", "victim": f"w{i}", "headshot": False} for i in range(3)]
        + [{"round_number": 3, "attacker": "B", "victim": "x", "headshot": False}]  # 1 kill: nada
    )
    hl = transform.multikill_highlights(kills)
    assert {"steam_id64": "A", "round_number": 1, "kind": "ace", "description": "ACE no round 1"} in hl
    kinds = {(h["round_number"], h["kind"]) for h in hl}
    assert kinds == {(1, "ace"), (2, "triple")}


def test_kills_ignora_suicidio_e_mundo():
    kills = [
        {"round_number": 1, "attacker": None, "victim": "A", "headshot": False},  # dano de mundo
        {"round_number": 1, "attacker": "A", "victim": "A", "headshot": False},   # suicídio
        {"round_number": 1, "attacker": "A", "victim": "B", "headshot": False},   # kill de verdade
    ]
    assert transform.kills_por_round_por_jogador(kills) == {"A": {1: 1}}


def test_kills_ignora_team_kill():
    kills = [
        {"round_number": 1, "attacker": "A", "victim": "B", "headshot": False, "team_kill": False},
        {"round_number": 1, "attacker": "A", "victim": "C", "headshot": False, "team_kill": True},  # TK
    ]
    assert transform.kills_por_round_por_jogador(kills) == {"A": {1: 1}}  # só a kill de verdade


def test_fill_kd_exclui_team_kill_do_kills_mas_conta_death_da_vitima():
    players = [
        {"steam_id64": "A", "team": "T"},
        {"steam_id64": "B", "team": "T"},  # vítima do TK, mesmo time do atacante
    ]
    kills = [
        {"round_number": 1, "attacker": "A", "victim": "X", "headshot": True, "team_kill": False},
        {"round_number": 2, "attacker": "A", "victim": "B", "headshot": True, "team_kill": True},  # TK
    ]
    out = transform.fill_kd_from_kills(players, kills)
    a = next(p for p in out if p["steam_id64"] == "A")
    b = next(p for p in out if p["steam_id64"] == "B")
    assert a["kills"] == 1  # não conta o TK
    assert a["team_kills"] == 1
    assert a["headshot_kills"] == 1  # só a kill de verdade era HS
    assert b["deaths"] == 1  # a vítima do TK ainda morreu


def test_attach_replay_frames_usa_ultima_kill_do_jogador_no_round():
    highlights = [
        {"steam_id64": "A", "round_number": 1, "kind": "triple", "description": "TRIPLE no round 1"},
        {"steam_id64": "B", "round_number": 2, "kind": "clutch_1v2", "description": "CLUTCH", "frame": 9},  # já tem frame
        {"steam_id64": "C", "round_number": 3, "kind": "ace", "description": "ACE no round 3"},  # round sem replay
    ]
    replay_rounds = [
        {"round": 1, "kills": [{"t": 2, "killer": "A", "victim": "x"}, {"t": 5, "killer": "A", "victim": "y"}]},
        {"round": 2, "kills": [{"t": 1, "killer": "B", "victim": "z"}]},
    ]
    out = transform.attach_replay_frames(highlights, replay_rounds)
    assert out[0]["frame"] == 5  # última kill de A no round 1
    assert out[1]["frame"] == 9  # preservado, não recalculado
    assert out[2]["frame"] is None  # round 3 não existe no replay


def test_entry_duels_pega_o_primeiro_kill_de_verdade_do_round_e_confere_vitoria():
    # Times são sempre "A"/"B" nessa base (convenção de parse.py:_team_letter), não "T"/"CT".
    teams = {"A": "A", "B": "A", "C": "B"}
    winner_by_round = {1: "A", 2: "B"}
    kills = [
        {"round_number": 1, "tick": 100, "attacker": "A", "victim": "C", "headshot": False, "team_kill": False},
        {"round_number": 1, "tick": 50, "attacker": "A", "victim": "B", "headshot": False, "team_kill": True},  # TK antes, deve ser ignorado
        {"round_number": 2, "tick": 200, "attacker": "C", "victim": "A", "headshot": False, "team_kill": False},
    ]
    out = transform.entry_duels(kills, teams, winner_by_round)
    assert {"round_number": 1, "attacker": "A", "victim": "C", "venceu": True} in out
    assert {"round_number": 2, "attacker": "C", "victim": "A", "venceu": True} in out


def test_trade_kills_vinga_teammate_dentro_da_janela():
    teams = {"A": "A", "B": "A", "C": "B"}
    kills = [
        {"round_number": 1, "tick": 1000, "attacker": "C", "victim": "A", "headshot": False, "team_kill": False},  # C mata A (do time A)
        {"round_number": 1, "tick": 1000 + 100, "attacker": "B", "victim": "C", "headshot": False, "team_kill": False},  # B vinga A rapidinho
        {"round_number": 1, "tick": 1000 + 500 * 64, "attacker": "B", "victim": "C", "headshot": False, "team_kill": False},  # fora da janela
    ]
    out = transform.trade_kills(kills, teams)
    assert len(out) == 1
    assert out[0] == {"round_number": 1, "attacker": "B", "avenged_teammate": "A"}


def test_clutch_outcomes_detecta_vitoria_e_derrota():
    teams = {"A": "A", "B": "A", "C": "B", "D": "B"}
    # Vitória: A fica 1v2 e o round é do time A (ex.: defuse/tempo) sem A precisar matar
    # os dois — o time B nunca chega a 1 vivo, então só A clutcha.
    kills_vitoria = [
        {"round_number": 1, "tick": 10, "attacker": "C", "victim": "B", "headshot": False, "team_kill": False},  # A fica 1v2
    ]
    out = transform.clutch_outcomes(kills_vitoria, teams, {1: "A"})
    assert out == [{"steam_id64": "A", "round_number": 1, "vs": 2, "venceu": True, "salvou": False}]

    # Derrota: A fica 1v2 e morre; time B nunca chega a 1 vivo.
    kills_derrota = [
        {"round_number": 2, "tick": 10, "attacker": "C", "victim": "B", "headshot": False, "team_kill": False},  # A fica 1v2
        {"round_number": 2, "tick": 20, "attacker": "C", "victim": "A", "headshot": False, "team_kill": False},  # A morre, clutch falhou
    ]
    out2 = transform.clutch_outcomes(kills_derrota, teams, {2: "B"})
    assert out2 == [{"steam_id64": "A", "round_number": 2, "vs": 2, "venceu": False, "salvou": False}]


def test_clutch_outcomes_conta_1v1_pros_dois():
    # Bug real (2026-07-10): exigia vs>=2, então 1v1 nunca virava clutch. E (2026-07-11)
    # um 1v1 conta pros DOIS últimos vivos — um ganha, o outro perde — validado round a
    # round contra o Leetify em partidas reais.
    teams = {"A": "A", "B": "A", "C": "B"}  # o outro jogador do time B já saiu antes deste trecho
    kills = [
        {"round_number": 1, "tick": 10, "attacker": "C", "victim": "B", "headshot": False, "team_kill": False},  # A e C ficam 1v1
        {"round_number": 1, "tick": 20, "attacker": "A", "victim": "C", "headshot": False, "team_kill": False},  # A fecha o 1v1
    ]
    out = transform.clutch_outcomes(kills, teams, {1: "A"})
    assert {"steam_id64": "A", "round_number": 1, "vs": 1, "venceu": True, "salvou": False} in out
    assert {"steam_id64": "C", "round_number": 1, "vs": 1, "venceu": False, "salvou": False} in out
    assert len(out) == 2


def test_clutch_1v1_registra_o_vencedor_mesmo_quando_o_perdedor_chega_primeiro():
    # Bug real (2026-07-11, achado pelo usuário comparando com o Leetify): o algoritmo
    # antigo travava no PRIMEIRO time a chegar a 1 vivo por round (`inicio is None`).
    # Num 1v1 isso é quase sempre o PERDEDOR — o vencedor nunca era registrado e o total
    # de vitórias vinha ~0. Aqui o time B chega a 1 vivo ANTES, mas quem VENCE é o time A.
    teams = {"A": "A", "B": "A", "C": "B", "D": "B"}
    kills = [
        {"round_number": 1, "tick": 10, "attacker": "A", "victim": "C", "headshot": False, "team_kill": False},  # D (time B) fica sozinho: 1v2
        {"round_number": 1, "tick": 20, "attacker": "D", "victim": "B", "headshot": False, "team_kill": False},  # agora A (time A) tbm fica só: 1v1
        {"round_number": 1, "tick": 30, "attacker": "A", "victim": "D", "headshot": False, "team_kill": False},  # A vence o 1v1
    ]
    out = transform.clutch_outcomes(kills, teams, {1: "A"})
    por_sid = {c["steam_id64"]: c for c in out}
    assert por_sid["A"]["venceu"] is True and por_sid["A"]["vs"] == 1   # o vencedor É registrado
    assert por_sid["D"]["venceu"] is False and por_sid["D"]["vs"] == 2  # o perdedor (chegou 1º) tbm


def test_hltv_rating_arredonda_e_zera_sem_rounds():
    assert transform.hltv_rating(20, 15, 0, {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}) == 0.0
    r = transform.hltv_rating(20, 10, 22, {1: 8, 2: 4, 3: 1, 4: 0, 5: 0})
    assert isinstance(r, float) and r > 0


def test_enrich_marca_vencedor_e_rating():
    parsed = {
        "map": "de_mirage",
        "score_a": 13,
        "score_b": 9,
        "rounds": [{"round_number": i + 1, "winner_team": "A", "win_reason": "x"} for i in range(22)],
        "players": [
            {"steam_id64": "A", "nick": "fih", "team": "A", "kills": 25, "deaths": 12, "assists": 5, "headshot_kills": 12, "damage": 2500},
            {"steam_id64": "B", "nick": "rand", "team": "B", "kills": 10, "deaths": 20, "assists": 2, "headshot_kills": 3, "damage": 1200},
        ],
        "kills": [{"round_number": 1, "attacker": "A", "victim": f"v{i}", "headshot": False} for i in range(5)],
    }
    out = transform.enrich(parsed)
    a = next(p for p in out["players"] if p["steam_id64"] == "A")
    b = next(p for p in out["players"] if p["steam_id64"] == "B")
    assert a["won"] is True and b["won"] is False
    assert a["rounds_played"] == 22
    assert a["rating"] > 0
    assert any(h["kind"] == "ace" for h in out["highlights"])


def test_enrich_empate_nao_vira_derrota_forcada():
    # Bug real (2026-07-10): placar igual sempre caía no "else" de score_a > score_b,
    # forçando o time B como "vencedor" e marcando o time A como derrota mesmo empatado.
    parsed = {
        "map": "de_mirage",
        "score_a": 12,
        "score_b": 12,
        "rounds": [{"round_number": i + 1, "winner_team": "A", "win_reason": "x"} for i in range(24)],
        "players": [
            {"steam_id64": "A", "nick": "fih", "team": "A", "kills": 20, "deaths": 20, "assists": 5, "headshot_kills": 8, "damage": 2000},
            {"steam_id64": "B", "nick": "rand", "team": "B", "kills": 18, "deaths": 18, "assists": 4, "headshot_kills": 6, "damage": 1900},
        ],
        "kills": [],
    }
    out = transform.enrich(parsed)
    a = next(p for p in out["players"] if p["steam_id64"] == "A")
    b = next(p for p in out["players"] if p["steam_id64"] == "B")
    assert a["won"] is None and b["won"] is None


def test_enrich_so_gera_highlight_de_clutch_realmente_vencido():
    # Bug real (2026-07-10): os Highlights de clutch vinham de replay.py.detect_clutch
    # (critério: eliminou todo mundo — mesmo perdendo o round por outro motivo, ex.
    # bomba explode depois), diferente do clutch_wins/clutch_attempts do Ranking (exige
    # vencer o ROUND). Resultado: Highlights mostravam clutch que o Ranking não contava.
    # Agora os dois usam a mesma fonte (clutch_outcomes) — nunca mais devem discordar.
    teams = {"A": "A", "B": "A", "C": "B", "D": "B"}
    kills_vitoria = [
        # round 1: A fica 1v2 e fecha o round matando os dois — E o time A venceu o round.
        {"round_number": 1, "tick": 10, "attacker": "C", "victim": "B", "headshot": False, "team_kill": False},
        {"round_number": 1, "tick": 20, "attacker": "A", "victim": "C", "headshot": False, "team_kill": False},
        {"round_number": 1, "tick": 30, "attacker": "A", "victim": "D", "headshot": False, "team_kill": False},
    ]
    parsed = {
        "map": "de_mirage",
        "score_a": 1,
        "score_b": 0,
        "rounds": [{"round_number": 1, "winner_team": "A", "win_reason": "elim"}],
        "players": [
            {"steam_id64": "A", "nick": "fih", "team": "A", "kills": 2, "deaths": 0, "assists": 0, "headshot_kills": 0, "damage": 200},
            {"steam_id64": "B", "nick": "x", "team": "A", "kills": 0, "deaths": 1, "assists": 0, "headshot_kills": 0, "damage": 0},
            {"steam_id64": "C", "nick": "y", "team": "B", "kills": 1, "deaths": 1, "assists": 0, "headshot_kills": 0, "damage": 100},
            {"steam_id64": "D", "nick": "z", "team": "B", "kills": 0, "deaths": 1, "assists": 0, "headshot_kills": 0, "damage": 0},
        ],
        "kills": kills_vitoria,
    }
    out = transform.enrich(parsed)
    clutch_hl = [h for h in out["highlights"] if h["kind"].startswith("clutch")]
    assert clutch_hl == [{"steam_id64": "A", "round_number": 1, "kind": "clutch_1v2", "description": "CLUTCH 1v2 no round 1"}]
    a = next(p for p in out["players"] if p["steam_id64"] == "A")
    assert a["clutch_wins"] == 1 and a["clutch_attempts"] == 1  # highlight e contador batem


def test_enrich_clutch_perdido_o_round_nao_vira_highlight():
    # A fica 1v3 e MORRE sem matar ninguém (o time B fica com 3 vivos, nunca chega a 1
    # vivo, então não há clutch reverso). Só deve contar como tentativa perdida de A,
    # sem gerar highlight nenhum.
    teams_kills = [
        {"round_number": 1, "tick": 10, "attacker": "C", "victim": "B", "headshot": False, "team_kill": False},  # A fica 1v3
        {"round_number": 1, "tick": 20, "attacker": "C", "victim": "A", "headshot": False, "team_kill": False},  # A morre
    ]
    parsed = {
        "map": "de_mirage",
        "score_a": 0,
        "score_b": 1,
        "rounds": [{"round_number": 1, "winner_team": "B", "win_reason": "elim"}],
        "players": [
            {"steam_id64": "A", "nick": "fih", "team": "A", "kills": 0, "deaths": 1, "assists": 0, "headshot_kills": 0, "damage": 0},
            {"steam_id64": "B", "nick": "x", "team": "A", "kills": 0, "deaths": 1, "assists": 0, "headshot_kills": 0, "damage": 0},
            {"steam_id64": "C", "nick": "y", "team": "B", "kills": 2, "deaths": 0, "assists": 0, "headshot_kills": 0, "damage": 200},
            {"steam_id64": "D", "nick": "z", "team": "B", "kills": 0, "deaths": 0, "assists": 0, "headshot_kills": 0, "damage": 0},
            {"steam_id64": "E", "nick": "w", "team": "B", "kills": 0, "deaths": 0, "assists": 0, "headshot_kills": 0, "damage": 0},
        ],
        "kills": teams_kills,
    }
    out = transform.enrich(parsed)
    assert [h for h in out["highlights"] if h["kind"].startswith("clutch")] == []
    a = next(p for p in out["players"] if p["steam_id64"] == "A")
    assert a["clutch_wins"] == 0 and a["clutch_attempts"] == 1
