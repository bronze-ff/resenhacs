from datetime import datetime, timezone

from coletor import faceit


def _pagina(items):
    return {"items": items}


def _item(mid, teams_size=5, finished_at=1000):
    return {"match_id": mid, "teams_size": teams_size, "finished_at": finished_at, "status": "FINISHED"}


def test_listar_historico_5v5_filtra_teams_size_e_ja_vistas_e_para_na_pagina_toda_conhecida():
    paginas = [
        _pagina([_item("m3", finished_at=300), _item("w1", teams_size=2, finished_at=250), _item("m2", finished_at=200)]),
        _pagina([_item("m1", finished_at=100)]),  # toda conhecida -> para aqui sem pedir a próxima
        _pagina([_item("m0", finished_at=50)]),
    ]
    chamadas = []

    def fake_get(url, api_key):
        chamadas.append(url)
        return paginas[len(chamadas) - 1]

    novas = faceit.listar_historico_5v5("k", "fid", ja_vistas={"m1"}, http_get_json=fake_get)
    assert [n["faceit_match_id"] for n in novas] == ["m2", "m3"]  # mais antiga primeiro
    assert len(chamadas) == 2  # não pediu a 3ª página
    assert "offset=0" in chamadas[0] and "limit=100" in chamadas[0] and "game=cs2" in chamadas[0]


def test_listar_historico_5v5_andar_tudo_vai_ate_pagina_vazia():
    paginas = [
        _pagina([_item("m2", finished_at=200)]),
        _pagina([_item("m1", finished_at=100)]),
        _pagina([]),
    ]
    chamadas = []

    def fake_get(url, api_key):
        chamadas.append(url)
        return paginas[len(chamadas) - 1]

    novas = faceit.listar_historico_5v5("k", "fid", ja_vistas={"m1"}, andar_tudo=True, http_get_json=fake_get)
    assert [n["faceit_match_id"] for n in novas] == ["m2"]
    assert len(chamadas) == 3  # andou até a página vazia mesmo com tudo conhecido no meio


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
