import bz2
import datetime
import gzip
import json
import subprocess
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import db as dbmod
from coletor import main, rar_extract
from coletor.config import Config


# ---- avatares ----

def test_atualizar_avatares_pula_sem_steam_api_key(monkeypatch):
    config = Config(env={})
    chamado = []
    monkeypatch.setattr(dbmod, "listar_steam_ids_sem_avatar_fresco", lambda *a, **k: chamado.append(1))
    main._atualizar_avatares(config, conn=None, steam_ids=["1"])
    assert chamado == []  # nem chegou a consultar o banco


def test_atualizar_avatares_busca_so_os_sem_cache_fresco(monkeypatch):
    config = Config(env={"STEAM_API_KEY": "KEY", "DATABASE_URL": "x"})
    monkeypatch.setattr(dbmod, "listar_steam_ids_sem_avatar_fresco", lambda conn, ids: ["222"])
    monkeypatch.setattr(main.steam_api, "buscar_avatares", lambda key, ids: {"222": "https://x/2.jpg"})
    gravados = {}
    monkeypatch.setattr(dbmod, "upsert_avatares", lambda conn, mapa: gravados.update(mapa))
    main._atualizar_avatares(config, conn=None, steam_ids=["111", "222"])
    assert gravados == {"222": "https://x/2.jpg"}


def test_atualizar_avatares_nao_derruba_em_erro_da_steam_api(monkeypatch, capsys):
    config = Config(env={"STEAM_API_KEY": "KEY", "DATABASE_URL": "x"})
    monkeypatch.setattr(dbmod, "listar_steam_ids_sem_avatar_fresco", lambda conn, ids: ["111"])

    def _explode(key, ids):
        raise RuntimeError("Steam fora do ar")

    monkeypatch.setattr(main.steam_api, "buscar_avatares", _explode)
    main._atualizar_avatares(config, conn=None, steam_ids=["111"])  # não deve lançar
    assert "avatares Steam não atualizados" in capsys.readouterr().out


def test_cmd_avatares_faz_backfill_dos_steam_ids_de_match_players(monkeypatch):
    config = Config(env={"STEAM_API_KEY": "KEY", "DATABASE_URL": "x"})
    monkeypatch.setattr(dbmod, "listar_steam_ids_de_match_players_sem_avatar_fresco", lambda conn: ["111", "222"])
    monkeypatch.setattr(main.steam_api, "buscar_avatares", lambda key, ids: {"111": "https://x/1.jpg"})
    gravados = {}
    monkeypatch.setattr(dbmod, "upsert_avatares", lambda conn, mapa: gravados.update(mapa))
    total = main.cmd_avatares(config, conn=None)
    assert total == 1
    assert gravados == {"111": "https://x/1.jpg"}


class _CleanupCursor:
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

    def fetchall(self):
        if self._last.startswith("select id, demo_url from matches"):
            return self.conn.rows
        return []


class _CleanupConn:
    def __init__(self, rows):
        self.calls = []
        self.commits = 0
        self.rollbacks = 0
        self.rows = rows

    def cursor(self):
        return _CleanupCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def _dias_ate_o_limite(params):
    limite = params[0]
    return (datetime.datetime.now(datetime.timezone.utc) - limite).total_seconds() / 86400


def test_cmd_cleanup_default_corta_em_14_dias(monkeypatch):
    assert main.RETENCAO_DEMO_DIAS == 14
    conn = _CleanupConn([])
    criado = []
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: criado.append(1))
    total = main.cmd_cleanup(_config_com_r2(), conn)
    assert total == 0
    assert criado == []
    sql, params = conn.calls[0]
    assert "demo_url is not null" in sql
    assert "greatest(played_at, created_at) <" in sql
    assert 13.9 < _dias_ate_o_limite(params) < 14.1


def test_cmd_cleanup_apaga_so_o_dem_bruto_e_zera_demo_url(monkeypatch):
    url = "https://acc.r2.cloudflarestorage.com/resenha-demos/demos/m1.dem.bz2"
    conn = _CleanupConn([("m1", url)])
    apagados = []
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "client")
    monkeypatch.setattr(
        main.storage_r2, "delete_object",
        lambda client, bucket, key: apagados.append((bucket, key)),
    )
    total = main.cmd_cleanup(_config_com_r2(), conn, days=14)
    assert total == 1
    assert apagados == [("resenha-demos", "demos/m1.dem.bz2")]
    updates = [c for c in conn.calls if c[0].startswith("update matches set demo_url")]
    assert updates == [("update matches set demo_url = null where id = %s", ("m1",))]
    assert conn.commits == 1
    assert not any("replay" in c[0] for c in conn.calls)


def test_cmd_cleanup_respeita_days_explicito():
    conn = _CleanupConn([])
    main.cmd_cleanup(_config_com_r2(), conn, days=90)
    assert 89.9 < _dias_ate_o_limite(conn.calls[0][1]) < 90.1


def test_cmd_cleanup_pula_url_fora_do_bucket(monkeypatch):
    conn = _CleanupConn([("m1", "https://outro/bucket/x.dem.bz2")])
    apagados = []
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "client")
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda *a, **k: apagados.append(a))
    total = main.cmd_cleanup(_config_com_r2(), conn, days=14)
    assert total == 0
    assert apagados == []
    assert not any(c[0].startswith("update") for c in conn.calls)


def test_cmd_avatares_sem_pendentes_nao_chama_steam_api(monkeypatch):
    config = Config(env={"STEAM_API_KEY": "KEY", "DATABASE_URL": "x"})
    monkeypatch.setattr(dbmod, "listar_steam_ids_de_match_players_sem_avatar_fresco", lambda conn: [])
    chamado = []
    monkeypatch.setattr(main.steam_api, "buscar_avatares", lambda key, ids: chamado.append(1))
    total = main.cmd_avatares(config, conn=None)
    assert total == 0
    assert chamado == []


def _rdata_com_lineups():
    return {
        "smokes": [
            {
                "round": 1, "x": 100.0, "y": 200.0, "tickStart": 1000, "tickEnd": 1500,
                "thrower": "A", "throwerX": -3230, "throwerY": 1713, "throwerYaw": 90.0, "throwerPitch": 0.0,
                "throwerZ": -167.96875, "z": -100.0, "throwerLado": "T",
            },
            # detonação sem fire correspondente (thrower setado, posição não) — deve
            # ser descartada, não gerar um dict com thrower_x/y = None.
            {
                "round": 2, "x": 50.0, "y": 60.0, "tickStart": 2000, "tickEnd": 2500,
                "thrower": "B", "throwerX": None, "throwerY": None, "throwerYaw": None, "throwerPitch": None,
                "throwerLado": None,
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


def test_montar_lineups_propaga_lado_do_arremessador():
    lineups = main._montar_lineups(_rdata_com_lineups(), None, "de_mirage", "upload")
    assert lineups[0]["lado"] == "T"


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


def test_montar_lineups_grava_coordenadas_de_mundo_pro_setpos():
    lineups = main._montar_lineups(_rdata_com_lineups(), None, "de_mirage", "upload")
    l = lineups[0]
    assert (l["thrower_world_x"], l["thrower_world_y"], l["thrower_world_z"]) == (-3230.0, 1713.0, -167.97)
    assert (l["target_world_x"], l["target_world_y"], l["target_world_z"]) == (100.0, 200.0, -100.0)


def test_montar_lineups_sem_z_deixa_none():
    rdata = _rdata_com_lineups()
    del rdata["smokes"][0]["throwerZ"]
    del rdata["smokes"][0]["z"]
    l = main._montar_lineups(rdata, None, "de_mirage", "upload")[0]
    assert l["thrower_world_z"] is None and l["target_world_z"] is None


def test_montar_lineups_pega_frame_do_replay_pela_ordem_no_round():
    rdata = _rdata_com_lineups()
    replay_json = {"names": {}, "rounds": [
        {"round": 1, "smokes": [{"x": 0.1, "y": 0.2, "tStart": 37, "tEnd": 90}]},
        {"round": 2, "smokes": [{"x": 0.1, "y": 0.2, "tStart": 5, "tEnd": 9}]},
    ]}
    l = main._montar_lineups(rdata, replay_json, "de_mirage", "upload")[0]
    assert l["replay_frame"] == 37


def test_montar_lineups_round_com_contagem_diferente_no_replay_nao_chuta_frame():
    rdata = _rdata_com_lineups()
    replay_json = {"names": {}, "rounds": [{"round": 1, "smokes": []}]}
    l = main._montar_lineups(rdata, replay_json, "de_mirage", "upload")[0]
    assert l["replay_frame"] is None


def test_montar_lineups_sem_replay_frame_fica_none():
    l = main._montar_lineups(_rdata_com_lineups(), None, "de_mirage", "upload")[0]
    assert l["replay_frame"] is None


# ---- upload do .dem arquivado no R2 (dívida técnica: subia sem comprimir) ----

def test_finalizar_ingest_comprime_o_dem_antes_de_subir_pro_r2(monkeypatch, tmp_path):
    monkeypatch.setattr(main.dbmod, "store_parsed", lambda conn, parsed, **kw: "m1")
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "demo_key", lambda match_id: "demos/m1.dem.bz2")
    uploads = []
    monkeypatch.setattr(
        main.storage_r2, "upload_bytes",
        lambda client, bucket, key, data, **kw: uploads.append((key, data)),
    )

    conteudo_original = b"conteudo cru do .dem, bem repetitivo pra comprimir bem" * 100
    dem_path = tmp_path / "match.dem"
    dem_path.write_bytes(conteudo_original)

    main._finalizar_ingest(
        _config_com_r2(), conn=None, parsed={"players": []}, replay_json=None,
        dem_path_upload=dem_path, share_code=None, source="upload", upload=True, played_at=None,
    )

    assert len(uploads) == 1
    key, bytes_enviados = uploads[0]
    assert key == "demos/m1.dem.bz2"
    # De verdade comprimido — não é mais o payload cru (a extensão .bz2 agora é honesta).
    assert bytes_enviados != conteudo_original
    assert bz2.decompress(bytes_enviados) == conteudo_original


# ---- cmd_reprocess: --since evita reprocessar o histórico inteiro ----

class _FakeCursorReprocess:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self.conn.ultima_query = " ".join(sql.split())
        self.conn.ultimos_params = params

    def fetchall(self):
        return []  # sem partidas: cmd_reprocess retorna cedo, não precisa mockar parser/R2


class _FakeConnReprocess:
    def __init__(self):
        self.ultima_query = ""
        self.ultimos_params = None

    def cursor(self):
        return _FakeCursorReprocess(self)


def test_cmd_reprocess_sem_since_reprocessa_tudo():
    conn = _FakeConnReprocess()
    main.cmd_reprocess(_config_com_r2(), conn)
    assert "played_at >=" not in conn.ultima_query
    assert conn.ultimos_params is None
    assert "order by reprocessed_at nulls first, id" in conn.ultima_query


def test_cmd_reprocess_com_since_filtra_por_played_at():
    conn = _FakeConnReprocess()
    main.cmd_reprocess(_config_com_r2(), conn, since="2026-07-16")
    assert "played_at >=" in conn.ultima_query
    assert conn.ultimos_params == ("2026-07-16",)
    assert "order by reprocessed_at nulls first, id" in conn.ultima_query


def test_cmd_reprocess_match_id_ignora_since():
    conn = _FakeConnReprocess()
    main.cmd_reprocess(_config_com_r2(), conn, match_id="m1", since="2026-07-16")
    assert "id = %s" in conn.ultima_query
    assert conn.ultimos_params == ("m1",)


class _ReprocessCursor:
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

    def fetchall(self):
        if self._last.startswith("select id, share_code, source, demo_url, replay_url, played_at from matches"):
            return self.conn.rows
        return []


class _ReprocessConn:
    def __init__(self, rows):
        self.calls = []
        self.commits = 0
        self.rollbacks = 0
        self.rows = rows

    def cursor(self):
        return _ReprocessCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_cmd_reprocess_marca_reprocessed_at_apos_sucesso(monkeypatch):
    # Uma Partida reprocessada com sucesso precisa ficar marcada — é o que permite a
    # PRÓXIMA rodada (ordenada por reprocessed_at nulls first) avançar em vez de
    # repetir a mesma Partida de novo (ver docstring de cmd_reprocess).
    conn = _ReprocessConn([
        ("m1", "SC1", "valve_mm", "https://r2/demos/m1.dem.bz2", "https://r2/replays/m1.json", None),
    ])
    config = _config_com_r2()

    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "key_from_url", lambda url, bucket: url.rsplit("/", 1)[-1])
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"dem-bytes")
    monkeypatch.setattr(main, "_descomprimir_dem_arquivado", lambda dados: b"dem-real")
    monkeypatch.setattr(
        main.parsemod, "parse_demo",
        lambda path: {"players": [], "kills": [], "rounds": [], "map": "de_dust2", "highlights": []},
    )
    monkeypatch.setattr(main.transform, "fill_kd_from_kills", lambda players, kills: players)
    monkeypatch.setattr(main.transform, "enrich", lambda parsed: parsed)
    monkeypatch.setattr(main.parsemod, "extract_replay", lambda path: {"ticks": [], "kills": [], "rounds": []})
    monkeypatch.setattr(main.replaymod, "build_replay", lambda *a, **kw: {"rounds": []})
    monkeypatch.setattr(main.transform, "attach_replay_frames", lambda highlights, rounds: highlights)
    monkeypatch.setattr(main, "_montar_lineups", lambda *a, **kw: [])
    monkeypatch.setattr(main, "_upload_replay", lambda *a, **kw: None)
    monkeypatch.setattr(main.dbmod, "store_parsed", lambda *a, **kw: "m1")

    total = main.cmd_reprocess(config, conn)

    assert total == 1
    update = next(c for c in conn.calls if c[0].startswith("update matches set reprocessed_at"))
    assert update[1] == ("m1",)


# ---- streaming por round do Replay 2D (FIL-54b) ----

def test_upload_replay_sobe_indice_sem_frames_e_um_objeto_por_round(monkeypatch):
    uploads = {}
    fake_client = object()

    def fake_upload_bytes(client, bucket, key, data, **kw):
        assert client is fake_client and bucket == "bucket"
        assert kw.get("content_type") == "application/json"
        assert kw.get("content_encoding") == "gzip"
        uploads[key] = json.loads(gzip.decompress(data).decode("utf-8"))

    monkeypatch.setattr(main.storage_r2, "upload_bytes", fake_upload_bytes)
    replay_json = {
        "map": "de_mirage", "calibrated": True, "tickRate": 8,
        "names": {}, "teams": {},
        "rounds": [
            {"round": 1, "frames": [{"t": 0, "players": []}], "kills": [], "clutch": None},
            {"round": 2, "frames": [{"t": 0, "players": []}, {"t": 1, "players": []}], "kills": [], "clutch": None},
        ],
    }
    main._upload_replay(fake_client, "bucket", "replays/abc.json", replay_json)

    assert set(uploads.keys()) == {"replays/abc.json", "replays/abc/round-1.json", "replays/abc/round-2.json"}
    indice = uploads["replays/abc.json"]
    assert "frames" not in indice["rounds"][0]
    assert indice["rounds"][0]["frameCount"] == 1
    assert indice["rounds"][1]["frameCount"] == 2
    assert uploads["replays/abc/round-1.json"]["frames"] == [{"t": 0, "players": []}]


# ---- reprocessamento: descomprime o .dem lido do R2 ----

def test_descomprimir_dem_arquivado_stream_bz2_valido():
    conteudo = b"conteudo original" * 50
    comprimido = bz2.compress(conteudo)
    assert main._descomprimir_dem_arquivado(comprimido) == conteudo


def test_descomprimir_dem_arquivado_compat_com_arquivo_antigo_nao_comprimido():
    # Partidas arquivadas ANTES do fix: a chave diz .dem.bz2 mas o conteúdo é cru.
    conteudo_cru = b"DEMO_CS2\x00isto nao e um stream bz2 valido"
    assert main._descomprimir_dem_arquivado(conteudo_cru) == conteudo_cru


# ---- cmd_processar_fila_pro ----


class _FilaCursor:
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

    def fetchall(self):
        if self._last.startswith("select id, hltv_url, arquivo_r2_key, adicionado_em from partidas_pro_fila"):
            return self.conn.fila_rows
        return []


class _FilaConn:
    def __init__(self, fila_rows):
        self.calls = []
        self.commits = 0
        self.rollbacks = 0
        self.fila_rows = fila_rows

    def cursor(self):
        return _FilaCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def _config_com_r2():
    return Config({
        "R2_ACCOUNT_ID": "acc", "R2_ACCESS_KEY_ID": "id",
        "R2_SECRET_ACCESS_KEY": "secret", "R2_BUCKET": "resenha-demos",
    })


def test_processar_fila_pro_com_arquivo_r2_key_baixa_do_r2_e_nao_chama_urlopen(monkeypatch):
    conn = _FilaConn([("f1", None, "partidas-pro-pendentes/abc.dem", None)])
    config = _config_com_r2()

    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    downloads = []
    monkeypatch.setattr(
        main.storage_r2, "download_bytes",
        lambda client, bucket, key, **kw: (downloads.append((client, bucket, key)), b"dem-bytes")[1],
    )
    deletes = []
    monkeypatch.setattr(
        main.storage_r2, "delete_object",
        lambda client, bucket, key: deletes.append((bucket, key)),
    )

    def _urlopen_nao_deveria_ser_chamado(*a, **kw):
        raise AssertionError("urlopen não deveria ser chamado quando vem de arquivo_r2_key")

    monkeypatch.setattr(main.rede, "abrir_url", _urlopen_nao_deveria_ser_chamado)

    def _rar_extract_nao_deveria_ser_chamado(*a, **kw):
        raise AssertionError(".dem direto não deveria passar pelo rar_extract")

    monkeypatch.setattr(rar_extract, "extrair_dems_de_rar", _rar_extract_nao_deveria_ser_chamado)

    ingests = []

    def _ingest_fake(cfg, cn, dem_path, source=None, upload=None, **kw):
        ingests.append((dem_path.name, source, upload))
        return "m1"

    monkeypatch.setattr(main, "ingest_demo", _ingest_fake)

    total = main.cmd_processar_fila_pro(config, conn)

    assert total == 1
    assert downloads == [("fake-client", "resenha-demos", "partidas-pro-pendentes/abc.dem")]
    assert ingests == [("demo.dem", "pro", True)]
    # sucesso -> staging apagado do R2
    assert deletes == [("resenha-demos", "partidas-pro-pendentes/abc.dem")]
    update = next(c for c in conn.calls if c[0].startswith("update partidas_pro_fila") and c[1][0] == "concluida")
    assert update[1][1] == "m1"


def test_processar_fila_pro_mantem_staging_no_r2_quando_falha(monkeypatch):
    conn = _FilaConn([("f1", None, "partidas-pro-pendentes/abc.dem", None)])
    config = _config_com_r2()

    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"dem-bytes")
    deletes = []
    monkeypatch.setattr(
        main.storage_r2, "delete_object",
        lambda client, bucket, key: deletes.append((bucket, key)),
    )

    def _ingest_falha(cfg, cn, dem_path, source=None, upload=None, **kw):
        raise RuntimeError("parser explodiu")

    monkeypatch.setattr(main, "ingest_demo", _ingest_falha)

    total = main.cmd_processar_fila_pro(config, conn)

    assert total == 0
    assert deletes == []  # falha -> mantém o arquivo pro retry reaproveitar
    update = next(c for c in conn.calls if c[0].startswith("update partidas_pro_fila") and c[1][0] == "falhou")
    assert "parser explodiu" in update[1][2]


def test_processar_fila_pro_ainda_suporta_hltv_url_via_urlopen(monkeypatch):
    conn = _FilaConn([("f1", "https://hltv.org/download/demo/999", None, None)])
    config = _config_com_r2()

    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")

    class _FakeResp:
        # read(n) chunked (a leitura real de _baixar_com_teto pede em pedaços de 1MB
        # até vir vazio) — devolve o conteúdo inteiro na 1a chamada, depois b"" sempre.
        def __init__(self, dados):
            self._dados = dados
            self._lido = False

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self, n=-1):
            if self._lido:
                return b""
            self._lido = True
            return self._dados

    urls_abertos = []

    dominios_pedidos = []

    def _urlopen_fake(url, timeout=None, dominios=None):
        urls_abertos.append(url)
        dominios_pedidos.append(dominios)
        return _FakeResp(b"rar-bytes")

    monkeypatch.setattr(main.rede, "abrir_url", _urlopen_fake)

    dem_paths_devolvidos = []

    def _rar_extract_fake(rar_path, destino):
        dem_paths_devolvidos.append(rar_path)
        p = destino
        p.mkdir(parents=True, exist_ok=True)
        dem = p / "mapa1.dem"
        dem.write_bytes(b"x")
        return [dem]

    monkeypatch.setattr(rar_extract, "extrair_dems_de_rar", _rar_extract_fake)
    monkeypatch.setattr(main, "ingest_demo", lambda cfg, cn, dem_path, source=None, upload=None, **kw: "m2")
    deletes = []
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: deletes.append(key))

    total = main.cmd_processar_fila_pro(config, conn)

    assert total == 1
    assert urls_abertos == ["https://hltv.org/download/demo/999"]
    assert dominios_pedidos == [("hltv.org",)]
    assert deletes == []  # não veio de arquivo_r2_key -> nada pra apagar do R2


def test_processar_fila_pro_funde_partes_adjacentes_do_mesmo_mapa_num_so_match_id(monkeypatch):
    # reinício técnico no meio do mapa 1 (anubis) -> HLTV distribui como -p1/-p2
    # ADJACENTES no .rar; mapa 2 (inferno) é um .dem normal, grupo de 1. Devem sair
    # 2 match_ids (1 pra série anubis fundida + 1 pra inferno), não 3.
    conn = _FilaConn([("f1", "https://hltv.org/download/demo/999", None, None)])
    config = _config_com_r2()

    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")

    class _FakeResp:
        # read(n) chunked — ver comentário equivalente no teste anterior.
        def __init__(self, dados):
            self._dados = dados
            self._lido = False

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self, n=-1):
            if self._lido:
                return b""
            self._lido = True
            return self._dados

    monkeypatch.setattr(main.rede, "abrir_url", lambda url, timeout=None, dominios=None: _FakeResp(b"rar-bytes"))

    def _rar_extract_fake(rar_path, destino):
        destino.mkdir(parents=True, exist_ok=True)
        nomes = [
            "falcons-vs-vitality-m1-anubis-p1.dem",
            "falcons-vs-vitality-m1-anubis-p2.dem",
            "falcons-vs-vitality-m2-inferno.dem",
        ]
        caminhos = []
        for nome in nomes:
            dem = destino / nome
            dem.write_bytes(b"x")
            caminhos.append(dem)
        return caminhos

    monkeypatch.setattr(rar_extract, "extrair_dems_de_rar", _rar_extract_fake)
    monkeypatch.setattr(
        main.parsemod, "cabecalho_mapa",
        lambda path: "de_anubis" if "anubis" in path.name else "de_inferno",
    )

    chamadas_single, chamadas_multi = [], []
    monkeypatch.setattr(
        main, "ingest_demo",
        lambda cfg, cn, dem_path, source=None, upload=None, **kw: (
            chamadas_single.append(dem_path.name) or "m-inferno"
        ),
    )
    monkeypatch.setattr(
        main, "ingest_demo_multiparte",
        lambda cfg, cn, dem_paths, source=None, upload=None, **kw: (
            chamadas_multi.append([p.name for p in dem_paths]) or "m-anubis-fundido"
        ),
    )
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: None)

    total = main.cmd_processar_fila_pro(config, conn)

    assert total == 1
    assert chamadas_single == ["falcons-vs-vitality-m2-inferno.dem"]
    assert chamadas_multi == [
        ["falcons-vs-vitality-m1-anubis-p1.dem", "falcons-vs-vitality-m1-anubis-p2.dem"]
    ]
    update = next(c for c in conn.calls if c[0].startswith("update partidas_pro_fila") and c[1][0] == "concluida")
    match_ids = update[1][3]
    assert match_ids == ["m-anubis-fundido", "m-inferno"]
    assert len(match_ids) == 2


# ---- cmd_processar_uploads_pendentes ----


class _UploadsCursor:
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

    def fetchall(self):
        if self._last.startswith(
            "select id, adicionado_por, arquivo_r2_key, share_code, played_at, "
            "plataforma_manual, match_alvo_id, adicionado_em, origem_url from uploads_pendentes"
        ):
            return self.conn.upload_rows
        return []

    def fetchone(self):
        # falhar_upload_pendente: "returning status" de quem ainda tem tentativa.
        return ("pendente",)


class _UploadsConn:
    def __init__(self, upload_rows):
        self.calls = []
        self.commits = 0
        self.rollbacks = 0
        self.upload_rows = upload_rows

    def cursor(self):
        return _UploadsCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_processar_uploads_pendentes_baixa_do_r2_e_apaga_em_sucesso(monkeypatch):
    conn = _UploadsConn([("u1", "765", "uploads-pendentes/abc.dem", None, None, "gamers_club", None, None)])
    config = _config_com_r2()

    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    downloads = []
    monkeypatch.setattr(
        main.storage_r2, "download_bytes",
        lambda client, bucket, key, **kw: (downloads.append((client, bucket, key, kw.get("max_bytes"))), b"dem-bytes")[1],
    )
    deletes = []
    monkeypatch.setattr(
        main.storage_r2, "delete_object",
        lambda client, bucket, key: deletes.append((bucket, key)),
    )
    ingests = []

    def _ingest_fake(cfg, cn, dem_path, share_code=None, source=None, upload=None, played_at=None,
                     plataforma_manual=None, alvo=None, enviado_por=None):
        ingests.append((dem_path.name, source, upload, plataforma_manual))
        return "m1"

    monkeypatch.setattr(main, "ingest_demo", _ingest_fake)

    total = main.cmd_processar_uploads_pendentes(config, conn)

    assert total == 1
    # finding #2: o download passa o teto de tamanho (checado via HEAD antes de baixar).
    assert downloads == [("fake-client", "resenha-demos", "uploads-pendentes/abc.dem", main._MAX_UPLOAD_BYTES)]
    assert ingests == [("demo.dem", "upload", True, "gamers_club")]
    assert deletes == [("resenha-demos", "uploads-pendentes/abc.dem")]
    update = next(c for c in conn.calls if c[0].startswith("update uploads_pendentes") and c[1][0] == "concluido")
    assert update[1][1] == "m1"


def test_processar_uploads_pendentes_mantem_staging_no_r2_quando_falha(monkeypatch):
    conn = _UploadsConn([("u1", "765", "uploads-pendentes/abc.dem", None, None, None, None, None)])
    config = _config_com_r2()

    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"dem-bytes")
    deletes = []
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: deletes.append((bucket, key)))

    def _ingest(*a, **kw):
        raise RuntimeError("parser explodiu")

    monkeypatch.setattr(main, "ingest_demo", _ingest)

    total = main.cmd_processar_uploads_pendentes(config, conn)

    assert total == 0
    assert deletes == []
    # Erro transitório: volta pra fila contando tentativa (R06), não 'falhou' direto.
    update = next(c for c in conn.calls if c[0].endswith("returning status"))
    assert update[1] == (main._MAX_TENTATIVAS_UPLOAD, "parser explodiu", main._MAX_TENTATIVAS_UPLOAD, "u1")


# ---- finding #2 da auditoria: teto de tamanho barra download de upload gigante ----

def test_processar_uploads_pendentes_marca_falhou_quando_objeto_excede_o_teto(monkeypatch):
    conn = _UploadsConn([("u1", "765", "uploads-pendentes/abc.dem", None, None, None, None, None)])
    config = _config_com_r2()

    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")

    def _download_grande_demais(client, bucket, key, **kw):
        raise main.storage_r2.ArquivoGrandeDemaisError("objeto grande demais")

    monkeypatch.setattr(main.storage_r2, "download_bytes", _download_grande_demais)
    ingest_chamado = []
    monkeypatch.setattr(main, "ingest_demo", lambda *a, **kw: ingest_chamado.append(1))

    total = main.cmd_processar_uploads_pendentes(config, conn)

    assert total == 0
    assert ingest_chamado == []  # nem chegou a tentar parsear
    update = next(c for c in conn.calls if c[0].startswith("update uploads_pendentes") and c[1][0] == "falhou")
    assert "grande demais" in update[1][2]


# ---- finding #8 da auditoria: reverte uploads travados em 'processando' antes de listar ----

def test_processar_uploads_pendentes_reverte_travados_antes_de_listar(monkeypatch):
    conn = _UploadsConn([])
    config = _config_com_r2()
    ordem = []
    monkeypatch.setattr(
        main.dbmod, "reverter_uploads_travados",
        lambda c, **kw: ordem.append("reverter") or ["u-travado"],
    )
    monkeypatch.setattr(main.dbmod, "listar_uploads_pendentes", lambda c: ordem.append("listar") or [])

    total = main.cmd_processar_uploads_pendentes(config, conn)

    assert total == 0
    assert ordem == ["reverter", "listar"]


def test_processar_uploads_pendentes_passa_o_teto_de_tempo_configurado(monkeypatch):
    conn = _UploadsConn([])
    config = _config_com_r2()
    chamadas = []
    monkeypatch.setattr(
        main.dbmod, "reverter_uploads_travados",
        lambda c, **kw: chamadas.append(kw) or [],
    )
    monkeypatch.setattr(main.dbmod, "listar_uploads_pendentes", lambda c: [])

    main.cmd_processar_uploads_pendentes(config, conn)

    assert chamadas == [{"minutos": main._TIMEOUT_PROCESSANDO_MINUTOS}]


# ---- envio amarrado a uma Partida: valida mapa + roster antes de gravar ----

def _alvo(mapa="de_inferno", ids=("A", "B"), score_a=None, score_b=None):
    return {
        "match_id": "m-alvo", "map": mapa, "steam_ids": set(ids),
        "score_a": score_a, "score_b": score_b,
    }


def test_validar_demo_contra_alvo_aceita_mapa_e_roster_iguais():
    parsed = {"map": "de_inferno", "players": [{"steam_id64": "A"}, {"steam_id64": "B"}]}
    main._validar_demo_contra_alvo(parsed, _alvo())  # não levanta


def test_validar_demo_contra_alvo_recusa_mapa_diferente():
    parsed = {"map": "de_mirage", "players": [{"steam_id64": "A"}, {"steam_id64": "B"}]}
    with pytest.raises(main.DemoNaoConfereError, match="mapa"):
        main._validar_demo_contra_alvo(parsed, _alvo())


def test_validar_demo_contra_alvo_recusa_roster_diferente():
    parsed = {"map": "de_inferno", "players": [{"steam_id64": "A"}, {"steam_id64": "Z"}]}
    with pytest.raises(main.DemoNaoConfereError, match="jogadores"):
        main._validar_demo_contra_alvo(parsed, _alvo())


def test_validar_demo_contra_alvo_pula_o_portao_de_mapa_quando_a_partida_alvo_nao_tem_mapa():
    # Caminho stats-only da FACEIT (faceit.montar_parsed_stats_only) grava
    # matches.map = "" quando a API não devolve o mapa — sem esse skip, a Partida
    # nunca poderia ser enriquecida (recusaria toda demo, qualquer que fosse o
    # mapa). O roster (os 10 steam ids) já é prova suficiente.
    parsed = {"map": "de_dust2", "players": [{"steam_id64": "A"}, {"steam_id64": "B"}]}
    main._validar_demo_contra_alvo(parsed, _alvo(mapa=""))  # não levanta


def test_validar_demo_contra_alvo_com_mapa_vazio_ainda_recusa_roster_diferente():
    # O skip é só do portão de MAPA — o roster continua obrigatório.
    parsed = {"map": "de_dust2", "players": [{"steam_id64": "A"}, {"steam_id64": "Z"}]}
    with pytest.raises(main.DemoNaoConfereError, match="jogadores"):
        main._validar_demo_contra_alvo(parsed, _alvo(mapa=""))


# ---- terceira checagem: placar (fecha o buraco de 2 partidas do mesmo lobby/mapa/noite) ----

def test_validar_demo_contra_alvo_aceita_placar_igual():
    parsed = {
        "map": "de_inferno", "score_a": 13, "score_b": 7,
        "players": [{"steam_id64": "A"}, {"steam_id64": "B"}],
    }
    main._validar_demo_contra_alvo(parsed, _alvo(score_a=13, score_b=7))  # não levanta


def test_validar_demo_contra_alvo_aceita_placar_igual_com_lados_invertidos():
    # ESTE é o teste que impede alguém de "consertar" pra comparação posicional
    # depois: no caminho stats-only da FACEIT (faceit.montar_parsed_stats_only),
    # o time A é a faction1 da API e o B a faction2, mas o parser atribui A/B
    # pela lógica dele a partir da demo — sem garantia de que os dois lados
    # cheguem à mesma atribuição. score_a==score_a and score_b==score_b
    # recusaria essa demo legítima só porque os lados vieram trocados.
    parsed = {
        "map": "de_inferno", "score_a": 7, "score_b": 13,
        "players": [{"steam_id64": "A"}, {"steam_id64": "B"}],
    }
    main._validar_demo_contra_alvo(parsed, _alvo(score_a=13, score_b=7))  # não levanta


def test_validar_demo_contra_alvo_recusa_placar_diferente():
    parsed = {
        "map": "de_inferno", "score_a": 13, "score_b": 11,
        "players": [{"steam_id64": "A"}, {"steam_id64": "B"}],
    }
    with pytest.raises(main.DemoNaoConfereError, match="placar"):
        main._validar_demo_contra_alvo(parsed, _alvo(score_a=13, score_b=7))


def test_validar_demo_contra_alvo_pula_a_checagem_de_placar_quando_a_partida_alvo_nao_tem():
    # Mesma razão do skip de mapa vazio: dado ausente não pode virar bloqueio
    # permanente. score_a/score_b da Partida alvo em None (qualquer um dos dois)
    # deixa passar, qualquer que seja o placar da demo.
    parsed = {
        "map": "de_inferno", "score_a": 16, "score_b": 2,
        "players": [{"steam_id64": "A"}, {"steam_id64": "B"}],
    }
    main._validar_demo_contra_alvo(parsed, _alvo(score_a=None, score_b=None))  # não levanta


def _fake_parsed(mapa, steam_ids):
    return {
        "map": mapa,
        "players": [{"steam_id64": sid} for sid in steam_ids],
        "kills": [], "rounds": [], "highlights": [],
    }


def test_ingest_demo_com_alvo_que_nao_bate_nao_chama_extract_replay(monkeypatch, tmp_path):
    # A validação (_validar_demo_contra_alvo) precisa rodar DEPOIS de transform.enrich
    # e ANTES de parsemod.extract_replay — o Replay 2D é a parte cara do pipeline e não
    # deve ser gasta numa demo que vai ser recusada. Um teste que só chama o helper
    # isolado (test_validar_demo_contra_alvo_*) não pega uma regressão de POSIÇÃO —
    # por isso este chama ingest_demo de verdade.
    dem_path = tmp_path / "demo.dem"
    dem_path.write_bytes(b"fake-demo-bytes")
    config = _config_com_r2()

    monkeypatch.setattr(main.parsemod, "parse_demo", lambda path: _fake_parsed("de_dust2", ["Z"]))
    monkeypatch.setattr(main.transform, "fill_kd_from_kills", lambda players, kills: players)
    monkeypatch.setattr(main.transform, "enrich", lambda parsed: parsed)
    chamadas_extract = []
    monkeypatch.setattr(
        main.parsemod, "extract_replay",
        lambda path: chamadas_extract.append(path) or {"ticks": [], "kills": [], "rounds": []},
    )

    alvo = {"match_id": "m-alvo", "map": "de_inferno", "steam_ids": {"A", "B"}}

    with pytest.raises(main.DemoNaoConfereError):
        main.ingest_demo(config, conn=None, path=dem_path, alvo=alvo)

    assert chamadas_extract == []  # Replay 2D não foi gasto numa demo recusada


def test_ingest_demo_com_alvo_que_bate_grava_no_match_id_alvo(monkeypatch, tmp_path):
    dem_path = tmp_path / "demo.dem"
    dem_path.write_bytes(b"fake-demo-bytes")
    config = _config_com_r2()

    monkeypatch.setattr(main.parsemod, "parse_demo", lambda path: _fake_parsed("de_inferno", ["A", "B"]))
    monkeypatch.setattr(main.transform, "fill_kd_from_kills", lambda players, kills: players)
    monkeypatch.setattr(main.transform, "enrich", lambda parsed: parsed)
    monkeypatch.setattr(main.parsemod, "extract_replay", lambda path: {"ticks": [], "kills": [], "rounds": []})
    monkeypatch.setattr(main.replaymod, "build_replay", lambda *a, **kw: {"rounds": []})
    monkeypatch.setattr(main.transform, "attach_replay_frames", lambda highlights, rounds: highlights)
    monkeypatch.setattr(main, "_montar_lineups", lambda *a, **kw: [])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "demo_key", lambda match_id: "demos/x.dem.bz2")
    monkeypatch.setattr(main.storage_r2, "upload_bytes", lambda *a, **kw: None)
    monkeypatch.setattr(main, "_upload_replay", lambda *a, **kw: None)

    gravados = {}

    def _store_parsed(conn, parsed, **kw):
        gravados.update(kw)
        return "m-alvo"

    monkeypatch.setattr(main.dbmod, "store_parsed", _store_parsed)

    alvo = {"match_id": "m-alvo", "map": "de_inferno", "steam_ids": {"A", "B"}}
    match_id = main.ingest_demo(config, conn=None, path=dem_path, alvo=alvo)

    assert match_id == "m-alvo"
    # Hoje nada verificava que a Demo é gravada NAQUELA linha (match_id_alvo) —
    # sem isso, um envio amarrado a uma Partida podia cair na dedupe por fingerprint.
    assert gravados["match_id_alvo"] == "m-alvo"


class _ViolacaoUnicaFake(Exception):
    """Imita psycopg.errors.UniqueViolation carregando `sqlstate`, sem precisar
    importar psycopg de verdade — o pacote não está em dev-requirements.txt
    (só o necessário pra rodar os testes no CI) e um import de topo quebraria
    a coleta do pytest com ModuleNotFoundError."""

    sqlstate = "23505"


def test_ingest_demo_com_fingerprint_ja_usado_por_outra_partida_vira_falha_definitiva(monkeypatch, tmp_path):
    # Cenário real (recorrente, ver spec): a mesma demo já foi enviada antes pela
    # página genérica "Enviar Demo" e criou uma Partida duplicada carregando esse
    # fingerprint. Enriquecer a linha da Partida alvo com essa mesma demo colide
    # no índice único de matches.fingerprint (23505/UniqueViolation) — isso não
    # pode cair no except Exception genérico do chamador (banner com a mensagem
    # crua do psycopg + arquivo de 300MB preso no R2 pra sempre); precisa virar
    # DemoNaoConfereError, a mesma falha DEFINITIVA que já apaga o staging.
    dem_path = tmp_path / "demo.dem"
    dem_path.write_bytes(b"fake-demo-bytes")
    config = _config_com_r2()

    monkeypatch.setattr(main.parsemod, "parse_demo", lambda path: _fake_parsed("de_inferno", ["A", "B"]))
    monkeypatch.setattr(main.transform, "fill_kd_from_kills", lambda players, kills: players)
    monkeypatch.setattr(main.transform, "enrich", lambda parsed: parsed)
    monkeypatch.setattr(main.parsemod, "extract_replay", lambda path: {"ticks": [], "kills": [], "rounds": []})
    monkeypatch.setattr(main.replaymod, "build_replay", lambda *a, **kw: {"rounds": []})
    monkeypatch.setattr(main.transform, "attach_replay_frames", lambda highlights, rounds: highlights)
    monkeypatch.setattr(main, "_montar_lineups", lambda *a, **kw: [])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "demo_key", lambda match_id: "demos/x.dem.bz2")
    monkeypatch.setattr(main.storage_r2, "upload_bytes", lambda *a, **kw: None)
    monkeypatch.setattr(main, "_upload_replay", lambda *a, **kw: None)

    def _store_parsed_colide(conn, parsed, **kw):
        raise _ViolacaoUnicaFake(
            'duplicate key value violates unique constraint "idx_matches_fingerprint"'
        )

    monkeypatch.setattr(main.dbmod, "store_parsed", _store_parsed_colide)

    alvo = {"match_id": "m-alvo", "map": "de_inferno", "steam_ids": {"A", "B"}}
    with pytest.raises(main.DemoNaoConfereError, match="já foi processada em outra partida"):
        main.ingest_demo(config, conn=None, path=dem_path, alvo=alvo)


def test_ingest_demo_sem_alvo_com_colisao_de_fingerprint_permanece_transitoria(monkeypatch, tmp_path):
    # MINOR (achado #2): fora do fluxo com alvo (cmd_fetch, processar-fila-pro,
    # envio genérico "Enviar Demo"), uma colisão de fingerprint só é possível
    # numa corrida entre execuções concorrentes — falha TRANSITÓRIA, que deve
    # preservar o .dem de 300MB no R2 pro retry. Convertê-la em
    # DemoNaoConfereError (falha DEFINITIVA) apagaria o staging à toa.
    dem_path = tmp_path / "demo.dem"
    dem_path.write_bytes(b"fake-demo-bytes")
    config = _config_com_r2()

    monkeypatch.setattr(main.parsemod, "parse_demo", lambda path: _fake_parsed("de_inferno", ["A", "B"]))
    monkeypatch.setattr(main.transform, "fill_kd_from_kills", lambda players, kills: players)
    monkeypatch.setattr(main.transform, "enrich", lambda parsed: parsed)
    monkeypatch.setattr(main.parsemod, "extract_replay", lambda path: {"ticks": [], "kills": [], "rounds": []})
    monkeypatch.setattr(main.replaymod, "build_replay", lambda *a, **kw: {"rounds": []})
    monkeypatch.setattr(main.transform, "attach_replay_frames", lambda highlights, rounds: highlights)
    monkeypatch.setattr(main, "_montar_lineups", lambda *a, **kw: [])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "demo_key", lambda match_id: "demos/x.dem.bz2")
    monkeypatch.setattr(main.storage_r2, "upload_bytes", lambda *a, **kw: None)
    monkeypatch.setattr(main, "_upload_replay", lambda *a, **kw: None)

    def _store_parsed_colide(conn, parsed, **kw):
        raise _ViolacaoUnicaFake(
            'duplicate key value violates unique constraint "idx_matches_fingerprint"'
        )

    monkeypatch.setattr(main.dbmod, "store_parsed", _store_parsed_colide)

    with pytest.raises(_ViolacaoUnicaFake):
        main.ingest_demo(config, conn=None, path=dem_path, alvo=None)


def test_processar_uploads_pendentes_com_alvo_passa_o_alvo_pro_ingest(monkeypatch):
    conn = _UploadsConn([("u1", "765", "uploads-pendentes/abc.dem", None, None, None, "m-alvo", None)])
    config = _config_com_r2()
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"dem-bytes")
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: None)
    monkeypatch.setattr(
        main.dbmod, "dados_da_partida_alvo",
        lambda c, mid: {
            "map": "de_inferno", "steam_ids": {"A", "B"}, "source": "faceit",
            "score_a": 13, "score_b": 7,
        },
    )
    recebidos = []

    def _ingest_fake(cfg, cn, dem_path, alvo=None, **kw):
        recebidos.append(alvo)
        return "m-alvo"

    monkeypatch.setattr(main, "ingest_demo", _ingest_fake)

    total = main.cmd_processar_uploads_pendentes(config, conn)

    assert total == 1
    assert recebidos == [{
        "match_id": "m-alvo", "map": "de_inferno", "steam_ids": {"A", "B"},
        "score_a": 13, "score_b": 7,
    }]


def test_processar_uploads_pendentes_com_alvo_mantem_o_source_original(monkeypatch):
    # CRITICAL: enriquecer uma Partida FACEIT com a demo enviada não pode virar
    # source='upload' — senão o badge de plataforma some, origemPartida vira
    # "MANUAL" e a competição marca o clipe como origem não verificada (ver spec,
    # seção 5). Antes desta correção, cmd_processar_uploads_pendentes sempre
    # chamava ingest_demo com source="upload" fixo, mesmo com alvo presente.
    conn = _UploadsConn([("u1", "765", "uploads-pendentes/abc.dem", None, None, None, "m-alvo", None)])
    config = _config_com_r2()
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"dem-bytes")
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: None)
    monkeypatch.setattr(
        main.dbmod, "dados_da_partida_alvo",
        lambda c, mid: {
            "map": "de_inferno", "steam_ids": {"A", "B"}, "source": "faceit",
            "score_a": 13, "score_b": 7,
        },
    )
    recebidos = []

    def _ingest_fake(cfg, cn, dem_path, source=None, alvo=None, **kw):
        recebidos.append(source)
        return "m-alvo"

    monkeypatch.setattr(main, "ingest_demo", _ingest_fake)

    main.cmd_processar_uploads_pendentes(config, conn)

    assert recebidos == ["faceit"]


def test_processar_uploads_pendentes_sem_alvo_continua_usando_upload(monkeypatch):
    # Regressão: o envio genérico (sem match_alvo_id) não muda de comportamento.
    conn = _UploadsConn([("u1", "765", "uploads-pendentes/abc.dem", None, None, None, None, None)])
    config = _config_com_r2()
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"dem-bytes")
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: None)
    dados_da_partida_alvo_chamado = []
    monkeypatch.setattr(
        main.dbmod, "dados_da_partida_alvo",
        lambda c, mid: dados_da_partida_alvo_chamado.append(mid),
    )
    recebidos = []

    def _ingest_fake(cfg, cn, dem_path, source=None, alvo=None, **kw):
        recebidos.append((source, alvo))
        return "m1"

    monkeypatch.setattr(main, "ingest_demo", _ingest_fake)

    main.cmd_processar_uploads_pendentes(config, conn)

    assert dados_da_partida_alvo_chamado == []
    assert recebidos == [("upload", None)]


def test_processar_uploads_pendentes_demo_que_nao_confere_falha_e_apaga_do_r2(monkeypatch):
    # Demo errada não fica certa na segunda tentativa — diferente da falha
    # transitória (rede/parser), que mantém o staging pro retry.
    conn = _UploadsConn([("u1", "765", "uploads-pendentes/abc.dem", None, None, None, "m-alvo", None)])
    config = _config_com_r2()
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"dem-bytes")
    deletes = []
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: deletes.append(key))
    monkeypatch.setattr(
        main.dbmod, "dados_da_partida_alvo",
        lambda c, mid: {
            "map": "de_inferno", "steam_ids": {"A", "B"}, "source": "faceit",
            "score_a": 13, "score_b": 7,
        },
    )
    monkeypatch.setattr(
        main, "ingest_demo",
        lambda *a, **kw: (_ for _ in ()).throw(main.DemoNaoConfereError("o mapa da demo não confere")),
    )

    total = main.cmd_processar_uploads_pendentes(config, conn)

    assert total == 0
    assert deletes == ["uploads-pendentes/abc.dem"]
    update = next(c for c in conn.calls if c[0].startswith("update uploads_pendentes") and c[1][0] == "falhou")
    assert "mapa" in update[1][2]


# ---- cmd_sincronizar_faceit: ver tests/test_faceit_sync.py ----


# ---- _baixar_e_descomprimir (dívida técnica: download truncado passava em silêncio) ----

class _FakeResp:
    """Simula http.client.HTTPResponse: leitura em chunks + headers.get('Content-Length')."""

    def __init__(self, data, content_length=None):
        self._data = data
        self._pos = 0
        self.headers = {} if content_length is None else {"Content-Length": str(content_length)}

    def read(self, n=-1):
        if self._pos >= len(self._data):
            return b""
        fim = len(self._data) if n == -1 else self._pos + n
        chunk = self._data[self._pos:fim]
        self._pos = fim
        return chunk

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _patch_urlopen(monkeypatch, fake_resp):
    monkeypatch.setattr(main.rede, "abrir_url", lambda *a, **k: fake_resp)


def test_baixar_e_descomprimir_completo_ok(tmp_path, monkeypatch):
    conteudo = b"conteudo da demo, repetido pra dar corpo" * 500
    comprimido = bz2.compress(conteudo)
    _patch_urlopen(monkeypatch, _FakeResp(comprimido, content_length=len(comprimido)))
    destino = tmp_path / "match.dem"
    main._baixar_e_descomprimir("http://x", destino)
    assert destino.read_bytes() == conteudo


def test_baixar_e_descomprimir_truncado_content_length_diverge(tmp_path, monkeypatch):
    conteudo = bz2.compress(b"conteudo da demo, repetido pra dar corpo" * 500)
    truncado = conteudo[: len(conteudo) // 2]
    # Declara o Content-Length do arquivo INTEIRO — a CDN cortou a conexão no meio,
    # então o header original (que veio antes do corte) ainda prometia o tamanho certo.
    _patch_urlopen(monkeypatch, _FakeResp(truncado, content_length=len(conteudo)))
    destino = tmp_path / "match.dem"
    with pytest.raises(RuntimeError, match="truncado"):
        main._baixar_e_descomprimir("http://x", destino)


def test_baixar_e_descomprimir_stream_bz2_incompleto_nunca_sucede_silenciosamente(tmp_path, monkeypatch):
    conteudo = bz2.compress(b"conteudo da demo, repetido pra dar corpo" * 500)
    truncado = conteudo[: len(conteudo) // 2]
    _patch_urlopen(monkeypatch, _FakeResp(truncado, content_length=None))
    destino = tmp_path / "match.dem"
    # Sem Content-Length pra comparar, a garantia é a checagem de EOF do bz2 (ou uma
    # exceção do próprio decompressor) — nunca deve terminar "com sucesso" em silêncio.
    with pytest.raises(Exception):
        main._baixar_e_descomprimir("http://x", destino)


# ---- finding #10 da auditoria: nunca logar a URL assinada de download do .dem ----

def test_cmd_fetch_nao_loga_url_assinada_do_dem(monkeypatch, capsys):
    config = Config(env={"DATABASE_URL": "x"})
    conn = object()  # nenhum acesso real a banco: tudo abaixo é monkeypatchado
    code = "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee"
    url_secreta = "https://valve.example/secret-signed-url?token=abc123"

    monkeypatch.setattr(main.dbmod, "list_pending_share_codes", lambda c, limit=None: [code])
    monkeypatch.setattr(main.dbmod, "contar_pendentes", lambda c: 1)
    monkeypatch.setattr(
        main, "_resolver_demo_urls",
        lambda codes, bot_dir, node_bin: [{"shareCode": codes[0], "demoUrl": url_secreta, "matchTime": None}],
    )
    monkeypatch.setattr(main, "_baixar_e_descomprimir", lambda url, destino: destino.write_bytes(b"x"))
    monkeypatch.setattr(main, "ingest_demo", lambda *a, **kw: "m1")

    main.cmd_fetch(config, conn)

    saida = capsys.readouterr().out
    assert url_secreta not in saida
    # Repositório público: o share code (que baixa a demo) não pode sair em claro no
    # log do Actions — só a referência curta de _ref.
    assert code not in saida
    assert main._ref(code) in saida


# ---- retry de erro transitório no fetch (CDN da Valve) em vez de failed direto ----

def test_cmd_fetch_erro_de_download_registra_tentativa_em_vez_de_marcar_failed_direto(monkeypatch, capsys):
    """Um erro transitório (502/503, timeout de rede na CDN da Valve — aconteceu de
    verdade em 2026-07-22) não pode marcar a Partida como 'failed' de cara: cmd_fetch
    deve registrar a tentativa via dbmod.falhar_fetch_pendente (mesmo padrão de
    falhar_faceit_pendente), não fazer o update de 'failed' direto na cursor."""
    config = Config(env={"DATABASE_URL": "x"})
    # conn não pode ser None: a implementação chama conn.rollback() diretamente no except,
    # mesmo padrão de cmd_processar_fila_pro/cmd_sincronizar_faceit.
    conn = types.SimpleNamespace(rollback=lambda: None)
    code = "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee"

    monkeypatch.setattr(main.dbmod, "list_pending_share_codes", lambda c, limit=None: [code])
    monkeypatch.setattr(main.dbmod, "contar_pendentes", lambda c: 1)
    monkeypatch.setattr(
        main, "_resolver_demo_urls",
        lambda codes, bot_dir, node_bin: [{"shareCode": codes[0], "demoUrl": "https://x", "matchTime": None}],
    )

    def _baixar_falha(url, destino):
        raise RuntimeError("502 Bad Gateway")

    monkeypatch.setattr(main, "_baixar_e_descomprimir", _baixar_falha)

    retries = []
    monkeypatch.setattr(
        main.dbmod, "falhar_fetch_pendente",
        lambda c, code, erro, **kw: retries.append((code, kw.get("max_tentativas"))),
    )

    total = main.cmd_fetch(config, conn)

    assert total == 0
    assert retries == [(code, 3)]
    assert "FALHOU" in capsys.readouterr().out


def test_cmd_fetch_erro_de_download_nao_derruba_o_lote(monkeypatch):
    """Uma Partida com demo problemático não impede as outras do mesmo lote de serem
    ingeridas — mesma garantia que já existia antes do retry, só mudou COMO a falha
    é registrada."""
    config = Config(env={"DATABASE_URL": "x"})
    conn = types.SimpleNamespace(rollback=lambda: None)
    code_ruim = "CSGO-ruim0-ruim0-ruim0-ruim0-ruim00"
    code_bom = "CSGO-bom00-bom00-bom00-bom00-bom000"

    monkeypatch.setattr(main.dbmod, "list_pending_share_codes", lambda c, limit=None: [code_ruim, code_bom])
    monkeypatch.setattr(main.dbmod, "contar_pendentes", lambda c: 2)
    monkeypatch.setattr(
        main, "_resolver_demo_urls",
        lambda codes, bot_dir, node_bin: [
            {"shareCode": code_ruim, "demoUrl": "https://x/ruim", "matchTime": None},
            {"shareCode": code_bom, "demoUrl": "https://x/bom", "matchTime": None},
        ],
    )

    def _baixar(url, destino):
        if "ruim" in url:
            raise RuntimeError("timeout")
        destino.write_bytes(b"x")

    monkeypatch.setattr(main, "_baixar_e_descomprimir", _baixar)
    monkeypatch.setattr(main, "ingest_demo", lambda *a, **kw: "m-bom")
    monkeypatch.setattr(main.dbmod, "falhar_fetch_pendente", lambda c, code, erro, **kw: None)

    total = main.cmd_fetch(config, conn)

    assert total == 1


# ---- finding #16 da auditoria: download do hltvUrl em streaming, com teto de tamanho ----

def test_baixar_com_teto_devolve_conteudo_dentro_do_teto(monkeypatch):
    _patch_urlopen(monkeypatch, _FakeResp(b"conteudo pequeno"))
    assert main._baixar_com_teto("http://x", max_bytes=1000) == b"conteudo pequeno"


def test_baixar_com_teto_aborta_durante_o_streaming_sem_ler_indefinidamente(monkeypatch):
    class _RespGigante:
        """Simula uma resposta que continuaria mandando dados pra sempre — o teto tem
        que cortar DURANTE o streaming, sem esperar a resposta terminar de vir (é
        exatamente o que resp.read() completo, usado antes do fix, não conseguia)."""

        def __init__(self):
            self.chamadas = 0

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self, n=-1):
            self.chamadas += 1
            if self.chamadas > 5:
                raise AssertionError("deveria ter abortado bem antes de ler tanto")
            return b"x" * (1 << 20)  # 1MB por chunk

    resp = _RespGigante()
    monkeypatch.setattr(main.rede, "abrir_url", lambda *a, **k: resp)

    with pytest.raises(RuntimeError, match="teto"):
        main._baixar_com_teto("http://x", max_bytes=2 << 20)  # teto de 2MB, chunks de 1MB

    assert resp.chamadas <= 5


def test_processar_fila_pro_hltv_url_que_excede_o_teto_marca_falhou(monkeypatch):
    conn = _FilaConn([("f1", "https://hltv.org/download/demo/999", None, None)])
    config = _config_com_r2()
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")

    def _baixar_com_teto_falha(url, max_bytes, timeout=120):
        raise RuntimeError(f"download de {url} excedeu o teto de {max_bytes} bytes")

    monkeypatch.setattr(main, "_baixar_com_teto", _baixar_com_teto_falha)

    total = main.cmd_processar_fila_pro(config, conn)

    assert total == 0
    update = next(c for c in conn.calls if c[0].startswith("update partidas_pro_fila") and c[1][0] == "falhou")
    assert "excedeu o teto" in update[1][2]


# ---- finding #17 da auditoria: limpeza de upload órfão no R2 ----

def test_cmd_limpar_uploads_orfaos_apaga_do_r2_e_marca_limpo(monkeypatch):
    config = _config_com_r2()
    conn = object()
    monkeypatch.setattr(main.dbmod, "listar_uploads_falhos_antigos", lambda c, dias=30: [("u1", "uploads-pendentes/abc.dem")])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    deletes = []
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: deletes.append((bucket, key)))
    marcados = []
    monkeypatch.setattr(main.dbmod, "marcar_upload_limpo", lambda c, upload_id: marcados.append(upload_id))

    total = main.cmd_limpar_uploads_orfaos(config, conn, dias=30)

    assert total == 1
    assert deletes == [("resenha-demos", "uploads-pendentes/abc.dem")]
    assert marcados == ["u1"]


def test_cmd_limpar_uploads_orfaos_sem_candidatos_nao_toca_no_r2(monkeypatch):
    config = _config_com_r2()
    conn = object()
    monkeypatch.setattr(main.dbmod, "listar_uploads_falhos_antigos", lambda c, dias=30: [])
    chamado = []
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: chamado.append(1))

    total = main.cmd_limpar_uploads_orfaos(config, conn, dias=30)

    assert total == 0
    assert chamado == []  # nem chegou a criar cliente do R2


def test_cmd_limpar_uploads_orfaos_erro_num_item_nao_derruba_os_outros(monkeypatch, capsys):
    config = _config_com_r2()
    conn = object()
    monkeypatch.setattr(
        main.dbmod, "listar_uploads_falhos_antigos",
        lambda c, dias=30: [("u-ruim", "uploads-pendentes/ruim.dem"), ("u-bom", "uploads-pendentes/bom.dem")],
    )
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")

    def _delete_fake(client, bucket, key):
        if "ruim" in key:
            raise RuntimeError("R2 fora do ar")

    monkeypatch.setattr(main.storage_r2, "delete_object", _delete_fake)
    marcados = []
    monkeypatch.setattr(main.dbmod, "marcar_upload_limpo", lambda c, upload_id: marcados.append(upload_id))

    total = main.cmd_limpar_uploads_orfaos(config, conn, dias=30)

    assert total == 1
    assert marcados == ["u-bom"]
    saida = capsys.readouterr().out
    assert "RuntimeError" in saida and "R2 fora do ar" not in saida  # log sem mensagem crua


# ---- juntar-clipes: vídeo único da montagem (DEMO-SLAP) ----

def _config_juntar():
    return Config({
        "R2_ACCOUNT_ID": "acc", "R2_ACCESS_KEY_ID": "id",
        "R2_SECRET_ACCESS_KEY": "secret", "R2_BUCKET": "resenha-demos", "DEMOSLAP_API_KEY": "k",
    })


def _fakes_juntar(monkeypatch, montagens, urls):
    monkeypatch.setattr(main.dbmod, "listar_montagens_sem_video", lambda c: montagens)
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main, "_demoslap_trechos", lambda api_key, job_id: urls)
    monkeypatch.setattr(main, "_baixar_trecho", lambda url, destino: destino.write_text(url))
    juntados = []

    def _concat(trechos, saida):
        juntados.append([p.read_text() for p in trechos])
        saida.write_bytes(b"mp4")

    monkeypatch.setattr(main, "_ffmpeg_concat", _concat)
    uploads = []
    monkeypatch.setattr(
        main.storage_r2, "upload_bytes",
        lambda client, bucket, key, data, content_type=None: uploads.append((bucket, key, data, content_type)),
    )
    gravados = []
    monkeypatch.setattr(main.dbmod, "gravar_video_montagem", lambda c, clipe_id, key: gravados.append((clipe_id, key)))
    return juntados, uploads, gravados


def test_cmd_juntar_clipes_sem_chave_e_no_op(monkeypatch):
    chamado = []
    monkeypatch.setattr(main.dbmod, "listar_montagens_sem_video", lambda c: chamado.append(1))
    assert main.cmd_juntar_clipes(_config_com_r2(), object()) == 0
    assert chamado == []


def test_cmd_juntar_clipes_junta_na_ordem_das_kills_e_grava_no_r2(monkeypatch):
    urls = {"v1": "https://cdn/1.mp4", "v2": "https://cdn/2.mp4"}
    juntados, uploads, gravados = _fakes_juntar(monkeypatch, [("c1", "an1", ["v2", "v1"])], urls)

    assert main.cmd_juntar_clipes(_config_juntar(), object()) == 1
    assert juntados == [["https://cdn/2.mp4", "https://cdn/1.mp4"]]
    assert uploads == [("resenha-demos", "clipes/c1.mp4", b"mp4", "video/mp4")]
    assert gravados == [("c1", "clipes/c1.mp4")]


def test_cmd_juntar_clipes_trecho_sem_video_nao_grava_e_segue_pra_proxima(monkeypatch, capsys):
    urls = {"v1": "https://cdn/1.mp4", "v2": "https://cdn/2.mp4"}
    _, uploads, gravados = _fakes_juntar(
        monkeypatch, [("ruim", "an1", ["v1", "v9"]), ("bom", "an1", ["v1", "v2"])], urls,
    )

    assert main.cmd_juntar_clipes(_config_juntar(), object()) == 1
    assert [k for _, k, _, _ in uploads] == ["clipes/bom.mp4"]
    assert gravados == [("bom", "clipes/bom.mp4")]
    saida = capsys.readouterr().out
    assert "falha ao juntar (RuntimeError)" in saida and "v9" not in saida  # log sem mensagem crua


def test_baixar_trecho_recusa_esquema_que_nao_e_https(tmp_path):
    with pytest.raises(RuntimeError, match="esquema"):
        main._baixar_trecho("file:///etc/passwd", tmp_path / "x.mp4")


def test_ffmpeg_concat_recodifica_quando_copiar_o_stream_falha(monkeypatch, tmp_path):
    import subprocess

    chamadas = []

    def _run(cmd, **kw):
        chamadas.append(cmd)
        if "copy" in cmd:
            raise subprocess.CalledProcessError(1, cmd)

    monkeypatch.setattr(subprocess, "run", _run)
    trechos = [tmp_path / "trecho_0.mp4", tmp_path / "trecho_1.mp4"]
    main._ffmpeg_concat(trechos, tmp_path / "montagem.mp4")

    assert len(chamadas) == 2
    assert "libx264" in chamadas[1]
    assert (tmp_path / "montagem.txt").read_text(encoding="utf-8").count("file '") == 2


def test_baixar_e_descomprimir_recusa_esquema_que_nao_e_http(tmp_path):
    with pytest.raises(RuntimeError, match="esquema"):
        main._baixar_e_descomprimir("file:///etc/passwd", tmp_path / "match.dem")


def test_baixar_e_descomprimir_aborta_bomba_de_descompressao(tmp_path, monkeypatch):
    comprimido = bz2.compress(b"\0" * 5_000_000)
    _patch_urlopen(monkeypatch, _FakeResp(comprimido, content_length=len(comprimido)))
    monkeypatch.setattr(main, "_MAX_DEM_BYTES", 1_000_000)
    monkeypatch.setattr(main, "_BLOCO_DESCOMPRESSAO", 64 * 1024)
    destino = tmp_path / "match.dem"
    with pytest.raises(RuntimeError, match="teto"):
        main._baixar_e_descomprimir("https://replay1.valve.net/x.dem.bz2", destino)


# ---- R01: bot que falha não derruba o fetch (os passos seguintes do job rodam) ----

@pytest.mark.parametrize("erro", [
    RuntimeError("bot não devolveu nada (stderr: ERRO_STEAM_USER LoggedInElsewhere)"),
    subprocess.TimeoutExpired(cmd="node", timeout=80, output=None, stderr="LoggedInElsewhere"),
    json.JSONDecodeError("Expecting value", "LoggedInElsewhere", 0),
])
def test_cmd_fetch_resolver_falhando_nao_derruba_e_captura(monkeypatch, capsys, erro):
    config = Config(env={"DATABASE_URL": "x"})
    code = "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee"
    monkeypatch.setattr(main.dbmod, "list_pending_share_codes", lambda c, limit=None: [code])
    monkeypatch.setattr(main.dbmod, "contar_pendentes", lambda c: 1)

    def _resolver(codes, bot_dir, node_bin):
        raise erro

    monkeypatch.setattr(main, "_resolver_demo_urls", _resolver)
    capturados = []
    monkeypatch.setattr(main, "capturar_erro", lambda e, etapa: capturados.append((e, etapa)))
    falhas = []
    monkeypatch.setattr(main.dbmod, "falhar_fetch_pendente", lambda *a, **kw: falhas.append(a))

    assert main.cmd_fetch(config, conn=object()) == 0
    assert capturados == [(erro, "fetch")]
    assert falhas == []  # nenhuma Partida perde tentativa por culpa do bot
    saida = capsys.readouterr().out
    assert "LoggedInElsewhere" not in saida  # stderr do bot não sai cru no log
    assert type(erro).__name__ in saida


# ---- R02: erro por item vai pro Sentry com a etapa ----

def test_cmd_fetch_erro_de_download_captura_com_etapa(monkeypatch):
    config = Config(env={"DATABASE_URL": "x"})
    conn = types.SimpleNamespace(rollback=lambda: None)
    code = "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee"
    monkeypatch.setattr(main.dbmod, "list_pending_share_codes", lambda c, limit=None: [code])
    monkeypatch.setattr(main.dbmod, "contar_pendentes", lambda c: 1)
    monkeypatch.setattr(
        main, "_resolver_demo_urls",
        lambda codes, bot_dir, node_bin: [{"shareCode": code, "demoUrl": "https://x", "matchTime": None}],
    )
    erro = RuntimeError("502 Bad Gateway")

    def _baixar(url, destino):
        raise erro

    monkeypatch.setattr(main, "_baixar_e_descomprimir", _baixar)
    monkeypatch.setattr(main.dbmod, "falhar_fetch_pendente", lambda *a, **kw: None)
    capturados = []
    monkeypatch.setattr(main, "capturar_erro", lambda e, etapa: capturados.append((e, etapa)))

    main.cmd_fetch(config, conn)

    assert capturados == [(erro, "fetch")]


def test_cmd_cleanup_falha_ao_apagar_captura_com_etapa(monkeypatch, capsys):
    url = "https://acc.r2.cloudflarestorage.com/resenha-demos/demos/m1.dem.bz2"
    conn = _CleanupConn([("m1", url)])
    erro = RuntimeError("R2 fora")

    def _delete(*a):
        raise erro

    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "client")
    monkeypatch.setattr(main.storage_r2, "delete_object", _delete)
    capturados = []
    monkeypatch.setattr(main, "capturar_erro", lambda e, etapa: capturados.append((e, etapa)))

    assert main.cmd_cleanup(_config_com_r2(), conn, days=14) == 0
    assert capturados == [(erro, "cleanup")]
    assert "R2 fora" not in capsys.readouterr().out


# ---- R03: reprocess grava na MESMA Partida, mesmo sem Share Code ----

def test_cmd_reprocess_grava_no_match_id_da_linha_mesmo_sem_share_code(monkeypatch):
    # Partida de upload manual (sem Share Code): o parser novo muda o K/D, o
    # fingerprint muda e a dedupe por conteúdo criaria uma linha nova. Com o id já
    # conhecido, store_parsed grava direto nele.
    conn = _ReprocessConn([
        ("m-upload", None, "upload", "https://r2/demos/9.dem.bz2", "https://r2/replays/9.json", None),
    ])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "key_from_url", lambda url, bucket: url.rsplit("/", 1)[-1])
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"dem-bytes")
    monkeypatch.setattr(main, "_descomprimir_dem_arquivado", lambda dados: b"dem-real")
    monkeypatch.setattr(
        main.parsemod, "parse_demo",
        lambda path: {"players": [], "kills": [], "rounds": [], "map": "de_dust2", "highlights": []},
    )
    monkeypatch.setattr(main.transform, "fill_kd_from_kills", lambda players, kills: players)
    monkeypatch.setattr(main.transform, "enrich", lambda parsed: parsed)
    monkeypatch.setattr(main.parsemod, "extract_replay", lambda path: {"ticks": [], "kills": [], "rounds": []})
    monkeypatch.setattr(main.replaymod, "build_replay", lambda *a, **kw: {"rounds": []})
    monkeypatch.setattr(main.transform, "attach_replay_frames", lambda highlights, rounds: highlights)
    monkeypatch.setattr(main, "_montar_lineups", lambda *a, **kw: [])
    monkeypatch.setattr(main, "_upload_replay", lambda *a, **kw: None)
    gravados = []
    monkeypatch.setattr(main.dbmod, "store_parsed", lambda conn, parsed, **kw: gravados.append(kw) or "m-upload")

    assert main.cmd_reprocess(_config_com_r2(), conn) == 1
    assert gravados[0]["match_id_alvo"] == "m-upload"
    assert gravados[0]["share_code"] is None


def test_store_parsed_com_match_id_alvo_nao_cria_linha_nova():
    # Integração com o db: K/D diferente (fingerprint novo, sem linha que case) e
    # sem Share Code. Com match_id_alvo, é update na linha certa, nunca insert.
    executados = []

    class _Cur:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, sql, params=None):
            executados.append(" ".join(sql.split()))

        def fetchone(self):
            return None

        def fetchall(self):
            return []

    class _Conn:
        def cursor(self):
            return _Cur()

        def commit(self):
            pass

    parsed = {"map": "de_dust2", "score_a": 13, "score_b": 7, "players": [], "rounds": []}
    mid = dbmod.store_parsed(_Conn(), parsed, share_code=None, source="upload", match_id_alvo="m-upload")

    assert mid == "m-upload"
    assert not any(s.startswith("insert into matches") for s in executados)
    assert any(s.startswith("update matches set") for s in executados)


# ---- R04: sem Share Code, a chave do R2 sai do conteúdo da Demo (não hash de 32 bits) ----

def _finalizar_sem_share_code(monkeypatch, tmp_path, demos, alvo=None):
    """`demos`: bytes do .dem de cada chamada. Todas com o mesmo parsed (mesmo fingerprint)."""
    gravados = []
    monkeypatch.setattr(main.dbmod, "store_parsed", lambda conn, parsed, **kw: gravados.append(kw) or "m1")
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    chaves = []
    monkeypatch.setattr(main.storage_r2, "upload_bytes", lambda client, bucket, key, data, **kw: chaves.append(key))
    config = _config_com_r2()
    parsed = {"map": "de_anubis", "score_a": 13, "score_b": 0,
              "players": [{"steam_id64": "76561198000000001", "kills": 13, "deaths": 0}]}
    for i, conteudo in enumerate(demos):
        dem = tmp_path / f"demo-{i}.dem"
        dem.write_bytes(conteudo)
        main._finalizar_ingest(
            config, conn=None, parsed=parsed, replay_json={"rounds": []},
            dem_path_upload=dem, share_code=None, source="upload", upload=True, played_at=None,
            match_id_alvo=alvo,
        )
    return config, gravados, [k for k in chaves if k.startswith("demos/")]


def test_partidas_com_mesmo_fingerprint_e_demos_diferentes_tem_chaves_diferentes(monkeypatch, tmp_path):
    import uuid

    config, gravados, demo_keys = _finalizar_sem_share_code(monkeypatch, tmp_path, [b"partida-1", b"partida-2"])

    assert len(demo_keys) == 2 and demo_keys[0] != demo_keys[1]
    for kw, key in zip(gravados, demo_keys):
        ident = key[len("demos/"):-len(".dem.bz2")]
        assert str(uuid.UUID(ident)) == ident
        assert main.storage_r2.key_from_url(kw["demo_url"], config.r2_bucket) == key
        assert main.storage_r2.key_from_url(kw["replay_url"], config.r2_bucket) == f"replays/{ident}.json"


def test_mesmo_arquivo_duas_vezes_regrava_a_mesma_chave(monkeypatch, tmp_path):
    # Retry da série pro: regrava os mesmos objetos em vez de deixar a Demo e o Replay 2D
    # antigos órfãos no R2.
    _config, _gravados, demo_keys = _finalizar_sem_share_code(monkeypatch, tmp_path, [b"mesma", b"mesma"])

    assert len(demo_keys) == 2 and demo_keys[0] == demo_keys[1]


def test_finalizar_ingest_com_alvo_usa_a_chave_da_partida_alvo(monkeypatch, tmp_path):
    alvo = "0b3f5c1e-1111-4222-8333-444455556666"
    _config, gravados, demo_keys = _finalizar_sem_share_code(monkeypatch, tmp_path, [b"x"], alvo=alvo)

    assert demo_keys == [f"demos/{alvo}.dem.bz2"]
    assert gravados[0]["match_id_alvo"] == alvo


def test_id_do_conteudo_cobre_todas_as_partes_na_ordem(tmp_path):
    p1, p2, p3 = (tmp_path / n for n in ("p1.dem", "p2.dem", "p3.dem"))
    p1.write_bytes(b"parte-1")
    p2.write_bytes(b"parte-2")
    p3.write_bytes(b"outra-parte-1")

    assert main._id_do_conteudo([p1, p2]) == main._id_do_conteudo([p1, p2])
    assert main._id_do_conteudo([p1, p2]) != main._id_do_conteudo([p3, p2])  # mesma última parte
    assert main._id_do_conteudo([p1, p2]) != main._id_do_conteudo([p2])


def test_finalizar_ingest_com_share_code_mantem_a_chave_do_match_id_da_valve(monkeypatch, tmp_path):
    monkeypatch.setattr(main.dbmod, "store_parsed", lambda conn, parsed, **kw: "m1")
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    chaves = []
    monkeypatch.setattr(main.storage_r2, "upload_bytes", lambda client, bucket, key, data, **kw: chaves.append(key))
    monkeypatch.setattr(main.sharecode, "decode", lambda code: {"match_id": 1234567890123})
    dem = tmp_path / "demo.dem"
    dem.write_bytes(b"x")
    main._finalizar_ingest(
        _config_com_r2(), conn=None, parsed={"players": []}, replay_json=None,
        dem_path_upload=dem, share_code="CSGO-x", source="valve_mm", upload=True, played_at=None,
    )
    assert chaves == ["demos/1234567890123.dem.bz2"]


# ---- R05: cleanup cobre played_at nulo e ingestão tardia ----

def test_cmd_cleanup_usa_o_maior_entre_played_at_e_created_at():
    conn = _CleanupConn([])
    main.cmd_cleanup(_config_com_r2(), conn, days=14)
    sql, params = conn.calls[0]
    assert "greatest(played_at, created_at) < %s" in sql
    assert 13.9 < _dias_ate_o_limite(params) < 14.1


# ---- R06: upload — definitivo apaga na hora; transitório volta; 3a tentativa apaga ----

def _fakes_upload(monkeypatch, erro, status_apos_falha="pendente", delete_falha=None):
    conn = _UploadsConn([("u1", "765", "uploads-pendentes/abc.dem", None, None, None, None, None)])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")

    def _download(client, bucket, key, **kw):
        if isinstance(erro, main.storage_r2.ArquivoGrandeDemaisError):
            raise erro
        return b"dem-bytes"

    def _ingest(*a, **kw):
        raise erro

    monkeypatch.setattr(main.storage_r2, "download_bytes", _download)
    monkeypatch.setattr(main, "ingest_demo", _ingest)
    deletes = []

    def _delete(client, bucket, key):
        if delete_falha is not None:
            raise delete_falha
        deletes.append(key)

    monkeypatch.setattr(main.storage_r2, "delete_object", _delete)
    falhas = []
    monkeypatch.setattr(
        main.dbmod, "falhar_upload_pendente",
        lambda c, upload_id, e, **kw: falhas.append((upload_id, e, kw.get("max_tentativas"))) or status_apos_falha,
    )
    capturados = []
    monkeypatch.setattr(main, "capturar_erro", lambda e, etapa: capturados.append((e, etapa)))
    return conn, deletes, falhas, capturados


def _status_gravados(conn):
    return [c[1][0] for c in conn.calls if c[0].startswith("update uploads_pendentes set status = %s")]


def test_upload_erro_transitorio_volta_pra_fila_e_mantem_staging(monkeypatch, capsys):
    erro = RuntimeError("parser explodiu")
    conn, deletes, falhas, capturados = _fakes_upload(monkeypatch, erro, "pendente")

    assert main.cmd_processar_uploads_pendentes(_config_com_r2(), conn) == 0

    assert falhas == [("u1", erro, 3)]
    assert deletes == []
    assert _status_gravados(conn) == ["processando"]
    assert capturados == [(erro, "processar-uploads-pendentes")]
    assert "parser explodiu" not in capsys.readouterr().out


def test_upload_terceira_tentativa_vira_falhou_e_apaga_staging(monkeypatch):
    erro = OSError("R2 timeout")
    conn, deletes, falhas, capturados = _fakes_upload(monkeypatch, erro, "falhou")

    main.cmd_processar_uploads_pendentes(_config_com_r2(), conn)

    assert falhas == [("u1", erro, 3)]
    assert deletes == ["uploads-pendentes/abc.dem"]


def test_upload_terceira_tentativa_com_delete_falhando_so_captura(monkeypatch):
    erro = OSError("R2 timeout")
    erro_del = OSError("R2 fora")
    conn, deletes, falhas, capturados = _fakes_upload(monkeypatch, erro, "falhou", delete_falha=erro_del)

    main.cmd_processar_uploads_pendentes(_config_com_r2(), conn)

    assert falhas == [("u1", erro, 3)]
    assert (erro_del, "processar-uploads-pendentes") in capturados
    assert _status_gravados(conn) == ["processando"]  # o status já ficou no falhar_upload_pendente


@pytest.mark.parametrize("erro", [
    main.storage_r2.ArquivoGrandeDemaisError("objeto grande demais"),
    main.DemoNaoConfereError("mapa errado"),
])
def test_upload_erro_definitivo_vira_falhou_e_apaga_staging_na_hora(monkeypatch, erro):
    conn, deletes, falhas, capturados = _fakes_upload(monkeypatch, erro)

    main.cmd_processar_uploads_pendentes(_config_com_r2(), conn)

    assert falhas == []  # não gasta tentativa: nenhum retry muda o resultado
    assert _status_gravados(conn) == ["processando", "falhou"]
    assert deletes == ["uploads-pendentes/abc.dem"]


def test_upload_erro_definitivo_com_delete_falhando_mantem_falhou_e_captura(monkeypatch):
    erro = main.storage_r2.ArquivoGrandeDemaisError("objeto grande demais")
    erro_del = OSError("R2 fora")
    conn, deletes, falhas, capturados = _fakes_upload(monkeypatch, erro, delete_falha=erro_del)

    main.cmd_processar_uploads_pendentes(_config_com_r2(), conn)

    assert _status_gravados(conn) == ["processando", "falhou"]
    assert (erro_del, "processar-uploads-pendentes") in capturados


# ---- R106: série com mapa falho NÃO apaga o staging ----

def _serie_dois_mapas(monkeypatch, mapas_que_falham):
    """Fila com um .rar de 2 mapas em staging. ingest_demo simula a dedupe por
    fingerprint do banco: o mesmo mapa ingerido de novo devolve o MESMO match_id."""
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"rar-bytes")

    def _extrair(rar_path, destino):
        destino.mkdir(parents=True, exist_ok=True)
        caminhos = []
        for nome in ("serie-m1-anubis.dem", "serie-m2-inferno.dem"):
            dem = destino / nome
            dem.write_bytes(b"x")
            caminhos.append(dem)
        return caminhos

    monkeypatch.setattr(rar_extract, "extrair_dems_de_rar", _extrair)
    monkeypatch.setattr(
        main.parsemod, "cabecalho_mapa",
        lambda path: "de_anubis" if "anubis" in path.name else "de_inferno",
    )
    banco = {}

    def _ingest(cfg, cn, dem_path, source=None, upload=None, **kw):
        if any(m in dem_path.name for m in mapas_que_falham):
            raise RuntimeError("parser explodiu")
        return banco.setdefault(dem_path.name, f"m-{len(banco) + 1}")

    monkeypatch.setattr(main, "ingest_demo", _ingest)
    deletes = []
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: deletes.append(key))
    return banco, deletes


def _updates_fila(conn):
    return [c[1] for c in conn.calls if c[0].startswith("update partidas_pro_fila set status = %s")]


def test_serie_com_mapa_falho_fica_falhou_com_match_ids_parciais_e_staging_intacto(monkeypatch):
    conn = _FilaConn([("f1", None, "partidas-pro-pendentes/serie.rar", _AGORA_MENOS(60))])
    banco, deletes = _serie_dois_mapas(monkeypatch, mapas_que_falham=["inferno"])

    total = main.cmd_processar_fila_pro(_config_com_r2(), conn)

    assert total == 0
    assert deletes == []  # o retry do admin precisa do arquivo
    status, match_id, erro, match_ids, _fila_id = _updates_fila(conn)[-1]
    assert status == "falhou"
    assert match_ids == ["m-1"] and match_id == "m-1"
    assert "serie-m2-inferno.dem" in erro and "1/2" in erro


def test_retry_da_serie_com_os_dois_mapas_ok_conclui_sem_duplicar(monkeypatch):
    conn = _FilaConn([("f1", None, "partidas-pro-pendentes/serie.rar", _AGORA_MENOS(60))])
    banco, deletes = _serie_dois_mapas(monkeypatch, mapas_que_falham=["inferno"])
    main.cmd_processar_fila_pro(_config_com_r2(), conn)

    # Retry do admin: o parser foi corrigido; a mesma fila roda de novo.
    monkeypatch.setattr(main, "ingest_demo", lambda cfg, cn, dem_path, **kw: banco.setdefault(
        dem_path.name, f"m-{len(banco) + 1}"))
    conn.calls.clear()
    total = main.cmd_processar_fila_pro(_config_com_r2(), conn)

    assert total == 1
    status, match_id, erro, match_ids, _fila_id = _updates_fila(conn)[-1]
    assert status == "concluida"
    assert match_ids == ["m-1", "m-2"]  # anubis reaproveitou a mesma Partida
    assert len(banco) == 2
    assert deletes == ["partidas-pro-pendentes/serie.rar"]


# ---- R36: delete do staging da fila é best-effort ----

def test_fila_concluida_com_delete_falhando_continua_concluida(monkeypatch):
    conn = _FilaConn([("f1", None, "partidas-pro-pendentes/abc.dem", _AGORA_MENOS(60))])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"dem-bytes")
    monkeypatch.setattr(main, "ingest_demo", lambda cfg, cn, dem_path, **kw: "m1")
    erro_del = OSError("R2 fora")

    def _delete(client, bucket, key):
        raise erro_del

    monkeypatch.setattr(main.storage_r2, "delete_object", _delete)
    capturados = []
    monkeypatch.setattr(main, "capturar_erro", lambda e, etapa: capturados.append((e, etapa)))

    assert main.cmd_processar_fila_pro(_config_com_r2(), conn) == 1
    assert [u[0] for u in _updates_fila(conn)] == ["baixando", "processando", "concluida"]
    assert _updates_fila(conn)[-1][3] == ["m1"]
    assert capturados == [(erro_del, "processar-fila-pro")]


def test_upload_concluido_com_delete_falhando_continua_concluido(monkeypatch):
    conn = _UploadsConn([("u1", "765", "uploads-pendentes/abc.dem", None, None, None, None, _AGORA_MENOS(60))])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"dem-bytes")
    monkeypatch.setattr(main, "ingest_demo", lambda *a, **kw: "m1")
    erro_del = OSError("R2 fora")

    def _delete(client, bucket, key):
        raise erro_del

    monkeypatch.setattr(main.storage_r2, "delete_object", _delete)
    falhas = []
    monkeypatch.setattr(main.dbmod, "falhar_upload_pendente", lambda *a, **kw: falhas.append(a) or "pendente")
    capturados = []
    monkeypatch.setattr(main, "capturar_erro", lambda e, etapa: capturados.append((e, etapa)))

    assert main.cmd_processar_uploads_pendentes(_config_com_r2(), conn) == 1
    assert falhas == []  # o upload deu certo: não gasta tentativa nem volta pra fila
    assert _status_gravados(conn) == ["processando", "concluido"]
    assert capturados == [(erro_del, "processar-uploads-pendentes")]


# ---- R37: item preso em baixando/processando vira 'falhou' no início do run ----

def test_fila_pro_marca_interrompidos_antes_de_listar(monkeypatch):
    conn = _FilaConn([])
    assert main.cmd_processar_fila_pro(_config_com_r2(), conn) == 0
    sql, params = conn.calls[0]
    assert sql.startswith("update partidas_pro_fila set status = 'falhou'")
    assert "status in ('baixando', 'processando')" in sql
    assert params == ("interrompido no run anterior",)
    assert conn.calls[1][0].startswith("select id, hltv_url, arquivo_r2_key")


# ---- R107: staging ausente no R2 — janela de 20 min ----

class _NoSuchKey(Exception):
    def __init__(self, code="404"):
        super().__init__(f"An error occurred ({code}) when calling the HeadObject operation: Not Found")
        self.response = {"Error": {"Code": code}}


def _AGORA_MENOS(minutos):
    return datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=minutos)


def test_objeto_ausente_reconhece_404_e_nosuchkey():
    assert main.storage_r2.objeto_ausente(_NoSuchKey("404"))
    assert main.storage_r2.objeto_ausente(_NoSuchKey("NoSuchKey"))
    assert not main.storage_r2.objeto_ausente(_NoSuchKey("AccessDenied"))
    assert not main.storage_r2.objeto_ausente(RuntimeError("x"))


def _upload_sem_staging(monkeypatch, minutos):
    conn = _UploadsConn([("u1", "765", "uploads-pendentes/abc.dem", None, None, None, None, _AGORA_MENOS(minutos))])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")

    def _download(client, bucket, key, **kw):
        raise _NoSuchKey()

    monkeypatch.setattr(main.storage_r2, "download_bytes", _download)
    deletes = []
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: deletes.append(key))
    falhas = []
    monkeypatch.setattr(main.dbmod, "falhar_upload_pendente", lambda *a, **kw: falhas.append(a) or "pendente")
    return conn, deletes, falhas


def test_upload_sem_staging_com_menos_de_20_min_espera_sem_gastar_tentativa(monkeypatch):
    conn, deletes, falhas = _upload_sem_staging(monkeypatch, minutos=19)
    main.cmd_processar_uploads_pendentes(_config_com_r2(), conn)
    assert falhas == []
    assert _status_gravados(conn) == ["processando", "pendente"]
    assert deletes == []


def test_upload_sem_staging_com_20_min_ou_mais_vira_falhou(monkeypatch):
    conn, deletes, falhas = _upload_sem_staging(monkeypatch, minutos=20)
    main.cmd_processar_uploads_pendentes(_config_com_r2(), conn)
    assert falhas == []
    assert _status_gravados(conn) == ["processando", "falhou"]
    assert deletes == []  # nada a apagar


def _fila_sem_staging(monkeypatch, minutos):
    conn = _FilaConn([("f1", None, "partidas-pro-pendentes/abc.dem", _AGORA_MENOS(minutos))])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")

    def _download(client, bucket, key, **kw):
        raise _NoSuchKey("NoSuchKey")

    monkeypatch.setattr(main.storage_r2, "download_bytes", _download)
    return conn


def test_fila_sem_staging_com_menos_de_20_min_volta_pra_pendente(monkeypatch):
    conn = _fila_sem_staging(monkeypatch, minutos=5)
    main.cmd_processar_fila_pro(_config_com_r2(), conn)
    assert [u[0] for u in _updates_fila(conn)] == ["baixando", "pendente"]


def test_fila_sem_staging_com_20_min_ou_mais_vira_falhou(monkeypatch):
    conn = _fila_sem_staging(monkeypatch, minutos=25)
    main.cmd_processar_fila_pro(_config_com_r2(), conn)
    assert [u[0] for u in _updates_fila(conn)] == ["baixando", "falhou"]


# ---- R35: link de Demo nulo do GC gasta tentativa e esgota em 3 ----

def test_cmd_fetch_url_nula_esgota_em_3_rodadas_e_libera_o_lote(monkeypatch):
    config = Config(env={"DATABASE_URL": "x"})
    code = "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee"
    fila = {code: {"status": "pending", "tentativas": 0}}

    def _pendentes(c, limit=None):
        return [k for k, v in fila.items() if v["status"] == "pending"]

    def _falhar(c, share_code, erro, max_tentativas=3):
        item = fila[share_code]
        item["tentativas"] += 1
        if item["tentativas"] >= max_tentativas:
            item["status"] = "failed"

    monkeypatch.setattr(main.dbmod, "list_pending_share_codes", _pendentes)
    monkeypatch.setattr(main.dbmod, "contar_pendentes", lambda c: len(_pendentes(c)))
    monkeypatch.setattr(main.dbmod, "falhar_fetch_pendente", _falhar)
    monkeypatch.setattr(
        main, "_resolver_demo_urls",
        lambda codes, bot_dir, node_bin: [{"shareCode": c, "demoUrl": None, "matchTime": None} for c in codes],
    )

    for _ in range(3):
        main.cmd_fetch(config, conn=object())

    assert fila[code] == {"status": "failed", "tentativas": 3}
    assert _pendentes(None) == []  # o lote não fica preso nesse item


# ---- R112: discover com todos os Jogadores falhando levanta no fim ----

def _discover(monkeypatch, falham):
    jogadores = [("765A", "auth-a", "CSGO-a"), ("765B", "auth-b", "CSGO-b")]
    monkeypatch.setattr(main.dbmod, "list_tracked_players", lambda c: jogadores)

    def _walk(key, steam_id64, auth, last):
        if steam_id64 in falham:
            raise RuntimeError(f"auth inválido de {steam_id64}")
        return []

    monkeypatch.setattr(main.steam_api, "walk_chain", _walk)
    capturados = []
    monkeypatch.setattr(main, "capturar_erro", lambda e, etapa: capturados.append(etapa))
    return capturados


def test_discover_com_todos_falhando_sinaliza_falha_total(monkeypatch, capsys):
    capturados = _discover(monkeypatch, falham={"765A", "765B"})
    with pytest.raises(main.FalhaTotalDiscover, match="falha total"):
        main.cmd_discover(Config(env={"STEAM_API_KEY": "k"}), conn=object())
    assert capturados == ["discover", "discover"]
    assert "765A" not in capsys.readouterr().out


def test_main_discover_com_falha_total_sai_sem_excecao(monkeypatch):
    # O passo "Descobrir" do workflow precisa sair 0: os passos seguintes (fetch,
    # cleanup, uploads, FACEIT) não têm if: !cancelled().
    _discover(monkeypatch, falham={"765A", "765B"})
    monkeypatch.setenv("DATABASE_URL", "postgres://x")
    monkeypatch.setenv("STEAM_API_KEY", "k")
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    monkeypatch.setattr(main.dbmod, "connect", lambda url: types.SimpleNamespace(close=lambda: None))
    main.main(["discover"])


def test_discover_com_falha_parcial_segue_normal(monkeypatch):
    capturados = _discover(monkeypatch, falham={"765A"})
    assert main.cmd_discover(Config(env={"STEAM_API_KEY": "k"}), conn=object()) == 0
    assert capturados == ["discover"]


def test_discover_sem_jogadores_nao_levanta(monkeypatch):
    monkeypatch.setattr(main.dbmod, "list_tracked_players", lambda c: [])
    assert main.cmd_discover(Config(env={"STEAM_API_KEY": "k"}), conn=object()) == 0


# ---- R114 (P0): upload com Share Code de outra Partida não sobrescreve nada ----

def _ingest_envio(monkeypatch, tmp_path, jogadores, status_share_code=None, amigos=(), descoberta_por=None):
    """ingest_demo de upload sem alvo, com R2 e banco falsos. Devolve o que foi gravado."""
    dem_path = tmp_path / "demo.dem"
    dem_path.write_bytes(b"fake-demo-bytes")
    monkeypatch.setattr(main.parsemod, "parse_demo", lambda path: _fake_parsed("de_mirage", jogadores))
    monkeypatch.setattr(main.transform, "fill_kd_from_kills", lambda players, kills: players)
    monkeypatch.setattr(main.transform, "enrich", lambda parsed: parsed)
    monkeypatch.setattr(main.parsemod, "extract_replay", lambda path: {"ticks": [], "kills": [], "rounds": []})
    monkeypatch.setattr(main.replaymod, "build_replay", lambda *a, **kw: {"rounds": []})
    monkeypatch.setattr(main.transform, "attach_replay_frames", lambda highlights, rounds: highlights)
    monkeypatch.setattr(main, "_montar_lineups", lambda *a, **kw: [])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.sharecode, "decode", lambda code: {"match_id": 555})
    monkeypatch.setattr(main, "_atualizar_avatares", lambda *a, **kw: None)
    monkeypatch.setattr(main.discord, "notificar_partida", lambda *a, **kw: None)
    gravado = {"r2": [], "store": []}
    monkeypatch.setattr(main.storage_r2, "upload_bytes", lambda client, bucket, key, data, **kw: gravado["r2"].append(key))
    monkeypatch.setattr(main.dbmod, "store_parsed", lambda conn, parsed, **kw: gravado["store"].append(kw) or "m-nova")
    monkeypatch.setattr(
        main.dbmod, "partida_por_share_code",
        lambda conn, code: None if status_share_code is None else (status_share_code, descoberta_por),
    )
    monkeypatch.setattr(main.dbmod, "amigos_aceitos", lambda conn, steam_id64: set(amigos))
    return dem_path, gravado


def test_upload_com_share_code_de_partida_parsed_nao_altera_nada(monkeypatch, tmp_path):
    dem_path, gravado = _ingest_envio(monkeypatch, tmp_path, ["765EU", "765X"], status_share_code="parsed")

    with pytest.raises(main.DemoNaoConfereError, match="Essa Partida já está registrada."):
        main.ingest_demo(_config_com_r2(), conn=None, path=dem_path, share_code="CSGO-alheio",
                         source="upload", enviado_por="765EU")

    assert gravado["r2"] == []  # nem demos/555 nem replays/555 da Partida existente
    assert gravado["store"] == []


def test_upload_sem_o_jogador_nem_amigo_na_demo_e_recusado(monkeypatch, tmp_path):
    dem_path, gravado = _ingest_envio(monkeypatch, tmp_path, ["765A", "765B"], amigos={"765C"})

    with pytest.raises(main.DemoNaoConfereError, match="Você nem seus amigos aparecem nesta Demo."):
        main.ingest_demo(_config_com_r2(), conn=None, path=dem_path, share_code=None,
                         source="upload", enviado_por="765EU")

    assert gravado["r2"] == [] and gravado["store"] == []


def test_upload_com_amigo_aceito_na_demo_e_gravado(monkeypatch, tmp_path):
    dem_path, gravado = _ingest_envio(monkeypatch, tmp_path, ["765A", "765AMIGO"], amigos={"765AMIGO"})

    assert main.ingest_demo(_config_com_r2(), conn=None, path=dem_path, source="upload",
                            enviado_por="765EU") == "m-nova"
    assert len(gravado["store"]) == 1


@pytest.mark.parametrize("status", [None, "pending", "failed", "skipped", "expired"])
def test_upload_com_share_code_que_nao_esta_parsed_preenche_a_partida(monkeypatch, tmp_path, status):
    dem_path, gravado = _ingest_envio(monkeypatch, tmp_path, ["765EU", "765X"], status_share_code=status)

    main.ingest_demo(_config_com_r2(), conn=None, path=dem_path, share_code="CSGO-meu",
                     source="upload", enviado_por="765EU")

    assert gravado["store"][0]["share_code"] == "CSGO-meu"
    assert "demos/555.dem.bz2" in gravado["r2"]


def test_upload_com_alvo_nao_passa_pela_prova_de_participacao(monkeypatch, tmp_path):
    # Com alvo, a checagem é a de _validar_demo_contra_alvo (mapa + roster + placar).
    dem_path, gravado = _ingest_envio(monkeypatch, tmp_path, ["A", "B"])

    def _nao_chamar(*a, **kw):
        raise AssertionError("prova de participação não se aplica a upload com alvo")

    monkeypatch.setattr(main.dbmod, "amigos_aceitos", _nao_chamar)
    monkeypatch.setattr(main.dbmod, "partida_por_share_code", _nao_chamar)
    alvo = {"match_id": "m-alvo", "map": "de_mirage", "steam_ids": {"A", "B"}}
    main.ingest_demo(_config_com_r2(), conn=None, path=dem_path, alvo=alvo, enviado_por="765EU")
    assert gravado["store"][0]["match_id_alvo"] == "m-alvo"


def test_ingest_sem_enviado_por_nao_checa_participacao(monkeypatch, tmp_path):
    # fetch, FACEIT e fila pro chamam ingest_demo sem enviado_por.
    dem_path, gravado = _ingest_envio(monkeypatch, tmp_path, ["765A"], status_share_code="parsed")
    main.ingest_demo(_config_com_r2(), conn=None, path=dem_path, share_code="CSGO-x", source="valve_mm")
    assert len(gravado["store"]) == 1


def test_processar_uploads_passa_quem_enviou_pro_ingest(monkeypatch):
    conn = _UploadsConn([("u1", "765EU", "uploads-pendentes/abc.dem", "CSGO-x", None, None, None, None)])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"dem")
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda *a: None)
    recebidos = []
    monkeypatch.setattr(main, "ingest_demo", lambda *a, **kw: recebidos.append(kw) or "m1")
    main.cmd_processar_uploads_pendentes(_config_com_r2(), conn)
    assert recebidos[0]["enviado_por"] == "765EU"


def test_processar_uploads_partida_ja_registrada_falha_e_apaga_staging(monkeypatch):
    conn = _UploadsConn([("u1", "765EU", "uploads-pendentes/abc.dem", "CSGO-x", None, None, None, None)])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"dem")
    deletes = []
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: deletes.append(key))

    def _ingest(*a, **kw):
        raise main.DemoNaoConfereError(main.MSG_PARTIDA_JA_REGISTRADA)

    monkeypatch.setattr(main, "ingest_demo", _ingest)
    main.cmd_processar_uploads_pendentes(_config_com_r2(), conn)
    falhou = next(c for c in conn.calls if c[0].startswith("update uploads_pendentes set status = %s") and c[1][0] == "falhou")
    assert falhou[1][2] == "Essa Partida já está registrada."
    assert deletes == ["uploads-pendentes/abc.dem"]


# ---- R114 (c): Share Code de Partida não parsed só aceita Demo de quem a descobriu ----

def test_upload_em_pending_alheia_com_demo_sem_quem_descobriu_e_recusado(monkeypatch, tmp_path):
    dem_path, gravado = _ingest_envio(
        monkeypatch, tmp_path, ["765EU", "765X"], status_share_code="pending", descoberta_por="765DONO",
    )
    with pytest.raises(main.DemoNaoConfereError, match="Essa Demo não é da Partida desse Share Code."):
        main.ingest_demo(_config_com_r2(), conn=None, path=dem_path, share_code="CSGO-alheio",
                         source="upload", enviado_por="765EU")
    assert gravado["r2"] == [] and gravado["store"] == []


def test_upload_em_pending_com_quem_descobriu_na_demo_e_gravado(monkeypatch, tmp_path):
    dem_path, gravado = _ingest_envio(
        monkeypatch, tmp_path, ["765EU", "765DONO"], status_share_code="pending", descoberta_por="765DONO",
    )
    main.ingest_demo(_config_com_r2(), conn=None, path=dem_path, share_code="CSGO-x",
                     source="upload", enviado_por="765EU")
    assert gravado["store"][0]["share_code"] == "CSGO-x"


def test_upload_em_pending_sem_discovered_by_segue_como_antes(monkeypatch, tmp_path):
    dem_path, gravado = _ingest_envio(
        monkeypatch, tmp_path, ["765EU", "765X"], status_share_code="failed", descoberta_por=None,
    )
    main.ingest_demo(_config_com_r2(), conn=None, path=dem_path, share_code="CSGO-antigo",
                     source="upload", enviado_por="765EU")
    assert len(gravado["store"]) == 1


def test_config_r2_bucket_vazio_vira_o_default():
    # .env.example traz R2_BUCKET= vazio; Bucket="" quebraria todo acesso ao R2.
    assert Config({"R2_BUCKET": ""}).r2_bucket == "resenha-demos"
    assert Config({}).r2_bucket == "resenha-demos"
    assert Config({"R2_BUCKET": "outro"}).r2_bucket == "outro"



# ---- R120: download pela rede.abrir_url (checagem de host em cada redirect) ----

def test_baixar_e_descomprimir_usa_abrir_url_sem_lista_de_dominios(tmp_path, monkeypatch):
    comprimido = bz2.compress(b"demo")
    pedidos = []

    def _abrir(url, timeout, dominios=None):
        pedidos.append((url, dominios))
        return _FakeResp(comprimido, content_length=len(comprimido))

    monkeypatch.setattr(main.rede, "abrir_url", _abrir)
    main._baixar_e_descomprimir("https://replay.valve.net/a.dem.bz2", tmp_path / "match.dem")
    assert pedidos == [("https://replay.valve.net/a.dem.bz2", None)]


def test_baixar_com_teto_restringe_a_url_inicial_a_hltv(monkeypatch):
    pedidos = []

    def _abrir(url, timeout, dominios=None):
        pedidos.append(dominios)
        return _FakeResp(b"rar")

    monkeypatch.setattr(main.rede, "abrir_url", _abrir)
    assert main._baixar_com_teto("https://www.hltv.org/download/demo/1", max_bytes=1000) == b"rar"
    assert pedidos == [("hltv.org",)]


def test_cmd_fetch_host_recusado_marca_failed_na_primeira_tentativa(monkeypatch):
    config = Config(env={"DATABASE_URL": "x"})
    conn = types.SimpleNamespace(rollback=lambda: None)
    code = "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee"
    monkeypatch.setattr(main.dbmod, "list_pending_share_codes", lambda c, limit=None: [code])
    monkeypatch.setattr(main.dbmod, "contar_pendentes", lambda c: 1)
    monkeypatch.setattr(
        main, "_resolver_demo_urls",
        lambda codes, bot_dir, node_bin: [{"shareCode": codes[0], "demoUrl": "https://x", "matchTime": None}],
    )

    def _baixar_recusado(url, destino):
        raise main.rede.HostNaoPermitidoError("host resolve para IP interno")

    monkeypatch.setattr(main, "_baixar_e_descomprimir", _baixar_recusado)
    retries = []
    monkeypatch.setattr(
        main.dbmod, "falhar_fetch_pendente",
        lambda c, code, erro, **kw: retries.append((code, kw.get("max_tentativas"))),
    )

    assert main.cmd_fetch(config, conn) == 0
    assert retries == [(code, 1)]


def test_sincronizar_faceit_trata_host_recusado_como_erro_definitivo(monkeypatch):
    # R06 + R120: Demo da FACEIT com host recusado não muda tentando de novo.
    recebidos = []
    monkeypatch.setattr(main.faceit_sync, "sincronizar", lambda *a, **kw: recebidos.append(kw) or 0)
    main.cmd_sincronizar_faceit(Config(env={}), conn=object())
    assert recebidos[0]["erros_definitivos"] == (main.DemoNaoConfereError, main.rede.HostNaoPermitidoError)


# ---- F3: avisar-discord nunca derruba o job ----

class _ErroSql(Exception):
    def __init__(self, sqlstate):
        super().__init__("detalhe que não pode ir pro log")
        self.sqlstate = sqlstate


class _ConnAviso:
    def __init__(self):
        self.fechada = False

    def rollback(self):
        pass

    def close(self):
        self.fechada = True


def test_avisar_discord_sem_webhook_nao_abre_conexao(monkeypatch):
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)

    def _conectar(url):
        raise AssertionError("não devia conectar")

    assert main.cmd_avisar_discord(Config(env={}), conectar=_conectar) == 0


def test_avisar_discord_main_sem_webhook_nao_exige_database_url(monkeypatch):
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(main.dbmod, "connect", lambda url: (_ for _ in ()).throw(AssertionError("conectou")))
    with pytest.raises(SystemExit) as saida:
        main.main(["avisar-discord"])
    assert saida.value.code == 0


@pytest.mark.parametrize("sqlstate", ["42703", "42P01"])
def test_avisar_discord_sem_migration_0063_sai_0_sem_sentry(monkeypatch, capsys, sqlstate):
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/1/tok")
    conn = _ConnAviso()
    capturados = []
    monkeypatch.setattr(main, "capturar_erro", lambda e, etapa: capturados.append(etapa))

    def _clipes(c, w, a):
        raise _ErroSql(sqlstate)

    monkeypatch.setattr(main.discord, "avisar_clipes", _clipes)
    assert main.cmd_avisar_discord(Config(env={"DATABASE_URL": "x"}), conectar=lambda url: conn) == 0
    saida = capsys.readouterr().out
    assert "_ErroSql" in saida
    assert "detalhe" not in saida
    assert capturados == []
    assert conn.fechada


def test_avisar_discord_outra_falha_vai_pro_sentry_e_sai_0(monkeypatch, capsys):
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/1/tok")
    conn = _ConnAviso()
    capturados = []
    monkeypatch.setattr(main, "capturar_erro", lambda e, etapa: capturados.append(etapa))
    monkeypatch.setattr(main.discord, "avisar_clipes", lambda c, w, a: 0)

    def _resenha(c, w, a, agora):
        raise OSError("falhou https://discord.com/api/webhooks/1/tok")

    monkeypatch.setattr(main.discord, "avisar_resenha_semanal", _resenha)
    assert main.cmd_avisar_discord(Config(env={"DATABASE_URL": "x"}), conectar=lambda url: conn) == 0
    saida = capsys.readouterr().out
    assert capturados == ["avisar-discord"]
    assert "tok" not in saida
    assert conn.fechada


def test_avisar_discord_chama_clipes_e_resenha(monkeypatch):
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/1/tok")
    monkeypatch.setenv("APP_URL", "https://resenha.app")
    chamadas = []
    monkeypatch.setattr(main.discord, "avisar_clipes", lambda c, w, a: chamadas.append(("clipes", a)) or 2)
    monkeypatch.setattr(
        main.discord, "avisar_resenha_semanal",
        lambda c, w, a, agora: chamadas.append(("resenha", agora.tzinfo is not None)) or False,
    )
    assert main.cmd_avisar_discord(Config(env={"DATABASE_URL": "x"}), conectar=lambda url: _ConnAviso()) == 0
    assert chamadas == [("clipes", "https://resenha.app"), ("resenha", True)]
