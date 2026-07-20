import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import replay


def test_world_to_radar_normaliza_e_clampa():
    cal = replay.MAP_CALIBRATION["de_mirage"]
    # ponto na origem de calibração → canto superior-esquerdo (0,0)
    nx, ny = replay.world_to_radar(cal["pos_x"], cal["pos_y"], cal)
    assert nx == 0.0 and ny == 0.0
    # muito fora → clampa em 0..1
    nx, ny = replay.world_to_radar(9_999_999, -9_999_999, cal)
    assert 0.0 <= nx <= 1.0 and 0.0 <= ny <= 1.0
    assert nx == 1.0 and ny == 1.0


def _ticks():
    saida = []
    for tick in range(0, 32, 8):  # 0,8,16,24
        saida.append(
            {
                "round": 1,
                "tick": tick,
                "players": [
                    {"id": "A", "x": -3230, "y": 1713, "yaw": 90.4, "hp": 100, "team": "A", "alive": True},
                ],
            }
        )
    return saida


def test_build_replay_downsample_e_estrutura():
    r = replay.build_replay("de_mirage", _ticks(), target_hz=8)
    assert r["map"] == "de_mirage"
    assert r["calibrated"] is True
    assert len(r["rounds"]) == 1
    frames = r["rounds"][0]["frames"]
    # passo = 64/8 = 8; ticks 0,8,16,24 são todos múltiplos → 4 frames, t=0,1,2,3
    assert [f["t"] for f in frames] == [0, 1, 2, 3]
    p = frames[0]["players"][0]
    assert p["x"] == 0.0 and p["y"] == 0.0 and p["team"] == "A"


def test_build_replay_sem_calibracao_passthrough():
    ticks = [{"round": 1, "tick": 0, "players": [{"id": "A", "x": 0.5, "y": 0.5, "team": "A"}]}]
    r = replay.build_replay("de_mapa_desconhecido", ticks)
    assert r["calibrated"] is False
    assert r["rounds"][0]["frames"][0]["players"][0]["x"] == 0.5


# ---- clutch: divergência entre o critério cinematográfico (detect_clutch) e o
# critério oficial de vitória do round (winner_by_round), dívida técnica do ROADMAP ----

def _ticks_clutch_a1_zera_time_b():
    return [{
        "round": 1, "tick": 0,
        "players": [
            {"id": "A1", "x": 0, "y": 0, "team": "A"},
            {"id": "B1", "x": 0, "y": 0, "team": "B"},
            {"id": "B2", "x": 0, "y": 0, "team": "B"},
        ],
    }]


def _kills_a1_elimina_b1_e_b2():
    return [
        {"round": 1, "tick": 10, "killer": "A1", "victim": "B1"},
        {"round": 1, "tick": 20, "killer": "A1", "victim": "B2"},
    ]


def test_detect_clutch_devolve_time_do_clutcher():
    clutch = replay.detect_clutch(_kills_a1_elimina_b1_e_b2(), {"A1": "A", "B1": "B", "B2": "B"})
    assert clutch is not None
    assert clutch["team"] == "A"
    assert clutch["steamid"] == "A1"


def test_build_replay_sem_winner_by_round_mostra_o_anel_so_pelo_criterio_cinematografico():
    r = replay.build_replay(
        "de_mapa_desconhecido", _ticks_clutch_a1_zera_time_b(), kills=_kills_a1_elimina_b1_e_b2(),
    )
    assert r["rounds"][0]["clutch"] is not None
    assert r["rounds"][0]["clutch"]["steamid"] == "A1"


def test_build_replay_com_winner_by_round_batendo_mantem_o_anel():
    r = replay.build_replay(
        "de_mapa_desconhecido", _ticks_clutch_a1_zera_time_b(), kills=_kills_a1_elimina_b1_e_b2(),
        winner_by_round={1: "A"},
    )
    assert r["rounds"][0]["clutch"] is not None
    assert r["rounds"][0]["clutch"]["steamid"] == "A1"


def test_build_replay_com_winner_by_round_divergente_esconde_o_anel():
    # A1 "zerou" o time B (critério cinematográfico), mas o round oficialmente foi
    # vencido por B (ex.: bomba já tinha explodido) — o anel some, consolidando com
    # transform.clutch_outcomes (usado no Ranking/Highlights).
    r = replay.build_replay(
        "de_mapa_desconhecido", _ticks_clutch_a1_zera_time_b(), kills=_kills_a1_elimina_b1_e_b2(),
        winner_by_round={1: "B"},
    )
    assert r["rounds"][0]["clutch"] is None


# ---- split_for_storage: streaming por round (FIL-54b) ----

def test_split_for_storage_index_nao_leva_frames_mas_rounds_leva():
    r = replay.build_replay("de_mirage", _ticks(), target_hz=8)
    index, rounds = replay.split_for_storage(r)

    assert index["map"] == "de_mirage"
    assert index["calibrated"] is True
    assert len(index["rounds"]) == 1
    assert "frames" not in index["rounds"][0]
    assert index["rounds"][0]["frameCount"] == len(rounds[1]["frames"])

    assert set(rounds.keys()) == {1}
    assert rounds[1]["frames"] == r["rounds"][0]["frames"]


def test_split_for_storage_carrega_clutch_no_index():
    r = replay.build_replay(
        "de_mapa_desconhecido", _ticks_clutch_a1_zera_time_b(), kills=_kills_a1_elimina_b1_e_b2(),
    )
    index, _rounds = replay.split_for_storage(r)
    assert index["rounds"][0]["clutch"]["steamid"] == "A1"
