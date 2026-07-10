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
