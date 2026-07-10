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
