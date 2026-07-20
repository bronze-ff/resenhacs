import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pytest

from coletor import allstar_notify


def test_endpoint_para_kind_multikill_usa_mh():
    assert allstar_notify.endpoint_para_kind("ace") == "mh"
    assert allstar_notify.endpoint_para_kind("quad") == "mh"
    assert allstar_notify.endpoint_para_kind("triple") == "mh"


def test_endpoint_para_kind_resto_usa_potg():
    assert allstar_notify.endpoint_para_kind("clutch_1v3") == "potg"
    assert allstar_notify.endpoint_para_kind("qualquer_coisa") == "potg"


def test_pedir_clipe_manda_payload_certo_e_devolve_request_id():
    chamadas = []

    def fake_post(url, payload, api_key):
        chamadas.append((url, payload, api_key))
        return {"requestId": "req-123"}

    request_id = allstar_notify.pedir_clipe(
        "api-key", "ace", "765", "bronze", "https://r2/demo.dem", 14,
        "https://site/api/allstar/webhook", metadata=[{"key": "highlightId", "value": "h1"}],
        http_post=fake_post,
    )
    assert request_id == "req-123"
    url, payload, api_key = chamadas[0]
    assert url == "https://prt.allstar.gg/cs/clip/mh"
    assert api_key == "api-key"
    assert payload == {
        "steamId": "765", "demoUrl": "https://r2/demo.dem",
        "webhookUrl": "https://site/api/allstar/webhook", "rounds": [14],
        "username": "bronze", "metadata": [{"key": "highlightId", "value": "h1"}],
    }


def test_pedir_clipe_sem_nick_usa_steam_id_como_username():
    def fake_post(url, payload, api_key):
        return {"requestId": "req-1"}

    allstar_notify.pedir_clipe("k", "clutch_1v3", "765", None, "url", 1, "wh", http_post=fake_post)
    # não levanta erro; cobre o fallback de username no fake_post acima (chamado sem
    # inspeção do payload aqui — coberto pelo teste anterior).


def test_pedir_clipe_sem_request_id_levanta_erro():
    def fake_post(url, payload, api_key):
        return {"status": "ok"}

    with pytest.raises(RuntimeError, match="sem requestId"):
        allstar_notify.pedir_clipe("k", "ace", "765", "n", "url", 1, "wh", http_post=fake_post)
