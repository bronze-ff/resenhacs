import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import main, rar_extract
from coletor.config import Config


def _rdata_com_lineups():
    return {
        "smokes": [
            {
                "round": 1, "x": 100.0, "y": 200.0, "tickStart": 1000, "tickEnd": 1500,
                "thrower": "A", "throwerX": -3230, "throwerY": 1713, "throwerYaw": 90.0, "throwerPitch": 0.0,
            },
            # detonação sem fire correspondente (thrower setado, posição não) — deve
            # ser descartada, não gerar um dict com thrower_x/y = None.
            {
                "round": 2, "x": 50.0, "y": 60.0, "tickStart": 2000, "tickEnd": 2500,
                "thrower": "B", "throwerX": None, "throwerY": None, "throwerYaw": None, "throwerPitch": None,
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
