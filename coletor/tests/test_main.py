import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import main


def _rdata_com_lineups():
    return {
        "smokes": [
            {
                "round": 1, "x": 100.0, "y": 200.0, "tickStart": 1000, "tickEnd": 1500,
                "thrower": "A", "throwerX": -3230, "throwerY": 1713, "throwerYaw": 90.0, "throwerPitch": 0.0,
            },
            # detonação sem fire correspondente (thrower setado, posição não) — deve
            # ser descartada, não gerar um dict com thrower_x/y = None.
            {
                "round": 2, "x": 50.0, "y": 60.0, "tickStart": 2000, "tickEnd": 2500,
                "thrower": "B", "throwerX": None, "throwerY": None, "throwerYaw": None, "throwerPitch": None,
            },
        ],
        "fires": [],
        "flashes": [],
        "hes": [],
    }


def test_montar_lineups_descarta_item_sem_posicao_de_arremesso():
    lineups = main._montar_lineups(_rdata_com_lineups(), None, "de_mirage", "upload")
    assert len(lineups) == 1
    assert all(l["thrower_x"] is not None and l["thrower_y"] is not None for l in lineups)


def test_montar_lineups_normaliza_mundo_para_radar_quando_mapa_calibrado():
    lineups = main._montar_lineups(_rdata_com_lineups(), {"names": {}}, "de_mirage", "grupo")
    l = lineups[0]
    # (-3230, 1713) é o pos_x/pos_y de calibração de de_mirage → canto superior-esquerdo
    assert l["thrower_x"] == 0.0 and l["thrower_y"] == 0.0
    assert l["origem"] == "grupo"


def test_montar_lineups_mantem_coordenadas_cruas_sem_calibracao():
    lineups = main._montar_lineups(_rdata_com_lineups(), None, "de_mapa_desconhecido", "pro")
    l = lineups[0]
    assert l["thrower_x"] == -3230 and l["thrower_y"] == 1713
    assert l["target_x"] == 100.0 and l["target_y"] == 200.0
    assert l["origem"] == "pro"


def test_montar_lineups_e_o_mesmo_independente_de_quem_chama():
    # cmd_reprocess e ingest_demo precisam produzir a mesma lista dado o mesmo rdata —
    # senão reprocess apaga lineups existentes sem recriar (_write_lineups faz delete
    # antes do insert).
    rdata = _rdata_com_lineups()
    de_ingest = main._montar_lineups(rdata, {"names": {"A": "bronze"}}, "de_mirage", "upload")
    de_reprocess = main._montar_lineups(rdata, {"names": {"A": "bronze"}}, "de_mirage", "upload")
    assert de_ingest == de_reprocess
    assert len(de_reprocess) == 1
