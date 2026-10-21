import pytest
from datetime import datetime, timezone

from coletor import faceit


def _pagina(items):
    return {"items": items}


def _item(mid, teams_size=5, finished_at=1000):
    return {"match_id": mid, "teams_size": teams_size, "finished_at": finished_at, "status": "FINISHED"}


def test_listar_historico_5v5_passa_from_to_e_pagina_ate_o_fim(monkeypatch):
    monkeypatch.setattr(faceit, "PAGINA", 3)
    paginas = [
        _pagina([_item("m5", finished_at=500), _item("w1", teams_size=2, finished_at=450),
                 _item("m4", finished_at=400)]),
        # página cheia mesmo toda conhecida: continua (a janela já limita o volume)
        _pagina([_item("m3", finished_at=300), _item("m2", finished_at=200), _item("m1", finished_at=150)]),
        _pagina([_item("m0", finished_at=100)]),  # incompleta = fim, não pede a próxima
    ]
    chamadas = []

    def fake_get(url, api_key):
        chamadas.append(url)
        return paginas[len(chamadas) - 1]

    res = faceit.listar_historico_5v5("k", "fid", ja_vistas={"m3", "m2"},
                                      desde=1_700_000_000, ate=1_800_000_000, http_get_json=fake_get)
    assert [n["faceit_match_id"] for n in res["novas"]] == ["m0", "m1", "m4", "m5"]  # mais antiga primeiro
    assert res["na_api"] == 7 and res["ja_conhecidas"] == 2 and res["ignoradas"] == 1
    assert len(chamadas) == 3
    assert "from=1700000000" in chamadas[0] and "to=1800000000" in chamadas[0]
    assert "offset=0" in chamadas[0] and "offset=3" in chamadas[1] and "game=cs2" in chamadas[0]


def test_listar_historico_5v5_primeira_varredura_pede_desde_o_lancamento_do_cs2():
    chamadas = []

    def fake_get(url, api_key):
        chamadas.append(url)
        return _pagina([])

    res = faceit.listar_historico_5v5("k", "fid", ja_vistas=set(), desde=None, http_get_json=fake_get)
    assert res["novas"] == [] and res["na_api"] == 0
    assert f"from={faceit.INICIO_CS2_EPOCH}" in chamadas[0]
    assert "to=" not in chamadas[0]


def test_listar_historico_5v5_ignora_nao_finalizada_e_repetida_entre_paginas(monkeypatch):
    monkeypatch.setattr(faceit, "PAGINA", 2)
    paginas = [
        _pagina([_item("m2", finished_at=200), {**_item("x", finished_at=250), "status": "CANCELLED"}]),
        _pagina([_item("m2", finished_at=200)]),  # offset deslizou: m2 de novo
    ]
    chamadas = []

    def fake_get(url, api_key):
        chamadas.append(url)
        return paginas[len(chamadas) - 1]

    res = faceit.listar_historico_5v5("k", "fid", ja_vistas=set(), desde=1, http_get_json=fake_get)
    assert [n["faceit_match_id"] for n in res["novas"]] == ["m2"]
    assert res["ignoradas"] == 1


def test_sem_acesso_downloads_reconhece_403():
    import urllib.error
    erro = urllib.error.HTTPError("https://x", 403, "Forbidden", {}, None)
    assert faceit.sem_acesso_downloads(erro) is True
    assert faceit.sem_acesso_downloads(urllib.error.HTTPError("https://x", 500, "x", {}, None)) is False
    assert faceit.sem_acesso_downloads(RuntimeError("403")) is False


def test_elo_atual_extrai_games_cs2_e_tolera_ausencia():
    payload = {"games": {"cs2": {"faceit_elo": 1420, "skill_level": 7}}}
    assert faceit.elo_atual("k", "fid", http_get_json=lambda u, k: payload) == (1420, 7)
    assert faceit.elo_atual("k", "fid", http_get_json=lambda u, k: {"games": {}}) == (None, None)


DETALHES = {
    "teams": {
        "faction1": {"name": "time_alpha", "roster": [
            {"game_player_id": "111", "player_id": "f-111", "nickname": "alpha1"},
        ]},
        "faction2": {"name": "time_beta", "roster": [
            {"game_player_id": "222", "player_id": "f-222", "nickname": "beta1"},
        ]},
    },
    "results": {"winner": "faction2", "score": {"faction1": 7, "faction2": 13}},
    "finished_at": 1752690000,
    "demo_url": ["https://demos.faceit.com/x.dem.gz"],
}

STATS = {"rounds": [{
    "round_stats": {"Map": "de_mirage", "Rounds": "20"},
    "teams": [
        {"team_id": "t1", "players": [
            {"player_id": "f-111", "nickname": "alpha1",
             "player_stats": {"Kills": "20", "Deaths": "15", "Assists": "4", "Headshots": "9", "MVPs": "3"}},
        ]},
        {"team_id": "t2", "players": [
            {"player_id": "f-222", "nickname": "beta1",
             "player_stats": {"Kills": "25", "Deaths": "12", "Assists": "6", "Headshots": "13", "MVPs": "5"}},
        ]},
    ],
}]}


def test_montar_parsed_stats_only_mapeia_times_placar_e_stats():
    parsed = faceit.montar_parsed_stats_only(DETALHES, STATS)
    assert parsed["map"] == "de_mirage"
    assert parsed["score_a"] == 7 and parsed["score_b"] == 13
    assert parsed["team_a_name"] == "time_alpha" and parsed["team_b_name"] == "time_beta"
    assert parsed["played_at"].startswith("2025") or parsed["played_at"].startswith("2026")
    alpha = next(p for p in parsed["players"] if p["steam_id64"] == "111")
    beta = next(p for p in parsed["players"] if p["steam_id64"] == "222")
    assert alpha["team"] == "A" and alpha["kills"] == 20 and alpha["deaths"] == 15
    assert alpha["assists"] == 4 and alpha["headshot_kills"] == 9
    assert alpha["won"] is False and beta["won"] is True
    assert alpha["rounds_played"] == 20
    # listas que só o parser produz ficam vazias, mas PRESENTES (store_parsed itera nelas)
    for chave in ("rounds", "kills", "highlights", "round_econ", "player_round_econ",
                  "purchases", "player_damage", "player_flashes", "kill_positions", "lineups"):
        assert parsed[chave] == []


# Formato real do /matches/{id}/stats de CS2 (valores vêm como string).
STATS_CS2 = {"rounds": [{
    "round_stats": {"Map": "de_ancient", "Score": "13 / 9", "Winner": "t2"},
    "teams": [
        {"team_id": "t1", "players": [
            {"player_id": "f-111", "nickname": "alpha1", "player_stats": {
                "Kills": "18", "Deaths": "17", "Assists": "5", "Headshots": "8", "Headshots %": "44",
                "ADR": "84.5", "MVPs": "3", "Double Kills": "4", "Triple Kills": "2",
                "Quadro Kills": "0", "Penta Kills": "0", "First Kills": "4", "Entry Count": "7",
                "Entry Wins": "4", "1v1Count": "2", "1v1Wins": "1", "1v2Count": "1", "1v2Wins": "0",
                "Flash Count": "9", "Enemies Flashed": "6", "Utility Damage": "112",
                "K/D Ratio": "1.06", "Result": "0"}},
        ]},
        {"team_id": "t2", "players": [
            {"player_id": "f-222", "nickname": "beta1", "player_stats": {
                "Kills": "25", "Deaths": "12", "Assists": "6", "Headshots %": "40",
                "Damage": "2310", "ADR": "105", "MVPs": "6", "Triple Kills": "1",
                "Quadro Kills": "1", "Penta Kills": "1", "Result": "1"}},
        ]},
    ],
}]}


def test_montar_parsed_stats_only_cs2_mapeia_adr_mvps_multikills_entry_clutch_e_utilitaria():
    detalhes = {**DETALHES, "results": {"winner": "faction2", "score": {"faction1": 9, "faction2": 13}}}
    parsed = faceit.montar_parsed_stats_only(detalhes, STATS_CS2)
    assert parsed["map"] == "de_ancient"
    alpha = next(p for p in parsed["players"] if p["steam_id64"] == "111")
    beta = next(p for p in parsed["players"] if p["steam_id64"] == "222")
    assert alpha["rounds_played"] == 22  # sem "Rounds": sai do "Score"
    assert alpha["damage"] == round(84.5 * 22)  # só ADR -> ADR x rounds
    assert beta["damage"] == 2310  # "Damage" direto vence o ADR
    assert alpha["headshot_kills"] == 8
    assert beta["headshot_kills"] == 10  # sem "Headshots": 40% de 25
    assert (alpha["mvps"], alpha["triple_kills"], alpha["quadro_kills"], alpha["penta_kills"]) == (3, 2, 0, 0)
    assert (beta["mvps"], beta["triple_kills"], beta["quadro_kills"], beta["penta_kills"]) == (6, 1, 1, 1)
    assert alpha["entry_kills"] == 4 and alpha["entry_deaths"] == 3
    assert alpha["clutch_attempts"] == 3 and alpha["clutch_wins"] == 1
    assert alpha["flashes_thrown"] == 9 and alpha["enemies_flashed"] == 6
    assert alpha["utility_damage"] == 112
    # campo ausente não vira número inventado
    assert "entry_kills" not in beta and "clutch_attempts" not in beta


def test_montar_parsed_stats_only_sem_stats_tem_rounds_do_placar_e_extras_nulos():
    detalhes = {**DETALHES, "voting": {"map": {"pick": ["de_nuke"]}}}
    parsed = faceit.montar_parsed_stats_only(detalhes, {"rounds": []})
    assert parsed["map"] == "de_nuke"  # fallback pro mapa votado
    p = parsed["players"][0]
    assert p["rounds_played"] == 20 and p["damage"] == 0
    assert p["mvps"] is None and p["penta_kills"] is None


def test_escolher_partida_para_elo_pega_a_mais_recente_depois_do_snapshot():
    dt = lambda s: datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
    novas = [("m1", dt("2026-07-16T10:00:00")), ("m2", dt("2026-07-16T12:00:00")), ("m3", dt("2026-07-15T09:00:00"))]
    assert faceit.escolher_partida_para_elo(novas, dt("2026-07-16T09:00:00")) == "m2"
    assert faceit.escolher_partida_para_elo(novas, dt("2026-07-16T13:00:00")) is None
    assert faceit.escolher_partida_para_elo(novas, None) is None  # sem snapshot anterior, sem delta honesto
    assert faceit.escolher_partida_para_elo([], dt("2026-07-16T09:00:00")) is None


def test_baixar_demo_troca_por_url_assinada_e_descomprime_gzip():
    import gzip
    dem = b"HL2DEMO fake bytes"
    chamados = {}

    def fake_post(url, api_key, body):
        chamados["post"] = (url, body)
        return {"payload": {"download_url": "https://signed/x.dem.gz"}}

    def fake_get_bytes(url):
        chamados["get"] = url
        return gzip.compress(dem)

    out = faceit.baixar_demo("k", "https://demos.faceit.com/x.dem.gz",
                             http_post_json=fake_post, http_get_bytes=fake_get_bytes)
    assert out == dem
    assert chamados["post"][1] == {"resource_url": "https://demos.faceit.com/x.dem.gz"}
    assert chamados["get"] == "https://signed/x.dem.gz"


def test_baixar_demo_aceita_download_url_na_raiz_e_bytes_nao_gzipados():
    out = faceit.baixar_demo(
        "k", "u",
        http_post_json=lambda url, api_key, body: {"download_url": "https://signed/x.dem"},
        http_get_bytes=lambda url: b"raw dem sem gzip",
    )
    assert out == b"raw dem sem gzip"


def test_descomprimir_gzip_com_teto_barra_bomba():
    import gzip as _gz
    from coletor import faceit as _f
    bomba = _gz.compress(b"\0" * 2_000_000)
    with pytest.raises(RuntimeError, match="teto"):
        _f._descomprimir_gzip_com_teto(bomba, max_bytes=1_000_000)
    assert _f._descomprimir_gzip_com_teto(_gz.compress(b"demo")) == b"demo"


def test_http_get_bytes_exige_https():
    from coletor import faceit as _f
    with pytest.raises(RuntimeError, match="https"):
        _f._http_get_bytes("http://demos.faceit.com/x.dem.gz")


def test_baixar_demo_usa_o_descompressor_com_teto(monkeypatch):
    import gzip as _gz
    from coletor import faceit as _f
    monkeypatch.setattr(_f, "MAX_DEMO_BYTES", 1_000_000)
    monkeypatch.setattr(_f._descomprimir_gzip_com_teto, "__defaults__", (1_000_000,))
    bomba = _gz.compress(bytes(2_000_000))
    with pytest.raises(RuntimeError, match="teto"):
        _f.baixar_demo(
            "k", "https://demos.faceit.com/x.dem.gz",
            http_post_json=lambda url, key, body: {"payload": {"download_url": "https://d/x"}},
            http_get_bytes=lambda url: bomba,
        )


# ---- R108: download da FACEIT truncado não passa como Demo completa ----

def test_descomprimir_gzip_cortado_levanta():
    import gzip as _gz
    completo = _gz.compress(b"demo inteira " * 1000)
    with pytest.raises(RuntimeError, match="truncad"):
        faceit._descomprimir_gzip_com_teto(completo[: len(completo) // 2])


class _RespFake:
    def __init__(self, dados, content_length):
        self._dados = dados
        self.headers = {} if content_length is None else {"Content-Length": str(content_length)}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self, n=-1):
        dados, self._dados = self._dados, b""
        return dados


def test_http_get_bytes_confere_content_length(monkeypatch):
    monkeypatch.setattr(faceit.urllib.request, "urlopen", lambda url, timeout=None: _RespFake(b"abc", 10))
    with pytest.raises(RuntimeError, match="truncad"):
        faceit._http_get_bytes("https://cdn.faceit.com/x.dem.gz")


def test_http_get_bytes_sem_content_length_ou_igual_passa(monkeypatch):
    monkeypatch.setattr(faceit.urllib.request, "urlopen", lambda url, timeout=None: _RespFake(b"abc", 3))
    assert faceit._http_get_bytes("https://cdn.faceit.com/x.dem.gz") == b"abc"
    monkeypatch.setattr(faceit.urllib.request, "urlopen", lambda url, timeout=None: _RespFake(b"abc", None))
    assert faceit._http_get_bytes("https://cdn.faceit.com/x.dem.gz") == b"abc"
