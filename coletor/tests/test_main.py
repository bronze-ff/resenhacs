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


# ---- ingest_demo / group_id explicito ----

def test_ingest_demo_com_group_id_explicito_nao_chama_grupo_para_ingest(monkeypatch, tmp_path):
    chamou_grupo_para_ingest = []
    monkeypatch.setattr(
        main.dbmod, "grupo_para_ingest",
        lambda conn, steam_ids: chamou_grupo_para_ingest.append(1) or "grupo-errado",
    )
    store_calls = []
    monkeypatch.setattr(
        main.dbmod, "store_parsed",
        lambda conn, parsed, **kw: store_calls.append(kw) or "m1",
    )
    monkeypatch.setattr(main.parsemod, "parse_demo", lambda path: {"players": [], "kills": [], "map": "de_mirage"})
    monkeypatch.setattr(main.transform, "fill_kd_from_kills", lambda players, kills: players)
    monkeypatch.setattr(main.transform, "enrich", lambda parsed: {**parsed, "kills": [], "highlights": []})
    # extract_replay chama o parser Rust de verdade num .dem falso; um erro comum
    # (KeyError/ValueError etc.) o próprio ingest_demo engole (best-effort, replay 2D
    # não é o que este teste verifica) — mocka pra não depender do parser real aqui.
    monkeypatch.setattr(
        main.parsemod, "extract_replay",
        lambda path: (_ for _ in ()).throw(RuntimeError("sem replay nesse teste")),
    )

    config = Config(env={})
    dem = tmp_path / "demo.dem"
    dem.write_bytes(b"x")
    main.ingest_demo(config, None, dem, group_id="g-explicito", upload=False)

    assert chamou_grupo_para_ingest == []
    assert store_calls[-1]["group_id"] == "g-explicito"


# ---- upload do .dem arquivado no R2 (dívida técnica: subia sem comprimir) ----

def test_finalizar_ingest_comprime_o_dem_antes_de_subir_pro_r2(monkeypatch, tmp_path):
    monkeypatch.setattr(main.dbmod, "grupo_para_ingest", lambda conn, steam_ids: "g1")
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


def test_cmd_reprocess_com_since_filtra_por_played_at():
    conn = _FakeConnReprocess()
    main.cmd_reprocess(_config_com_r2(), conn, since="2026-07-16")
    assert "played_at >=" in conn.ultima_query
    assert conn.ultimos_params == ("2026-07-16",)


def test_cmd_reprocess_match_id_ignora_since():
    conn = _FakeConnReprocess()
    main.cmd_reprocess(_config_com_r2(), conn, match_id="m1", since="2026-07-16")
    assert "id = %s" in conn.ultima_query
    assert conn.ultimos_params == ("m1",)


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
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"rar-bytes"

    urls_abertos = []

    def _urlopen_fake(url, timeout=None):
        urls_abertos.append(url)
        return _FakeResp()

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
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"rar-bytes"

    monkeypatch.setattr("urllib.request.urlopen", lambda url, timeout=None: _FakeResp())

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
            "select id, group_id, adicionado_por, arquivo_r2_key, share_code, played_at from uploads_pendentes"
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


def test_processar_uploads_pendentes_baixa_do_r2_ingere_com_group_id_e_apaga_em_sucesso(monkeypatch):
    conn = _UploadsConn([("u1", "g1", "765", "uploads-pendentes/abc.dem", None, None)])
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
    ingests = []

    def _ingest_fake(cfg, cn, dem_path, share_code=None, source=None, upload=None, played_at=None, group_id=None):
        ingests.append((dem_path.name, source, upload, group_id))
        return "m1"

    monkeypatch.setattr(main, "ingest_demo", _ingest_fake)

    total = main.cmd_processar_uploads_pendentes(config, conn)

    assert total == 1
    assert downloads == [("fake-client", "resenha-demos", "uploads-pendentes/abc.dem")]
    assert ingests == [("demo.dem", "upload", True, "g1")]
    assert deletes == [("resenha-demos", "uploads-pendentes/abc.dem")]
    update = next(c for c in conn.calls if c[0].startswith("update uploads_pendentes") and c[1][0] == "concluido")
    assert update[1][1] == "m1"


def test_processar_uploads_pendentes_mantem_staging_no_r2_quando_falha(monkeypatch):
    conn = _UploadsConn([("u1", "g1", "765", "uploads-pendentes/abc.dem", None, None)])
    config = _config_com_r2()

    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key: b"dem-bytes")
    deletes = []
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: deletes.append((bucket, key)))
    monkeypatch.setattr(main, "ingest_demo", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("parser explodiu")))

    total = main.cmd_processar_uploads_pendentes(config, conn)

    assert total == 0
    assert deletes == []
    update = next(c for c in conn.calls if c[0].startswith("update uploads_pendentes") and c[1][0] == "falhou")
    assert "parser explodiu" in update[1][2]


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

    monkeypatch.setattr(main.dbmod, "listar_vinculados_faceit", lambda c: [("111", "f-111", "g1")])
    monkeypatch.setattr(main.dbmod, "faceit_match_ids_conhecidos", lambda c: set())
    monkeypatch.setattr(main.dbmod, "membro_ja_sincronizou_faceit", lambda c, s: True)
    enfileiradas = []
    monkeypatch.setattr(main.dbmod, "enfileirar_faceit", lambda c, m, s, g: enfileiradas.append(m))
    monkeypatch.setattr(main.faceit, "listar_historico_5v5",
                        lambda key, fid, ja_vistas, andar_tudo=False, **kw: [
                            {"faceit_match_id": "fm1", "finished_at": finished_at_epoch}])
    monkeypatch.setattr(main.dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", "g1", 0)])
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
    monkeypatch.setattr(main.dbmod, "listar_vinculados_faceit", lambda c: [("111", "f-111", "g1")])
    monkeypatch.setattr(main.dbmod, "faceit_match_ids_conhecidos", lambda c: {"fm1"})
    monkeypatch.setattr(main.dbmod, "membro_ja_sincronizou_faceit", lambda c, s: True)
    monkeypatch.setattr(main.faceit, "listar_historico_5v5", lambda *a, **kw: [])
    monkeypatch.setattr(main.dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", "g1", 0)])
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
    monkeypatch.setattr(main.dbmod, "listar_vinculados_faceit", lambda c: [("111", "f-111", "g1")])
    monkeypatch.setattr(main.dbmod, "faceit_match_ids_conhecidos", lambda c: {"fm1"})
    monkeypatch.setattr(main.dbmod, "membro_ja_sincronizou_faceit", lambda c, s: True)
    monkeypatch.setattr(main.faceit, "listar_historico_5v5", lambda *a, **kw: [])
    # tentativas=0 -> 0+1 < 3, ainda tem tentativa sobrando
    monkeypatch.setattr(main.dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", "g1", 0)])
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
    monkeypatch.setattr(main.dbmod, "listar_vinculados_faceit", lambda c: [("111", "f-111", "g1")])
    monkeypatch.setattr(main.dbmod, "faceit_match_ids_conhecidos", lambda c: {"fm1"})
    monkeypatch.setattr(main.dbmod, "membro_ja_sincronizou_faceit", lambda c, s: True)
    monkeypatch.setattr(main.faceit, "listar_historico_5v5", lambda *a, **kw: [])
    # tentativas=2 -> 2+1 >= 3, já esgotou (essa é a 3a tentativa)
    monkeypatch.setattr(main.dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", "g1", 2)])
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
    monkeypatch.setattr(main.dbmod, "listar_vinculados_faceit", lambda c: [("111", "f-111", "g1")])
    monkeypatch.setattr(main.dbmod, "faceit_match_ids_conhecidos", lambda c: set())
    monkeypatch.setattr(main.dbmod, "membro_ja_sincronizou_faceit", lambda c, s: True)
    monkeypatch.setattr(main.faceit, "listar_historico_5v5", lambda *a, **kw: [])
    monkeypatch.setattr(main.dbmod, "listar_faceit_pendentes",
                        lambda c, limite=10: [("fm-ruim", "111", "g1", 0), ("fm-bom", "111", "g1", 0)])

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


# ---- _notificar_discord_grupos ----


def test_notificar_discord_sem_app_url_nao_faz_nada(monkeypatch):
    config = main.Config(env={})
    chamado = []
    monkeypatch.setattr(main.dbmod, "grupos_da_partida", lambda *a, **k: chamado.append(1))
    main._notificar_discord_grupos(config, conn=None, match_id="m1")
    assert chamado == []


def test_notificar_discord_pula_grupo_sem_webhook(monkeypatch):
    config = main.Config(env={"APP_URL": "https://x.com"})
    monkeypatch.setattr(main.dbmod, "grupos_da_partida", lambda conn, mid: ["g1"])
    monkeypatch.setattr(main.dbmod, "ja_notificado_discord", lambda conn, mid, gid: False)
    monkeypatch.setattr(main.dbmod, "webhook_do_grupo", lambda conn, gid: None)
    enviados = []
    monkeypatch.setattr(main.discord_notify, "enviar_webhook", lambda *a, **k: enviados.append(1))
    main._notificar_discord_grupos(config, conn=object(), match_id="m1")
    assert enviados == []


def test_notificar_discord_pula_grupo_ja_notificado(monkeypatch):
    config = main.Config(env={"APP_URL": "https://x.com"})
    monkeypatch.setattr(main.dbmod, "grupos_da_partida", lambda conn, mid: ["g1"])
    monkeypatch.setattr(main.dbmod, "ja_notificado_discord", lambda conn, mid, gid: True)
    enviados = []
    monkeypatch.setattr(main.discord_notify, "enviar_webhook", lambda *a, **k: enviados.append(1))
    main._notificar_discord_grupos(config, conn=object(), match_id="m1")
    assert enviados == []


def test_notificar_discord_envia_e_marca_notificado(monkeypatch):
    config = main.Config(env={"APP_URL": "https://x.com"})
    monkeypatch.setattr(main.dbmod, "grupos_da_partida", lambda conn, mid: ["g1"])
    monkeypatch.setattr(main.dbmod, "ja_notificado_discord", lambda conn, mid, gid: False)
    monkeypatch.setattr(main.dbmod, "webhook_do_grupo", lambda conn, gid: "https://discord.com/wh")
    resumo = {"map": "de_mirage", "score_grupo": 13, "score_rival": 9, "mvp_nick": "f", "mvp_rating": 1.0}
    monkeypatch.setattr(main.dbmod, "resumo_da_partida_para_grupo", lambda conn, mid, gid: resumo)
    enviados = []
    monkeypatch.setattr(main.discord_notify, "montar_embed", lambda r, mid, url: {"payload": True})
    monkeypatch.setattr(main.discord_notify, "enviar_webhook", lambda url, payload: enviados.append((url, payload)))
    marcados = []
    monkeypatch.setattr(main.dbmod, "marcar_notificado_discord", lambda conn, mid, gid: marcados.append((mid, gid)))
    main._notificar_discord_grupos(config, conn=object(), match_id="m1")
    assert enviados == [("https://discord.com/wh", {"payload": True})]
    assert marcados == [("m1", "g1")]


def test_notificar_discord_nao_derruba_em_erro_de_envio(monkeypatch, capsys):
    config = main.Config(env={"APP_URL": "https://x.com"})
    monkeypatch.setattr(main.dbmod, "grupos_da_partida", lambda conn, mid: ["g1"])
    monkeypatch.setattr(main.dbmod, "ja_notificado_discord", lambda conn, mid, gid: False)
    monkeypatch.setattr(main.dbmod, "webhook_do_grupo", lambda conn, gid: "https://discord.com/wh")
    resumo = {"map": "de_mirage", "score_grupo": 13, "score_rival": 9, "mvp_nick": None, "mvp_rating": None}
    monkeypatch.setattr(main.dbmod, "resumo_da_partida_para_grupo", lambda conn, mid, gid: resumo)
    monkeypatch.setattr(main.discord_notify, "montar_embed", lambda r, mid, url: {})

    def _explode(url, payload):
        raise RuntimeError("timeout")

    monkeypatch.setattr(main.discord_notify, "enviar_webhook", _explode)
    marcados = []
    monkeypatch.setattr(main.dbmod, "marcar_notificado_discord", lambda conn, mid, gid: marcados.append(1))

    class FakeConn:
        def __init__(self):
            self.rollbacks = 0

        def rollback(self):
            self.rollbacks += 1

    conn = FakeConn()
    main._notificar_discord_grupos(config, conn=conn, match_id="m1")  # não deve lançar
    assert marcados == []
    assert conn.rollbacks == 1
    assert "timeout" in capsys.readouterr().out


def test_notificar_discord_pula_grupo_sem_resumo(monkeypatch):
    config = main.Config(env={"APP_URL": "https://x.com"})
    monkeypatch.setattr(main.dbmod, "grupos_da_partida", lambda conn, mid: ["g1"])
    monkeypatch.setattr(main.dbmod, "ja_notificado_discord", lambda conn, mid, gid: False)
    monkeypatch.setattr(main.dbmod, "webhook_do_grupo", lambda conn, gid: "https://discord.com/wh")
    monkeypatch.setattr(main.dbmod, "resumo_da_partida_para_grupo", lambda conn, mid, gid: None)
    enviados = []
    monkeypatch.setattr(main.discord_notify, "enviar_webhook", lambda *a, **k: enviados.append(1))
    main._notificar_discord_grupos(config, conn=object(), match_id="m1")
    assert enviados == []


# ---- _gerar_clipes_allstar (ADR-0004, teste restrito a allowlist) ----

def test_allstar_sem_api_key_nao_faz_nada(monkeypatch):
    config = main.Config(env={"APP_URL": "https://x.com", "ALLSTAR_STEAM_IDS": "765"})
    chamado = []
    monkeypatch.setattr(main.dbmod, "listar_highlights_sem_clipe_allstar", lambda *a, **k: chamado.append(1))
    main._gerar_clipes_allstar(config, conn=None, match_id="m1")
    assert chamado == []


def test_allstar_sem_allowlist_nao_faz_nada(monkeypatch):
    config = main.Config(env={"APP_URL": "https://x.com", "ALLSTAR_API_KEY": "k"})
    chamado = []
    monkeypatch.setattr(main.dbmod, "listar_highlights_sem_clipe_allstar", lambda *a, **k: chamado.append(1))
    main._gerar_clipes_allstar(config, conn=None, match_id="m1")
    assert chamado == []


def test_allstar_sem_pendentes_nao_chama_r2_nem_api(monkeypatch):
    config = main.Config(env={"APP_URL": "https://x.com", "ALLSTAR_API_KEY": "k", "ALLSTAR_STEAM_IDS": "765"})
    monkeypatch.setattr(main.dbmod, "listar_highlights_sem_clipe_allstar", lambda conn, mid, ids: [])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: (_ for _ in ()).throw(AssertionError("não devia chamar")))
    main._gerar_clipes_allstar(config, conn=None, match_id="m1")  # não deve lançar


def test_allstar_pede_clipe_e_grava_request_id(monkeypatch):
    config = main.Config(env={"APP_URL": "https://x.com", "ALLSTAR_API_KEY": "k", "ALLSTAR_STEAM_IDS": "765"})
    highlight = {"id": "h1", "kind": "ace", "steam_id64": "765", "round_number": 14, "nick": "bronze", "demo_url": "https://r2/demos/x.dem.bz2"}
    monkeypatch.setattr(main.dbmod, "listar_highlights_sem_clipe_allstar", lambda conn, mid, ids: [highlight])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "key_from_url", lambda url, bucket: "demos/x.dem.bz2")
    monkeypatch.setattr(main.storage_r2, "presign_download", lambda client, bucket, key: f"https://presigned/{key}")
    pedidos = []
    monkeypatch.setattr(
        main.allstar_notify, "pedir_clipe",
        lambda api_key, kind, sid, nick, demo_url, rn, wh, metadata=None: pedidos.append(
            (api_key, kind, sid, nick, demo_url, rn, wh, metadata)
        ) or "req-1",
    )
    gravados = []
    monkeypatch.setattr(main.dbmod, "criar_allstar_clip", lambda conn, hid, rid: gravados.append((hid, rid)))
    main._gerar_clipes_allstar(config, conn=object(), match_id="m1")
    assert gravados == [("h1", "req-1")]
    api_key, kind, sid, nick, demo_url, rn, wh, metadata = pedidos[0]
    assert (api_key, kind, sid, nick, rn) == ("k", "ace", "765", "bronze", 14)
    assert demo_url == "https://presigned/demos/x.dem.bz2"
    assert wh == "https://x.com/api/allstar/webhook"
    assert metadata == [{"key": "highlightId", "value": "h1"}]


def test_allstar_nao_derruba_em_erro_de_um_highlight(monkeypatch, capsys):
    config = main.Config(env={"APP_URL": "https://x.com", "ALLSTAR_API_KEY": "k", "ALLSTAR_STEAM_IDS": "765"})
    highlight = {"id": "h1", "kind": "ace", "steam_id64": "765", "round_number": 1, "nick": "bronze", "demo_url": "https://r2/x.dem.bz2"}
    monkeypatch.setattr(main.dbmod, "listar_highlights_sem_clipe_allstar", lambda conn, mid, ids: [highlight])
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "key_from_url", lambda url, bucket: "demos/x.dem.bz2")
    monkeypatch.setattr(main.storage_r2, "presign_download", lambda client, bucket, key: "https://presigned/x")

    def _explode(*a, **k):
        raise RuntimeError("Allstar fora do ar")

    monkeypatch.setattr(main.allstar_notify, "pedir_clipe", _explode)

    class FakeConn:
        def __init__(self):
            self.rollbacks = 0

        def rollback(self):
            self.rollbacks += 1

    conn = FakeConn()
    main._gerar_clipes_allstar(config, conn=conn, match_id="m1")  # não deve lançar
    assert conn.rollbacks == 1
    assert "Allstar fora do ar" in capsys.readouterr().out


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
