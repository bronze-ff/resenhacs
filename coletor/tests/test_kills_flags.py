import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import parse


def test_flags_do_kill_le_campos_do_player_death_e_ausente_vira_false():
    assert parse._flags_do_kill({"penetrated": 2, "thrusmoke": True, "attackerblind": 1, "noscope": False}) == {
        "wallbang": True, "thrusmoke": True, "attackerblind": True, "noscope": False,
    }
    assert parse._flags_do_kill({"penetrated": 0}) == {
        "wallbang": False, "thrusmoke": False, "attackerblind": False, "noscope": False,
    }
    flags = parse._flags_do_kill({"penetrated": float("nan"), "noscope": None})
    assert flags["wallbang"] is False and flags["noscope"] is False


def test_montar_kill_positions_mantem_team_kill_marcado_e_carrega_flags():
    kills = [
        {"round_number": 1, "tick": 100, "attacker": "1", "victim": "2", "assister": None,
         "headshot": True, "team_kill": False, "weapon": "awp",
         "wallbang": True, "thrusmoke": False, "attackerblind": False, "noscope": True},
        {"round_number": 2, "tick": 200, "attacker": "1", "victim": "3", "assister": None,
         "headshot": False, "team_kill": True, "weapon": "hegrenade"},
        {"round_number": 2, "tick": 300, "attacker": "1", "victim": "9", "assister": None,
         "headshot": False, "team_kill": False, "weapon": "ak47"},  # sem posição: descarta
    ]
    pos = {("2", 100): (1.0, 2.0, "ak47"), ("1", 100): (5.0, 6.0, "awp"), ("3", 200): (7.0, 8.0, None)}
    linhas = parse._montar_kill_positions(kills, pos)
    assert len(linhas) == 2
    assert linhas[0]["is_team_kill"] is False
    assert linhas[0]["wallbang"] is True and linhas[0]["noscope"] is True
    assert linhas[0]["killer_x"] == 5.0
    tk = linhas[1]
    assert tk["is_team_kill"] is True and tk["killer"] == "1" and tk["victim"] == "3"
    assert tk["weapon"] == "hegrenade" and tk["killer_x"] is None
    assert tk["wallbang"] is False and tk["thrusmoke"] is False
