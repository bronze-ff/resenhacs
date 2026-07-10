import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import steam_api


def test_build_url_tem_todos_os_params():
    url = steam_api.build_next_code_url("KEY", "7656", "AUTH", "CSGO-x")
    assert url.startswith(steam_api.BASE + "?")
    assert "key=KEY" in url and "steamid=7656" in url
    assert "steamidkey=AUTH" in url and "knowncode=CSGO-x" in url


def test_parse_next_code():
    assert steam_api.parse_next_code_response({"result": {"nextcode": "CSGO-abc"}}) == "CSGO-abc"
    assert steam_api.parse_next_code_response({"result": {"nextcode": "n/a"}}) is None
    assert steam_api.parse_next_code_response({"result": {}}) is None
    assert steam_api.parse_next_code_response('{"result": {"nextcode": "CSGO-json"}}') == "CSGO-json"


def test_walk_chain_para_no_fim():
    respostas = iter([
        {"result": {"nextcode": "CSGO-2"}},
        {"result": {"nextcode": "CSGO-3"}},
        {"result": {"nextcode": "n/a"}},
    ])
    urls = []

    def fake_get(url):
        urls.append(url)
        return next(respostas)

    novos = steam_api.walk_chain("KEY", "7656", "AUTH", "CSGO-1", http_get_json=fake_get)
    assert novos == ["CSGO-2", "CSGO-3"]
    assert len(urls) == 3  # parou ao receber n/a


def test_walk_chain_respeita_limite():
    def fake_get(url):
        return {"result": {"nextcode": "CSGO-loop"}}

    novos = steam_api.walk_chain("K", "s", "a", "CSGO-0", http_get_json=fake_get, limite=4)
    assert len(novos) == 4
