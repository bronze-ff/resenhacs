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

    novos = steam_api.walk_chain("KEY", "7656", "AUTH", "CSGO-1", http_get_json=fake_get, sleep=lambda *_: None)
    assert novos == ["CSGO-2", "CSGO-3"]
    assert len(urls) == 3  # parou ao receber n/a


def test_walk_chain_respeita_limite():
    def fake_get(url):
        return {"result": {"nextcode": "CSGO-loop"}}

    novos = steam_api.walk_chain("K", "s", "a", "CSGO-0", http_get_json=fake_get, limite=4, sleep=lambda *_: None)
    assert len(novos) == 4


def test_buscar_avatares_usa_avatarmedium():
    chamadas = []

    def fake_get(url):
        chamadas.append(url)
        return {"response": {"players": [
            {"steamid": "111", "avatarmedium": "https://x/medium1.jpg", "avatar": "https://x/small1.jpg"},
            {"steamid": "222", "avatar": "https://x/small2.jpg"},  # sem avatarmedium: cai pro avatar pequeno
        ]}}

    mapa = steam_api.buscar_avatares("KEY", ["111", "222"], http_get_json=fake_get)
    assert mapa == {"111": "https://x/medium1.jpg", "222": "https://x/small2.jpg"}
    assert len(chamadas) == 1
    assert "key=KEY" in chamadas[0] and "steamids=111%2C222" in chamadas[0]


def test_buscar_avatares_ignora_id_sem_perfil():
    def fake_get(url):
        return {"response": {"players": []}}

    assert steam_api.buscar_avatares("KEY", ["999"], http_get_json=fake_get) == {}


def test_buscar_avatares_faz_lotes_de_100():
    chamadas = []

    def fake_get(url):
        chamadas.append(url)
        return {"response": {"players": []}}

    ids = [str(i) for i in range(150)]
    steam_api.buscar_avatares("KEY", ids, http_get_json=fake_get)
    assert len(chamadas) == 2


def test_buscar_avatares_dedup_preserva_ordem():
    chamadas = []

    def fake_get(url):
        chamadas.append(url)
        return {"response": {"players": []}}

    steam_api.buscar_avatares("KEY", ["1", "2", "1"], http_get_json=fake_get)
    assert "steamids=1%2C2" in chamadas[0]


def test_http_get_json_trata_404_como_fim_da_corrente():
    import urllib.error

    def fake_urlopen(*_a, **_k):
        raise urllib.error.HTTPError("u", 404, "Not Found", {}, None)

    import urllib.request
    orig = urllib.request.urlopen
    urllib.request.urlopen = fake_urlopen
    try:
        assert steam_api._http_get_json("http://x") == {"result": {"nextcode": "n/a"}}
    finally:
        urllib.request.urlopen = orig
