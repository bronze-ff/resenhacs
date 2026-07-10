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

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self.conn.calls.append((" ".join(sql.split()), params))

    def fetchone(self):
        return ["00000000-0000-0000-0000-000000000001"]


class FakeConn:
    def __init__(self):
        self.calls = []
        self.commits = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1


def _parsed():
    return {
        "map": "de_mirage",
        "score_a": 13,
        "score_b": 9,
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
