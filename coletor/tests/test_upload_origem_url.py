"""X-COL: upload da extensão FACEIT (origem_url). O Coletor baixa o link assinado do CDN
da FACEIT com allowlist exata em todo salto, tetos e validação contra a Partida alvo.
O link nunca aparece em log, Sentry nem uploads_pendentes.erro."""

import gzip
import io
import json
import urllib.error
from pathlib import Path
from types import SimpleNamespace

import pytest

from coletor import db, faceit, main, rede
from coletor.storage_r2 import ArquivoGrandeDemaisError

RAIZ = Path(__file__).resolve().parents[2]
HOST = "cdn.demos-teste.example"
LINK = f"https://{HOST}/demos/1-abc.dem.gz?Signature=segredo123&Expires=99"


@pytest.fixture
def allowlist(monkeypatch):
    monkeypatch.setattr(faceit, "FACEIT_DEMO_HOSTS", (HOST,))


# ---- allowlist e validação do link ----

def test_faceit_demo_hosts_igual_ao_json_compartilhado():
    arquivo = RAIZ / "shared/extensao/faceit-demo-hosts.json"
    if arquivo.exists():
        assert faceit.FACEIT_DEMO_HOSTS == tuple(json.loads(arquivo.read_text(encoding="utf-8")))
    else:
        # Até o X-PKG criar o JSON (e o X0 trazer os hosts reais): lista vazia, recusa tudo.
        assert faceit.FACEIT_DEMO_HOSTS == ()


def test_sem_allowlist_toda_url_e_recusada():
    with pytest.raises(rede.HostNaoPermitidoError):
        faceit.validar_origem_url(LINK)


@pytest.mark.parametrize("url", [
    f"http://{HOST}/d.dem.gz",
    f"https://{HOST}/" + "a" * 2048,
    f"https://user:senha@{HOST}/d.dem.gz",
    f"https://{HOST}:8443/d.dem.gz",
    f"https://sub.{HOST}/d.dem.gz",
    "https://outro.com/d.dem.gz",
    "nao-e-url",
])
def test_link_fora_das_regras_e_recusado(allowlist, url):
    with pytest.raises(rede.HostNaoPermitidoError):
        faceit.validar_origem_url(url)


def test_link_valido_passa(allowlist):
    faceit.validar_origem_url(LINK)
    faceit.validar_origem_url(f"https://{HOST}:443/d.dem.gz")


# ---- download: tetos, allowlist em todo salto, link expirado ----

class _Resp:
    def __init__(self, dados, content_length=None):
        self._io = io.BytesIO(dados)
        self.headers = {} if content_length is None else {"Content-Length": str(content_length)}
        self.lidos = 0

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self, n=-1):
        self.lidos += 1
        return self._io.read(n)


def test_baixar_demo_origem_passa_a_allowlist_exata_para_todo_salto(allowlist, monkeypatch):
    pedidos = []

    def _abrir(url, timeout, dominios=None, hosts_exatos=None):
        pedidos.append(hosts_exatos)
        return _Resp(b"gz", content_length=2)

    monkeypatch.setattr(faceit.rede, "abrir_url", _abrir)
    assert faceit.baixar_demo_origem(LINK) == b"gz"
    assert pedidos == [(HOST,)]


def test_content_length_acima_do_teto_recusa_antes_de_ler(allowlist, monkeypatch):
    resp = _Resp(b"x" * 10, content_length=faceit.MAX_DEMO_COMPRIMIDA_BYTES + 1)
    monkeypatch.setattr(faceit.rede, "abrir_url", lambda url, timeout, **kw: resp)
    with pytest.raises(ArquivoGrandeDemaisError):
        faceit.baixar_demo_origem(LINK)
    assert resp.lidos == 0


def test_leitura_acima_do_teto_comprimido_e_recusada(allowlist, monkeypatch):
    monkeypatch.setattr(faceit, "MAX_DEMO_COMPRIMIDA_BYTES", 5)
    monkeypatch.setattr(faceit.rede, "abrir_url", lambda url, timeout, **kw: _Resp(b"x" * 10))
    with pytest.raises(ArquivoGrandeDemaisError):
        faceit.baixar_demo_origem(LINK)


@pytest.mark.parametrize("status", [403, 410])
def test_link_expirado_vira_erro_definitivo_com_a_mensagem_da_revisao_2(allowlist, monkeypatch, status):
    def _abrir(url, timeout, **kw):
        raise urllib.error.HTTPError(url, status, "Forbidden", {}, None)

    monkeypatch.setattr(faceit.rede, "abrir_url", _abrir)
    with pytest.raises(faceit.LinkExpiradoError) as erro:
        faceit.baixar_demo_origem(LINK)
    assert str(erro.value) == "O link da FACEIT expirou. Envie o arquivo baixado pela página da Partida."
    assert erro.value.__suppress_context__


def test_erro_transitorio_sai_sem_o_link(allowlist, monkeypatch):
    def _abrir(url, timeout, **kw):
        raise urllib.error.URLError(f"falhou {url}")

    monkeypatch.setattr(faceit.rede, "abrir_url", _abrir)
    with pytest.raises(faceit.DownloadFaceitError) as erro:
        faceit.baixar_demo_origem(LINK)
    assert HOST not in str(erro.value) and "segredo" not in str(erro.value)
    assert erro.value.__suppress_context__


# ---- fila: ramo origem_url em cmd_processar_uploads_pendentes ----

class _Conn:
    def rollback(self):
        pass

    def commit(self):
        pass


DEMO_GZ = gzip.compress(b"demo")


def _fila(monkeypatch, baixar, arquivo_r2_key="uploads-pendentes/u1.dem.gz", status_falha="pendente"):
    linha = ("u1", "765", arquivo_r2_key, None, None, None, "m-alvo", None, LINK)
    estado = {"atualizacoes": [], "falhas": [], "sentry": [], "ingest": [], "r2_baixado": False, "apagados": []}
    monkeypatch.setattr(main.dbmod, "reverter_uploads_travados", lambda *a, **kw: [])
    monkeypatch.setattr(main.dbmod, "listar_uploads_pendentes", lambda c: [linha])
    monkeypatch.setattr(
        main.dbmod, "atualizar_upload_pendente",
        lambda c, upload_id, status, **kw: estado["atualizacoes"].append((status, kw)),
    )
    monkeypatch.setattr(
        main.dbmod, "falhar_upload_pendente",
        lambda c, upload_id, erro, **kw: estado["falhas"].append(str(erro)) or status_falha,
    )
    monkeypatch.setattr(main.dbmod, "dados_da_partida_alvo", lambda c, mid: {
        "map": "de_nuke", "steam_ids": {"765"}, "source": "faceit", "score_a": 13, "score_b": 7,
    })
    monkeypatch.setattr(main.storage_r2, "make_client", lambda c: "fake")

    def _r2(*a, **kw):
        estado["r2_baixado"] = True
        raise AssertionError("linha com origem_url não lê staging do R2")

    monkeypatch.setattr(main.storage_r2, "download_bytes", _r2)
    def _apagar(client, bucket, key):
        if key is None:
            raise ValueError("key nula")  # o boto3 real recusa Key=None
        estado["apagados"].append(key)

    monkeypatch.setattr(main.storage_r2, "delete_object", _apagar)
    monkeypatch.setattr(main.faceit, "baixar_demo_origem", baixar)
    monkeypatch.setattr(main, "capturar_erro", lambda e, etapa: estado["sentry"].append(e))

    def _ingest(config, conn, path, **kw):
        estado["ingest"].append((Path(path).read_bytes(), kw))
        return "m-alvo"

    monkeypatch.setattr(main, "ingest_demo", _ingest)
    return SimpleNamespace(r2_bucket="demos"), _Conn(), estado


def test_linha_com_origem_url_baixa_da_faceit_e_ingere_com_alvo(monkeypatch, capsys):
    config, conn, estado = _fila(monkeypatch, lambda url: DEMO_GZ)

    assert main.cmd_processar_uploads_pendentes(config, conn) == 1

    dados, kw = estado["ingest"][0]
    assert dados == b"demo"
    assert kw["alvo"]["match_id"] == "m-alvo" and kw["source"] == "faceit"
    assert estado["atualizacoes"][-1][0] == "concluido"
    assert not estado["r2_baixado"]
    assert HOST not in capsys.readouterr().out


@pytest.mark.parametrize("erro", [
    faceit.LinkExpiradoError(),
    rede.HostNaoPermitidoError("host fora da allowlist"),
    ArquivoGrandeDemaisError("demo da FACEIT excedeu o teto"),
])
def test_erro_definitivo_falha_na_hora_sem_retry(monkeypatch, erro):
    def _baixar(url):
        raise erro

    config, conn, estado = _fila(monkeypatch, _baixar)
    main.cmd_processar_uploads_pendentes(config, conn)
    status, kw = estado["atualizacoes"][-1]
    assert status == "falhou" and kw["erro"] == str(erro)
    assert estado["falhas"] == []


def test_link_expirado_grava_a_mensagem_da_revisao_2(monkeypatch):
    def _baixar(url):
        raise faceit.LinkExpiradoError()

    config, conn, estado = _fila(monkeypatch, _baixar)
    main.cmd_processar_uploads_pendentes(config, conn)
    assert estado["atualizacoes"][-1][1]["erro"] == (
        "O link da FACEIT expirou. Envie o arquivo baixado pela página da Partida."
    )


def test_gzip_bomba_da_faceit_falha_definitivo(monkeypatch):
    monkeypatch.setattr(main.faceit, "MAX_DEMO_BYTES", 3)
    config, conn, estado = _fila(monkeypatch, lambda url: DEMO_GZ)
    main.cmd_processar_uploads_pendentes(config, conn)
    assert estado["atualizacoes"][-1][0] == "falhou"
    assert estado["ingest"] == []


def test_erro_transitorio_nao_vaza_o_link_em_log_sentry_nem_erro(monkeypatch, capsys):
    real = faceit.baixar_demo_origem

    def _baixar(url):
        def _abrir(u, timeout, **kw):
            raise urllib.error.URLError(f"conexão recusada para {u}")

        monkeypatch.setattr(faceit.rede, "abrir_url", _abrir)
        monkeypatch.setattr(faceit, "FACEIT_DEMO_HOSTS", (HOST,))
        return real(url)

    config, conn, estado = _fila(monkeypatch, _baixar)
    main.cmd_processar_uploads_pendentes(config, conn)

    saida = capsys.readouterr().out
    vistos = [saida, *estado["falhas"], *(str(e) for e in estado["sentry"])]
    vistos += [str(e.__cause__ or "") for e in estado["sentry"]]
    for texto in vistos:
        assert HOST not in texto and "segredo" not in texto and "Signature" not in texto
    assert estado["falhas"] and all(e.__suppress_context__ for e in estado["sentry"])


def _ok(url):
    return DEMO_GZ


def _expirado(url):
    raise faceit.LinkExpiradoError()


def _transitorio(url):
    raise faceit.DownloadFaceitError("falha transitória (URLError)")


@pytest.mark.parametrize("baixar", [_ok, _expirado, _transitorio])
def test_origem_url_sem_staging_nao_tenta_apagar_do_r2(monkeypatch, baixar):
    # Codex P2 no 880f41f: com arquivo_r2_key null, sucesso e erro apagavam Key=None e
    # geravam erro falso no Sentry.
    config, conn, estado = _fila(monkeypatch, baixar, arquivo_r2_key=None, status_falha="falhou")
    main.cmd_processar_uploads_pendentes(config, conn)
    assert estado["apagados"] == []
    assert not any(isinstance(e, ValueError) for e in estado["sentry"])


# ---- db: origem_url no select e zerada ao terminar ----

class _Cur:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self.conn.execs.append((" ".join(sql.split()), params))

    def fetchall(self):
        return []

    def fetchone(self):
        return ("falhou",)


class _ConnDb:
    def __init__(self):
        self.execs = []

    def cursor(self):
        return _Cur(self)

    def commit(self):
        pass


def test_listar_uploads_pendentes_traz_origem_url_por_ultimo():
    conn = _ConnDb()
    db.listar_uploads_pendentes(conn)
    sql = conn.execs[0][0]
    assert "adicionado_em, origem_url from uploads_pendentes" in sql


@pytest.mark.parametrize("status, zera", [("concluido", True), ("falhou", True), ("pendente", False)])
def test_atualizar_upload_pendente_zera_origem_url_ao_terminar(status, zera):
    conn = _ConnDb()
    db.atualizar_upload_pendente(conn, "u1", status)
    sql = conn.execs[0][0]
    assert ("origem_url = null" in sql) is zera


def test_falhar_upload_pendente_zera_origem_url_quando_esgota():
    conn = _ConnDb()
    db.falhar_upload_pendente(conn, "u1", "erro", max_tentativas=3)
    assert "origem_url = case when tentativas + 1 >= %s then null else origem_url end" in conn.execs[0][0]


def test_reverter_travados_zera_origem_url_quando_esgota():
    conn = _ConnDb()
    db.reverter_uploads_travados(conn)
    assert "origem_url = case when tentativas + 1 >= %s then null else origem_url end" in conn.execs[0][0]
