import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import storage_r2, db


# ---- storage ----

class FakeBody:
    def __init__(self, data):
        self._data = data

    def read(self):
        return self._data


class FakeS3:
    def __init__(self):
        self.puts = []
        self.deletes = []
        self.gets = []
        self.objetos = {}  # key -> bytes, pro get_object devolver de volta
        self.cors = []

    def put_object(self, **kw):
        self.puts.append(kw)
        self.objetos[kw["Key"]] = kw["Body"]

    def delete_object(self, **kw):
        self.deletes.append(kw)

    def get_object(self, **kw):
        self.gets.append(kw)
        return {"Body": FakeBody(self.objetos[kw["Key"]])}

    def put_bucket_cors(self, **kw):
        self.cors.append(kw)


def test_keys():
    assert storage_r2.demo_key(123) == "demos/123.dem.bz2"
    assert storage_r2.replay_key(123) == "replays/123.json"


def test_upload_bytes():
    s3 = FakeS3()
    key = storage_r2.upload_bytes(s3, "bucket", "demos/1.dem.bz2", b"abc")
    assert key == "demos/1.dem.bz2"
    assert s3.puts[0]["Bucket"] == "bucket"
    assert s3.puts[0]["Body"] == b"abc"


def test_delete_object():
    s3 = FakeS3()
    storage_r2.delete_object(s3, "bucket", "demos/1.dem.bz2")
    assert s3.deletes[0] == {"Bucket": "bucket", "Key": "demos/1.dem.bz2"}


def test_download_bytes_devolve_o_que_foi_upado():
    s3 = FakeS3()
    storage_r2.upload_bytes(s3, "bucket", "demos/1.dem.bz2", b"conteudo-da-demo")
    assert storage_r2.download_bytes(s3, "bucket", "demos/1.dem.bz2") == b"conteudo-da-demo"


def test_configurar_cors_manda_regra_pro_bucket():
    s3 = FakeS3()
    storage_r2.configurar_cors(s3, "bucket", ["https://a.com", "http://localhost:5173"])
    assert s3.cors[0]["Bucket"] == "bucket"
    regra = s3.cors[0]["CORSConfiguration"]["CORSRules"][0]
    assert regra["AllowedOrigins"] == ["https://a.com", "http://localhost:5173"]
    assert regra["AllowedMethods"] == ["PUT", "GET"]
    assert regra["AllowedHeaders"] == ["content-type"]
    assert regra["MaxAgeSeconds"] == 3600


def test_key_from_url_extrai_a_key_do_bucket_configurado():
    url = "https://abc.r2.cloudflarestorage.com/resenha-demos/replays/42.json"
    assert storage_r2.key_from_url(url, "resenha-demos") == "replays/42.json"
    # bucket errado (ou url de outro provedor) -> não sabe extrair, não inventa
    assert storage_r2.key_from_url(url, "outro-bucket") is None


# ---- db ----

class FakeCursor:
    def __init__(self, conn):
        self.conn = conn
        self._last = ""

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self._last = " ".join(sql.split())
        self.conn.calls.append((self._last, params))

    def fetchone(self):
        # O SELECT do dedupe por fingerprint devolve o que o teste configurar
        # (None = partida inédita, caminho do insert).
        if self._last.startswith("select id from matches where fingerprint"):
            return self.conn.fingerprint_row
        if self._last.startswith("select grupo_ativo_id from players"):
            return self.conn.grupo_ativo_row
        if self._last.startswith("select id from groups"):
            return self.conn.grupo_mais_antigo_row
        return ["00000000-0000-0000-0000-000000000001"]

    def fetchall(self):
        if self._last.startswith("select id, hltv_url, arquivo_r2_key from partidas_pro_fila"):
            return self.conn.fila_rows
        if self._last.startswith("select id, group_id, adicionado_por, arquivo_r2_key, share_code, played_at from uploads_pendentes"):
            return self.conn.uploads_rows
        if self._last.startswith("select steam_id64 from steam_avatares"):
            return [(s,) for s in self.conn.avatares_frescos]
        if "distinct mp.steam_id64" in self._last:
            return [(s,) for s in self.conn.match_players_sem_avatar]
        return []


class FakeConn:
    def __init__(self, fingerprint_row=None):
        self.calls = []
        self.commits = 0
        self.fingerprint_row = fingerprint_row
        self.fila_rows = []
        self.uploads_rows = []
        self.avatares_frescos = []
        self.match_players_sem_avatar = []
        self.grupo_ativo_row = None
        self.grupo_mais_antigo_row = None

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1


def _parsed():
    return {
        "map": "de_mirage",
        "score_a": 13,
        "score_b": 9,
        "played_at": "2026-07-10T12:00:00+00:00",
        "players": [
            {"steam_id64": "A", "nick": "fih", "team": "A", "kills": 20, "deaths": 10,
             "assists": 4, "headshot_kills": 9, "damage": 2100, "rounds_played": 22,
             "rating": 1.2, "kast_pct": 0.75, "won": True},
        ],
        "rounds": [{"round_number": 1, "winner_team": "A", "win_reason": "elim"}],
        "highlights": [{"steam_id64": "A", "round_number": 1, "kind": "ace", "description": "ACE"}],
    }


def test_store_parsed_grava_tudo_e_commita():
    conn = FakeConn()
    mid = db.store_parsed(conn, _parsed(), share_code="CSGO-x", source="upload")
    assert mid == "00000000-0000-0000-0000-000000000001"
    assert conn.commits == 1
    sqls = [c[0] for c in conn.calls]
    assert any(s.startswith("insert into matches") for s in sqls)
    match_call = next(c for c in conn.calls if c[0].startswith("insert into matches"))
    assert match_call[1][5] == "2026-07-10T12:00:00+00:00"  # played_at
    assert any(s.startswith("insert into match_players") for s in sqls)
    assert any("update match_players set is_tracked" in s for s in sqls)
    assert any(s.startswith("insert into rounds") for s in sqls)
    assert any(s.startswith("delete from highlights") for s in sqls)
    assert any(s.startswith("insert into highlights") for s in sqls)
    assert any(s.startswith("delete from match_player_weapons") for s in sqls)
    assert any(s.startswith("delete from match_round_econ") for s in sqls)
    assert any(s.startswith("delete from kill_positions") for s in sqls)


def test_store_parsed_grava_kast_pct_em_match_players():
    conn = FakeConn()
    db.store_parsed(conn, _parsed(), share_code="CSGO-x", source="upload")
    insert = next(c for c in conn.calls if c[0].startswith("insert into match_players"))
    # Verificar que kast_pct está no índice correto (depois de rating, que está no índice 10)
    # (match_id, steam_id64, nick, team, kills, deaths, assists, headshot_kills, damage, rounds_played, rating, kast_pct, won, ...)
    assert insert[1][11] == 0.75  # kast_pct deve estar na posição 11 (0-indexed)


def test_store_parsed_grava_premier_rating_em_match_players():
    conn = FakeConn()
    parsed = _parsed()
    parsed["players"][0]["premier_rating_before"] = 5200
    parsed["players"][0]["premier_rating_after"] = 5242
    db.store_parsed(conn, parsed, share_code="CSGO-x", source="upload")
    insert = next(c for c in conn.calls if c[0].startswith("insert into match_players"))
    assert insert[1][-2:] == (5200, 5242)


def test_todas_as_queries_de_store_parsed_tem_placeholders_e_params_alinhados():
    # Regra geral, não só match_players: nº de %s na SQL tem que bater com o nº de
    # params na tupla — achado real (revisão da Task 3 do plano de KAST): um %s a
    # mais no values() de match_players (41 vs 40 colunas/params) quebraria TODO
    # ingest em produção, mas passava despercebido porque FakeCursor só grava
    # (sql, params) sem validar a contagem — os testes específicos de cada campo
    # (ex.: o de kast_pct acima) checam a POSIÇÃO certa mas não pegam esse
    # desalinhamento de contagem sozinhos.
    conn = FakeConn()
    db.store_parsed(conn, _parsed(), share_code="CSGO-x", source="upload")
    for sql, params in conn.calls:
        esperado = sql.count("%s")
        recebido = len(params) if params is not None else 0
        assert esperado == recebido, f"{sql[:60]}...: {esperado} placeholders vs {recebido} params"


def test_store_parsed_grava_economia_por_jogador_e_compras():
    conn = FakeConn()
    parsed = _parsed()
    parsed["player_round_econ"] = [
        {"round_number": 1, "steam_id64": "A", "team": "A", "equip_value": 4000, "buy_type": "eco"},
    ]
    parsed["purchases"] = [
        {"round_number": 1, "steam_id64": "A", "item": "deagle", "cost": 700, "tick": 100},
    ]
    db.store_parsed(conn, parsed, share_code="CSGO-x", source="upload")
    econ_insert = next(c for c in conn.calls if c[0].startswith("insert into match_player_round_econ"))
    assert econ_insert[1] == ("00000000-0000-0000-0000-000000000001", 1, "A", "A", 4000, "eco")
    compra_insert = next(c for c in conn.calls if c[0].startswith("insert into match_player_purchases"))
    assert compra_insert[1] == ("00000000-0000-0000-0000-000000000001", 1, "A", "deagle", 700, 100)
    assert any(s.startswith("delete from match_player_round_econ") for s, _ in conn.calls)
    assert any(s.startswith("delete from match_player_purchases") for s, _ in conn.calls)


def test_write_player_round_econ_e_idempotente_contra_duplicata_no_mesmo_lote():
    # Achado real: uma demo com reinício técnico no meio do round 1 gera 2 leituras de
    # current_equip_value pro mesmo (round_number, steam_id64) — sem ON CONFLICT, a 2a
    # linha duplicada estourava a PK (match_id, round_number, steam_id64) e derrubava o
    # ingest inteiro do upload manual.
    conn = FakeConn()
    parsed = _parsed()
    parsed["player_round_econ"] = [
        {"round_number": 1, "steam_id64": "A", "team": "A", "equip_value": 800, "buy_type": "eco"},
        {"round_number": 1, "steam_id64": "A", "team": "A", "equip_value": 4000, "buy_type": "eco"},
    ]
    db.store_parsed(conn, parsed, share_code="CSGO-x", source="upload")
    inserts = [c for c in conn.calls if c[0].startswith("insert into match_player_round_econ")]
    assert len(inserts) == 2
    assert all("on conflict (match_id, round_number, steam_id64) do update" in sql for sql, _ in inserts)


def test_store_parsed_grava_dano_e_flashes_por_par():
    conn = FakeConn()
    parsed = _parsed()
    parsed["player_damage"] = [
        {"attacker": "A", "victim": "B", "weapon": "ak47", "damage": 300, "hits": 4},
    ]
    parsed["player_flashes"] = [
        {"attacker": "A", "victim": "B", "count": 2, "duration_sum": 3.5},
    ]
    db.store_parsed(conn, parsed, share_code="CSGO-x", source="upload")
    dano_insert = next(c for c in conn.calls if c[0].startswith("insert into match_player_damage"))
    assert dano_insert[1] == ("00000000-0000-0000-0000-000000000001", "A", "B", "ak47", 300, 4)
    flash_insert = next(c for c in conn.calls if c[0].startswith("insert into match_player_flashes"))
    assert flash_insert[1] == ("00000000-0000-0000-0000-000000000001", "A", "B", 2, 3.5)
    assert any(s.startswith("delete from match_player_damage") for s, _ in conn.calls)
    assert any(s.startswith("delete from match_player_flashes") for s, _ in conn.calls)


def test_store_parsed_grava_posicoes_de_kill():
    conn = FakeConn()
    parsed = _parsed()
    parsed["kill_positions"] = [{
        "round_number": 1, "tick": 500, "killer": "A", "victim": "B", "weapon": "ak47",
        "victim_weapon": "usp_silencer",
        "headshot": True, "killer_x": 100.0, "killer_y": 200.0, "victim_x": 150.0, "victim_y": 250.0,
    }]
    db.store_parsed(conn, parsed, share_code="CSGO-x", source="upload")
    insert = next(c for c in conn.calls if c[0].startswith("insert into kill_positions"))
    assert insert[1] == (
        "00000000-0000-0000-0000-000000000001", 1, 500, "A", "B", "ak47", "usp_silencer", True,
        100.0, 200.0, 150.0, 250.0,
    )


def test_store_parsed_grava_economia_por_round():
    conn = FakeConn()
    parsed = _parsed()
    parsed["round_econ"] = [{"round_number": 1, "team": "A", "equip_value": 4500, "buy_type": "eco"}]
    db.store_parsed(conn, parsed, share_code="CSGO-x", source="upload")
    insert = next(c for c in conn.calls if c[0].startswith("insert into match_round_econ"))
    assert insert[1] == ("00000000-0000-0000-0000-000000000001", 1, "A", 4500, "eco")


def test_store_parsed_grava_stats_por_arma():
    conn = FakeConn()
    parsed = _parsed()
    parsed["players"][0]["weapons"] = {
        "ak47": {"kills": 10, "hs_kills": 5, "shots_fired": 80, "shots_hit": 30, "damage": 1500},
    }
    db.store_parsed(conn, parsed, share_code="CSGO-x", source="upload")
    insert = next(c for c in conn.calls if c[0].startswith("insert into match_player_weapons"))
    assert insert[1] == ("00000000-0000-0000-0000-000000000001", "A", "ak47", 10, 5, 80, 30, 1500)


# ---- fila pro ----

def test_listar_fila_pro_pendente():
    conn = FakeConn()
    conn.fila_rows = [("f1", "https://hltv.org/download/demo/123", None)]
    resultado = db.listar_fila_pro_pendente(conn)
    assert resultado == [("f1", "https://hltv.org/download/demo/123", None)]
    assert any("partidas_pro_fila" in c[0] and "pendente" in c[0] for c in conn.calls)


def test_atualizar_fila_pro_concluida():
    conn = FakeConn()
    db.atualizar_fila_pro(conn, "f1", "concluida", match_id="m1")
    update = next(c for c in conn.calls if c[0].startswith("update partidas_pro_fila"))
    assert update[1] == ("concluida", "m1", None, [], "f1")
    assert conn.commits == 1


def test_atualizar_fila_pro_com_match_ids():
    # Série Bo3/Bo5: vários mapas processados de um único item da fila.
    conn = FakeConn()
    db.atualizar_fila_pro(conn, "f1", "concluida", match_id="m1", match_ids=["m1", "m2", "m3"])
    update = next(c for c in conn.calls if c[0].startswith("update partidas_pro_fila"))
    assert update[1] == ("concluida", "m1", None, ["m1", "m2", "m3"], "f1")
    assert conn.commits == 1


# ---- uploads pendentes ----

def test_listar_uploads_pendentes_devolve_so_status_pendente():
    conn = FakeConn()
    conn.uploads_rows = [
        ("u1", "g1", "765", "uploads-pendentes/abc.dem", None, None),
    ]
    resultado = db.listar_uploads_pendentes(conn)
    assert resultado == [("u1", "g1", "765", "uploads-pendentes/abc.dem", None, None)]
    assert any("uploads_pendentes" in c[0] and "pendente" in c[0] for c in conn.calls)


def test_atualizar_upload_pendente_grava_status_match_id_e_erro():
    conn = FakeConn()
    db.atualizar_upload_pendente(conn, "u1", "concluido", match_id="m1")
    update = next(c for c in conn.calls if c[0].startswith("update uploads_pendentes"))
    assert update[1] == ("concluido", "m1", None, "u1")
    assert conn.commits == 1


def test_store_parsed_grava_lineups():
    conn = FakeConn()
    parsed = _parsed()
    parsed["lineups"] = [{
        "round_number": 5, "map": "de_mirage", "tipo": "smoke",
        "thrower_steam_id": "A", "thrower_nick": "bronze",
        "thrower_x": 100.0, "thrower_y": 200.0, "thrower_yaw": 45.0, "thrower_pitch": -10.0,
        "target_x": 300.0, "target_y": 400.0, "tick": 5000, "origem": "grupo", "lado": "T",
    }]
    db.store_parsed(conn, parsed, share_code="CSGO-x", source="upload")
    insert = next(c for c in conn.calls if c[0].startswith("insert into lineups"))
    assert insert[1] == (
        "00000000-0000-0000-0000-000000000001", 5, "de_mirage", "smoke",
        "A", "bronze", 100.0, 200.0, 45.0, -10.0, 300.0, 400.0, 5000, "grupo", "T",
    )


def test_store_parsed_grava_nome_de_time():
    conn = FakeConn()
    parsed = _parsed()
    parsed["team_a_name"] = "FaZe"
    parsed["team_b_name"] = "Vitality"
    db.store_parsed(conn, parsed, share_code="CSGO-x", source="pro")
    match_call = next(c for c in conn.calls if c[0].startswith("insert into matches"))
    assert "FaZe" in match_call[1]
    assert "Vitality" in match_call[1]


# ---- avatares ----

def test_upsert_avatares_grava_cada_um_e_commita():
    conn = FakeConn()
    db.upsert_avatares(conn, {"111": "https://x/1.jpg", "222": "https://x/2.jpg"})
    inserts = [c for c in conn.calls if c[0].startswith("insert into steam_avatares")]
    assert len(inserts) == 2
    assert inserts[0][1] == ("111", "https://x/1.jpg")
    assert conn.commits == 1


def test_upsert_avatares_mapa_vazio_nao_faz_nada():
    conn = FakeConn()
    db.upsert_avatares(conn, {})
    assert conn.calls == []
    assert conn.commits == 0


def test_listar_steam_ids_sem_avatar_fresco_filtra_os_ja_cacheados():
    conn = FakeConn()
    conn.avatares_frescos = ["111"]
    resultado = db.listar_steam_ids_sem_avatar_fresco(conn, ["111", "222", "333"])
    assert resultado == ["222", "333"]


def test_listar_steam_ids_sem_avatar_fresco_dedup_e_ignora_vazio():
    conn = FakeConn()
    resultado = db.listar_steam_ids_sem_avatar_fresco(conn, ["111", "111", None, ""])
    assert resultado == ["111"]


def test_listar_steam_ids_de_match_players_sem_avatar_fresco():
    conn = FakeConn()
    conn.match_players_sem_avatar = ["111", "222"]
    assert db.listar_steam_ids_de_match_players_sem_avatar_fresco(conn) == ["111", "222"]


def test_record_pending_match():
    conn = FakeConn()
    mid = db.record_pending_match(conn, "CSGO-novo", "grupo-1")
    assert mid == "00000000-0000-0000-0000-000000000001"
    assert conn.commits == 1
    assert conn.calls[0][1] == ("CSGO-novo", "valve_mm", "grupo-1")
    assert "played_at" in conn.calls[0][0] and "now()" in conn.calls[0][0]
    assert "group_id" in conn.calls[0][0]


def test_store_parsed_grava_group_id_na_partida_nova():
    conn = FakeConn()
    db.store_parsed(conn, _parsed(), share_code="CSGO-x", source="upload", group_id="grupo-1")
    match_call = next(c for c in conn.calls if c[0].startswith("insert into matches"))
    assert match_call[1][-1] == "grupo-1"


def test_grupo_para_ingest_usa_grupo_ativo_de_jogador_conhecido():
    conn = FakeConn()
    conn.grupo_ativo_row = ["grupo-do-jogador"]
    assert db.grupo_para_ingest(conn, ["765"]) == "grupo-do-jogador"


def test_grupo_para_ingest_cai_no_grupo_mais_antigo_sem_jogador_conhecido():
    conn = FakeConn()
    conn.grupo_ativo_row = None
    conn.grupo_mais_antigo_row = ["grupo-original"]
    assert db.grupo_para_ingest(conn, ["999"]) == "grupo-original"


def test_store_parsed_por_padrao_preserva_played_at_existente():
    conn = FakeConn()
    db.store_parsed(conn, _parsed(), share_code="CSGO-x")
    match_call = next(c for c in conn.calls if c[0].startswith("insert into matches"))
    assert "coalesce(matches.played_at, excluded.played_at)" in match_call[0]


def test_store_parsed_prefer_new_played_at_deixa_o_novo_vencer():
    conn = FakeConn()
    db.store_parsed(conn, _parsed(), share_code="CSGO-x", prefer_new_played_at=True)
    match_call = next(c for c in conn.calls if c[0].startswith("insert into matches"))
    assert "coalesce(excluded.played_at, matches.played_at)" in match_call[0]


def test_match_fingerprint_estavel_e_sensivel_ao_conteudo():
    fp1 = db.match_fingerprint(_parsed())
    fp2 = db.match_fingerprint(_parsed())
    assert fp1 == fp2  # mesma partida (mesmo por outro caminho) = mesma digital
    outra = _parsed()
    outra["players"][0]["kills"] = 21
    assert db.match_fingerprint(outra) != fp1  # partida diferente = digital diferente
    # ordem dos jogadores não importa
    dois = _parsed()
    dois["players"].append({"steam_id64": "B", "team": "B", "kills": 5, "deaths": 9})
    invertido = _parsed()
    invertido["players"] = list(reversed(dois["players"]))
    assert db.match_fingerprint(dois) == db.match_fingerprint(invertido)


def test_store_parsed_dedupe_por_fingerprint_atualiza_em_vez_de_inserir():
    existente = "11111111-1111-1111-1111-111111111111"
    conn = FakeConn(fingerprint_row=[existente])
    mid = db.store_parsed(conn, _parsed(), share_code="CSGO-x", source="valve_mm")
    assert mid == existente  # reaproveitou a linha da mesma partida
    sqls = [c[0] for c in conn.calls]
    assert not any(s.startswith("insert into matches") for s in sqls)
    assert any(s.startswith("update matches set share_code = coalesce") for s in sqls)
    # absorve o placeholder pending que segurava o share code
    assert any("status = 'pending'" in s and s.startswith("delete from matches") for s in sqls)
