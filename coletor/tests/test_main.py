import bz2
import json
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
                "throwerLado": "T",
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
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key: b"dem-bytes")
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
        uploads[key] = json.loads(data.decode("utf-8"))

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
        if self._last.startswith("select id, hltv_url, arquivo_r2_key from partidas_pro_fila"):
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
    conn = _FilaConn([("f1", None, "partidas-pro-pendentes/abc.dem")])
    config = _config_com_r2()

    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    downloads = []
    monkeypatch.setattr(
        main.storage_r2, "download_bytes",
        lambda client, bucket, key: (downloads.append((client, bucket, key)), b"dem-bytes")[1],
    )
    deletes = []
    monkeypatch.setattr(
        main.storage_r2, "delete_object",
        lambda client, bucket, key: deletes.append((bucket, key)),
    )

    def _urlopen_nao_deveria_ser_chamado(*a, **kw):
        raise AssertionError("urlopen não deveria ser chamado quando vem de arquivo_r2_key")

    monkeypatch.setattr("urllib.request.urlopen", _urlopen_nao_deveria_ser_chamado)

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
    conn = _FilaConn([("f1", None, "partidas-pro-pendentes/abc.dem")])
    config = _config_com_r2()

    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key: b"dem-bytes")
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
    conn = _FilaConn([("f1", "https://hltv.org/download/demo/999", None)])
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

    def _urlopen_fake(url, timeout=None):
        urls_abertos.append(url)
        return _FakeResp(b"rar-bytes")

    monkeypatch.setattr("urllib.request.urlopen", _urlopen_fake)

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
    assert deletes == []  # não veio de arquivo_r2_key -> nada pra apagar do R2


def test_processar_fila_pro_funde_partes_adjacentes_do_mesmo_mapa_num_so_match_id(monkeypatch):
    # reinício técnico no meio do mapa 1 (anubis) -> HLTV distribui como -p1/-p2
    # ADJACENTES no .rar; mapa 2 (inferno) é um .dem normal, grupo de 1. Devem sair
    # 2 match_ids (1 pra série anubis fundida + 1 pra inferno), não 3.
    conn = _FilaConn([("f1", "https://hltv.org/download/demo/999", None)])
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

    monkeypatch.setattr("urllib.request.urlopen", lambda url, timeout=None: _FakeResp(b"rar-bytes"))

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
            "select id, adicionado_por, arquivo_r2_key, share_code, played_at, plataforma_manual from uploads_pendentes"
        ):
            return self.conn.upload_rows
        return []


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
    conn = _UploadsConn([("u1", "765", "uploads-pendentes/abc.dem", None, None, "gamers_club")])
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

    def _ingest_fake(cfg, cn, dem_path, share_code=None, source=None, upload=None, played_at=None, plataforma_manual=None):
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
    conn = _UploadsConn([("u1", "765", "uploads-pendentes/abc.dem", None, None, None)])
    config = _config_com_r2()

    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"dem-bytes")
    deletes = []
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: deletes.append((bucket, key)))
    monkeypatch.setattr(main, "ingest_demo", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("parser explodiu")))

    total = main.cmd_processar_uploads_pendentes(config, conn)

    assert total == 0
    assert deletes == []
    update = next(c for c in conn.calls if c[0].startswith("update uploads_pendentes") and c[1][0] == "falhou")
    assert "parser explodiu" in update[1][2]


# ---- finding #2 da auditoria: teto de tamanho barra download de upload gigante ----

def test_processar_uploads_pendentes_marca_falhou_quando_objeto_excede_o_teto(monkeypatch):
    conn = _UploadsConn([("u1", "765", "uploads-pendentes/abc.dem", None, None, None)])
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


# ---- cmd_sincronizar_faceit ----


def test_sincronizar_faceit_sem_api_key_pula_sem_tocar_no_banco(monkeypatch, capsys):
    config = Config(env={})  # sem FACEIT_API_KEY
    conn = None  # todo acesso a banco é via dbmod.* monkeypatchado — conn nunca é lido
    total = main.cmd_sincronizar_faceit(config, conn)
    assert total == 0
    assert "FACEIT_API_KEY" in capsys.readouterr().out


def test_sincronizar_faceit_descobre_processa_demo_e_carimba_elo(monkeypatch):
    config = Config(env={"FACEIT_API_KEY": "k"})
    conn = None  # todo acesso a banco é via dbmod.* monkeypatchado — conn nunca é lido
    from datetime import datetime, timezone
    antes_dt = datetime(2026, 7, 16, 9, 0, tzinfo=timezone.utc)
    # 1784196000 = 2026-07-16T10:00:00Z, 1h DEPOIS de antes_dt — precisa ser posterior
    # ao snapshot anterior pra escolher_partida_para_elo() considerar essa partida
    # elegível pro carimbo before/after (ver faceit.escolher_partida_para_elo). O
    # epoch original do brief (1752660000) resolvia pra 2025-07-16, um ano ANTES de
    # antes_dt — o que fazia escolher_partida_para_elo devolver None (comportamento
    # correto da função) e a asserção de elo_gravado nunca passar.
    finished_at_epoch = 1784196000

    monkeypatch.setattr(main.dbmod, "listar_vinculados_faceit", lambda c: [("111", "f-111")])
    monkeypatch.setattr(main.dbmod, "faceit_match_ids_conhecidos", lambda c: set())
    monkeypatch.setattr(main.dbmod, "membro_ja_sincronizou_faceit", lambda c, s: True)
    enfileiradas = []
    monkeypatch.setattr(main.dbmod, "enfileirar_faceit", lambda c, m, s: enfileiradas.append(m))
    monkeypatch.setattr(main.faceit, "listar_historico_5v5",
                        lambda key, fid, ja_vistas, andar_tudo=False, **kw: [
                            {"faceit_match_id": "fm1", "finished_at": finished_at_epoch}])
    monkeypatch.setattr(main.dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 0)])
    monkeypatch.setattr(main.faceit, "detalhes_partida",
                        lambda key, mid, **kw: {"demo_url": ["https://d/x.dem.gz"],
                                                "finished_at": finished_at_epoch, "teams": {}, "results": {}})
    monkeypatch.setattr(main.faceit, "stats_partida", lambda key, mid, **kw: {"rounds": []})
    monkeypatch.setattr(main.faceit, "baixar_demo", lambda key, url, **kw: b"dem bytes")
    monkeypatch.setattr(main, "ingest_demo",
                        lambda config, conn, path, **kw: "uuid-m1")
    marcadas, concluidas, elo_gravado = [], [], []
    monkeypatch.setattr(main.dbmod, "marcar_faceit_match", lambda c, mid, fmid: marcadas.append((mid, fmid)))
    monkeypatch.setattr(main.dbmod, "concluir_faceit_pendente", lambda c, fmid: concluidas.append(fmid))
    monkeypatch.setattr(main.faceit, "elo_atual", lambda key, fid, **kw: (1425, 7))
    monkeypatch.setattr(main.dbmod, "elo_snapshot", lambda c, s: (1400, antes_dt))
    monkeypatch.setattr(main.dbmod, "atualizar_elo", lambda c, s, e, l: None)
    monkeypatch.setattr(main.dbmod, "gravar_elo_partida",
                        lambda c, mid, s, b, a: elo_gravado.append((mid, s, b, a)))

    total = main.cmd_sincronizar_faceit(config, conn)

    assert total == 1
    assert enfileiradas == ["fm1"]
    assert marcadas == [("uuid-m1", "fm1")]
    assert concluidas == ["fm1"]
    assert elo_gravado == [("uuid-m1", "111", 1400, 1425)]


def test_sincronizar_faceit_cai_no_stats_only_quando_demo_falha(monkeypatch):
    config = Config(env={"FACEIT_API_KEY": "k"})
    conn = None  # todo acesso a banco é via dbmod.* monkeypatchado — conn nunca é lido
    monkeypatch.setattr(main.dbmod, "listar_vinculados_faceit", lambda c: [("111", "f-111")])
    monkeypatch.setattr(main.dbmod, "faceit_match_ids_conhecidos", lambda c: {"fm1"})
    monkeypatch.setattr(main.dbmod, "membro_ja_sincronizou_faceit", lambda c, s: True)
    monkeypatch.setattr(main.faceit, "listar_historico_5v5", lambda *a, **kw: [])
    monkeypatch.setattr(main.dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 0)])
    monkeypatch.setattr(main.faceit, "detalhes_partida",
                        lambda key, mid, **kw: {"demo_url": [], "finished_at": 1752660000,
                                                "teams": {}, "results": {}})
    monkeypatch.setattr(main.faceit, "stats_partida", lambda key, mid, **kw: {"rounds": []})
    monkeypatch.setattr(main.faceit, "montar_parsed_stats_only",
                        lambda d, s: {"players": [], "map": "de_mirage", "played_at": None})
    gravados = []
    monkeypatch.setattr(main.dbmod, "store_parsed",
                        lambda conn, parsed, **kw: gravados.append(kw) or "uuid-m2")
    monkeypatch.setattr(main.dbmod, "marcar_faceit_match", lambda c, mid, fmid: None)
    monkeypatch.setattr(main.dbmod, "concluir_faceit_pendente", lambda c, fmid: None)
    monkeypatch.setattr(main.faceit, "elo_atual", lambda key, fid, **kw: (None, None))
    monkeypatch.setattr(main.dbmod, "elo_snapshot", lambda c, s: (None, None))
    monkeypatch.setattr(main.dbmod, "atualizar_elo", lambda c, s, e, l: None)

    total = main.cmd_sincronizar_faceit(config, conn)
    assert total == 1
    assert gravados[0]["source"] == "faceit"


def test_sincronizar_faceit_demo_falha_com_tentativas_restantes_faz_retry_sem_stats_only(monkeypatch):
    config = Config(env={"FACEIT_API_KEY": "k"})
    # conn NÃO pode ser None aqui: baixar_demo_falha dispara uma exceção real dentro do
    # try/except de download de demo, e a implementação chama conn.rollback() diretamente
    # (mesmo motivo documentado em test_sincronizar_faceit_falha_de_item_nao_derruba_o_lote) —
    # com conn=None isso levantaria AttributeError antes mesmo de chegar na lógica de retry.
    conn = types.SimpleNamespace(rollback=lambda: None)
    monkeypatch.setattr(main.dbmod, "listar_vinculados_faceit", lambda c: [("111", "f-111")])
    monkeypatch.setattr(main.dbmod, "faceit_match_ids_conhecidos", lambda c: {"fm1"})
    monkeypatch.setattr(main.dbmod, "membro_ja_sincronizou_faceit", lambda c, s: True)
    monkeypatch.setattr(main.faceit, "listar_historico_5v5", lambda *a, **kw: [])
    # tentativas=0 -> 0+1 < 3, ainda tem tentativa sobrando
    monkeypatch.setattr(main.dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 0)])
    monkeypatch.setattr(main.faceit, "detalhes_partida",
                        lambda key, mid, **kw: {"demo_url": ["https://d/x.dem.gz"],
                                                "finished_at": 1752660000, "teams": {}, "results": {}})
    monkeypatch.setattr(main.faceit, "stats_partida", lambda key, mid, **kw: {"rounds": []})

    def baixar_demo_falha(key, url, **kw):
        raise RuntimeError("demo not ready")

    monkeypatch.setattr(main.faceit, "baixar_demo", baixar_demo_falha)
    monkeypatch.setattr(main.faceit, "montar_parsed_stats_only", lambda d, s: (_ for _ in ()).throw(
        AssertionError("nao deveria cair pro stats-only com tentativas restantes")))
    gravados = []
    monkeypatch.setattr(main.dbmod, "store_parsed", lambda conn, parsed, **kw: gravados.append(kw) or "uuid-x")
    concluidas = []
    monkeypatch.setattr(main.dbmod, "concluir_faceit_pendente", lambda c, fmid: concluidas.append(fmid))
    retries = []
    monkeypatch.setattr(main.dbmod, "falhar_faceit_pendente",
                        lambda c, fmid, erro, **kw: retries.append((fmid, kw.get("max_tentativas"))))
    monkeypatch.setattr(main.faceit, "elo_atual", lambda key, fid, **kw: (None, None))
    monkeypatch.setattr(main.dbmod, "elo_snapshot", lambda c, s: (None, None))
    monkeypatch.setattr(main.dbmod, "atualizar_elo", lambda c, s, e, l: None)

    total = main.cmd_sincronizar_faceit(config, conn)

    assert total == 0
    assert retries == [("fm1", 3)]
    assert concluidas == []
    assert gravados == []


def test_sincronizar_faceit_demo_falha_apos_esgotar_tentativas_cai_pro_stats_only(monkeypatch):
    config = Config(env={"FACEIT_API_KEY": "k"})
    # conn NÃO pode ser None aqui pelo mesmo motivo do teste anterior: baixar_demo_falha
    # dispara uma exceção real que passa por conn.rollback() direto na implementação.
    conn = types.SimpleNamespace(rollback=lambda: None)
    monkeypatch.setattr(main.dbmod, "listar_vinculados_faceit", lambda c: [("111", "f-111")])
    monkeypatch.setattr(main.dbmod, "faceit_match_ids_conhecidos", lambda c: {"fm1"})
    monkeypatch.setattr(main.dbmod, "membro_ja_sincronizou_faceit", lambda c, s: True)
    monkeypatch.setattr(main.faceit, "listar_historico_5v5", lambda *a, **kw: [])
    # tentativas=2 -> 2+1 >= 3, já esgotou (essa é a 3a tentativa)
    monkeypatch.setattr(main.dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 2)])
    monkeypatch.setattr(main.faceit, "detalhes_partida",
                        lambda key, mid, **kw: {"demo_url": ["https://d/x.dem.gz"],
                                                "finished_at": 1752660000, "teams": {}, "results": {}})
    monkeypatch.setattr(main.faceit, "stats_partida", lambda key, mid, **kw: {"rounds": []})

    def baixar_demo_falha(key, url, **kw):
        raise RuntimeError("demo not ready")

    monkeypatch.setattr(main.faceit, "baixar_demo", baixar_demo_falha)
    monkeypatch.setattr(main.faceit, "montar_parsed_stats_only",
                        lambda d, s: {"players": [], "map": "de_mirage", "played_at": None})
    gravados = []
    monkeypatch.setattr(main.dbmod, "store_parsed", lambda conn, parsed, **kw: gravados.append(kw) or "uuid-y")
    monkeypatch.setattr(main.dbmod, "marcar_faceit_match", lambda c, mid, fmid: None)
    concluidas = []
    monkeypatch.setattr(main.dbmod, "concluir_faceit_pendente", lambda c, fmid: concluidas.append(fmid))
    retries = []
    monkeypatch.setattr(main.dbmod, "falhar_faceit_pendente", lambda c, fmid, erro, **kw: retries.append(fmid))
    monkeypatch.setattr(main.faceit, "elo_atual", lambda key, fid, **kw: (None, None))
    monkeypatch.setattr(main.dbmod, "elo_snapshot", lambda c, s: (None, None))
    monkeypatch.setattr(main.dbmod, "atualizar_elo", lambda c, s, e, l: None)

    total = main.cmd_sincronizar_faceit(config, conn)

    assert total == 1
    assert concluidas == ["fm1"]
    assert retries == []  # nao chama falhar_faceit_pendente no ramo esgotado
    assert gravados[0]["source"] == "faceit"


def test_sincronizar_faceit_falha_de_item_nao_derruba_o_lote(monkeypatch):
    config = Config(env={"FACEIT_API_KEY": "k"})
    # Diferente dos outros testes desta suíte, conn NÃO pode ser None aqui: fm-ruim
    # dispara uma exceção real dentro do try/except por item, e a implementação chama
    # conn.rollback() diretamente (não via dbmod, mesmo padrão de cmd_fetch/
    # cmd_processar_fila_pro) antes de registrar a falha via dbmod.falhar_faceit_pendente.
    # Com conn=None isso levantaria AttributeError e mascararia o próprio isolamento de
    # falha que este teste existe pra verificar — por isso um stub mínimo com rollback()
    # no-op, sem virar uma FakeConn de verdade (nenhum acesso a banco é de fato lido).
    conn = types.SimpleNamespace(rollback=lambda: None)
    monkeypatch.setattr(main.dbmod, "listar_vinculados_faceit", lambda c: [("111", "f-111")])
    monkeypatch.setattr(main.dbmod, "faceit_match_ids_conhecidos", lambda c: set())
    monkeypatch.setattr(main.dbmod, "membro_ja_sincronizou_faceit", lambda c, s: True)
    monkeypatch.setattr(main.faceit, "listar_historico_5v5", lambda *a, **kw: [])
    monkeypatch.setattr(main.dbmod, "listar_faceit_pendentes",
                        lambda c, limite=10: [("fm-ruim", "111", 0), ("fm-bom", "111", 0)])

    def detalhes(key, mid, **kw):
        if mid == "fm-ruim":
            raise RuntimeError("api 500")
        return {"demo_url": [], "finished_at": 1752660000, "teams": {}, "results": {}}

    monkeypatch.setattr(main.faceit, "detalhes_partida", detalhes)
    monkeypatch.setattr(main.faceit, "stats_partida", lambda key, mid, **kw: {"rounds": []})
    monkeypatch.setattr(main.faceit, "montar_parsed_stats_only", lambda d, s: {"players": [], "played_at": None})
    monkeypatch.setattr(main.dbmod, "store_parsed", lambda conn, parsed, **kw: "uuid-ok")
    monkeypatch.setattr(main.dbmod, "marcar_faceit_match", lambda c, mid, fmid: None)
    monkeypatch.setattr(main.dbmod, "concluir_faceit_pendente", lambda c, fmid: None)
    falhas = []
    monkeypatch.setattr(main.dbmod, "falhar_faceit_pendente", lambda c, fmid, erro, **kw: falhas.append(fmid))
    monkeypatch.setattr(main.faceit, "elo_atual", lambda key, fid, **kw: (None, None))
    monkeypatch.setattr(main.dbmod, "elo_snapshot", lambda c, s: (None, None))
    monkeypatch.setattr(main.dbmod, "atualizar_elo", lambda c, s, e, l: None)

    total = main.cmd_sincronizar_faceit(config, conn)
    assert total == 1
    assert falhas == ["fm-ruim"]


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
    monkeypatch.setattr(main.urllib.request, "urlopen", lambda *a, **k: fake_resp)


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
    assert code in saida


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
    monkeypatch.setattr(main.urllib.request, "urlopen", lambda *a, **k: resp)

    with pytest.raises(RuntimeError, match="teto"):
        main._baixar_com_teto("http://x", max_bytes=2 << 20)  # teto de 2MB, chunks de 1MB

    assert resp.chamadas <= 5


def test_processar_fila_pro_hltv_url_que_excede_o_teto_marca_falhou(monkeypatch):
    conn = _FilaConn([("f1", "https://hltv.org/download/demo/999", None)])
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
    assert "R2 fora do ar" in capsys.readouterr().out
