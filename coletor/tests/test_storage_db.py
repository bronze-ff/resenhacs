import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import storage_r2, db


# ---- storage ----

class FakeS3:
    def __init__(self):
        self.puts = []

    def put_object(self, **kw):
        self.puts.append(kw)


def test_keys():
    assert storage_r2.demo_key(123) == "demos/123.dem.bz2"
    assert storage_r2.replay_key(123) == "replays/123.json"


def test_upload_bytes():
    s3 = FakeS3()
    key = storage_r2.upload_bytes(s3, "bucket", "demos/1.dem.bz2", b"abc")
    assert key == "demos/1.dem.bz2"
    assert s3.puts[0]["Bucket"] == "bucket"
    assert s3.puts[0]["Body"] == b"abc"


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
        return ["00000000-0000-0000-0000-000000000001"]


class FakeConn:
    def __init__(self, fingerprint_row=None):
        self.calls = []
        self.commits = 0
        self.fingerprint_row = fingerprint_row

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
             "rating": 1.2, "won": True},
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


def test_record_pending_match():
    conn = FakeConn()
    mid = db.record_pending_match(conn, "CSGO-novo")
    assert mid == "00000000-0000-0000-0000-000000000001"
    assert conn.commits == 1
    assert conn.calls[0][1] == ("CSGO-novo", "valve_mm")
    assert "played_at" in conn.calls[0][0] and "now()" in conn.calls[0][0]


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
