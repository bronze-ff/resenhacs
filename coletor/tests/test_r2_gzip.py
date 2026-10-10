"""Inventário só-leitura e backfill gzip dos replays. Cliente S3 é fake — não fala com o R2."""

import gzip
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import main, storage_r2
from coletor.config import Config


class _Body:
    def __init__(self, data):
        self._data = data

    def read(self):
        return self._data


class _ListaScriptada:
    def __init__(self, pages, multipart):
        self.pages = pages
        self.multipart = multipart
        self.list_calls = []
        self.multipart_calls = []

    def list_objects_v2(self, **kw):
        self.list_calls.append(kw)
        token = kw.get("ContinuationToken")
        idx = 0 if not token else int(token)
        return self.pages[idx]

    def list_multipart_uploads(self, **kw):
        self.multipart_calls.append(kw)
        if not kw.get("KeyMarker"):
            return self.multipart[0]
        return self.multipart[1]


class _FakeR2:
    def __init__(self, objetos, page_size=1000):
        self.objetos = {o["key"]: dict(o) for o in objetos}
        self.page_size = page_size
        self.deletes = []
        self.puts = []
        self.gets = []
        self.heads = []
        self.fail_put = set()

    def list_objects_v2(self, Bucket, Prefix=None, ContinuationToken=None, **kw):
        chaves = sorted(k for k in self.objetos if not Prefix or k.startswith(Prefix))
        start = int(ContinuationToken or 0)
        fatia = chaves[start:start + self.page_size]
        resp = {
            "Contents": [{"Key": k, "Size": len(self.objetos[k]["body"])} for k in fatia],
            "IsTruncated": start + self.page_size < len(chaves),
        }
        if resp["IsTruncated"]:
            resp["NextContinuationToken"] = str(start + self.page_size)
        return resp

    def head_object(self, Bucket, Key):
        self.heads.append(Key)
        obj = self.objetos[Key]
        head = {
            "ContentLength": len(obj["body"]),
            "ContentType": obj.get("content_type", "application/json"),
        }
        if obj.get("content_encoding"):
            head["ContentEncoding"] = obj["content_encoding"]
        return head

    def get_object(self, Bucket, Key):
        self.gets.append(Key)
        return {"Body": _Body(self.objetos[Key]["body"])}

    def put_object(self, **kw):
        self.puts.append(kw)
        if kw["Key"] in self.fail_put:
            raise RuntimeError("put falhou")
        self.objetos[kw["Key"]] = {
            "key": kw["Key"],
            "body": kw["Body"],
            "content_type": kw.get("ContentType"),
            "content_encoding": kw.get("ContentEncoding"),
        }

    def delete_object(self, **kw):
        self.deletes.append(kw)


def _config_r2():
    return Config(env={
        "R2_ACCOUNT_ID": "acc",
        "R2_ACCESS_KEY_ID": "key",
        "R2_SECRET_ACCESS_KEY": "secret",
        "R2_BUCKET": "resenha-demos",
    })


def test_gzip_bytes_e_estavel_e_descomprime():
    cru = b'{"map":"de_mirage"}'
    assert storage_r2.gzip_bytes(cru) == storage_r2.gzip_bytes(cru)
    assert gzip.decompress(storage_r2.gzip_bytes(cru)) == cru


def test_upload_bytes_so_manda_content_encoding_quando_pedido():
    class Cap:
        def __init__(self):
            self.puts = []

        def put_object(self, **kw):
            self.puts.append(kw)

    s3 = Cap()
    storage_r2.upload_bytes(s3, "b", "k", b"x", content_type="application/json", content_encoding="gzip")
    assert s3.puts[0]["ContentEncoding"] == "gzip"
    assert s3.puts[0]["ContentType"] == "application/json"
    assert s3.puts[0]["Key"] == "k"

    s3 = Cap()
    storage_r2.upload_bytes(s3, "b", "k", b"x")
    assert "ContentEncoding" not in s3.puts[0]


def test_inventariar_soma_por_prefixo_paginado_e_multipart():
    pages = [
        {
            "Contents": [
                {"Key": "replays/a.json", "Size": 100},
                {"Key": "replays/a/round-1.json", "Size": 40},
            ],
            "IsTruncated": True,
            "NextContinuationToken": "1",
        },
        {
            "Contents": [
                {"Key": "demos/a.dem.bz2", "Size": 1000},
                {"Key": "solto.txt", "Size": 5},
                {"Key": "uploads-pendentes/x.dem", "Size": 20},
                {"Key": "partidas-pro-pendentes/y.rar", "Size": 30},
                {"Key": "curso-mira/z.mp4", "Size": 400},
            ],
            "IsTruncated": False,
        },
    ]
    multipart = [
        {
            "Uploads": [{
                "Key": "curso-mira/a.mp4",
                "UploadId": "u1",
                "Initiated": datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc),
            }],
            "IsTruncated": True,
            "NextKeyMarker": "curso-mira/a.mp4",
            "NextUploadIdMarker": "u1",
        },
        {
            "Uploads": [{
                "Key": "uploads-pendentes/b.dem",
                "UploadId": "u2",
                "Initiated": "2026-02-01T00:00:00",
            }],
            "IsTruncated": False,
        },
    ]
    client = _ListaScriptada(pages, multipart)
    rel = storage_r2.inventariar(client, "resenha-demos")

    por = {p["prefixo"]: p for p in rel["prefixos"]}
    assert por["replays"] == {"prefixo": "replays", "objetos": 2, "bytes": 140}
    assert por["demos"]["bytes"] == 1000
    assert por["uploads-pendentes"]["objetos"] == 1
    assert por["partidas-pro-pendentes"]["bytes"] == 30
    assert por["curso-mira"]["bytes"] == 400
    assert por["(raiz)"] == {"prefixo": "(raiz)", "objetos": 1, "bytes": 5}
    assert rel["total"] == {"objetos": 7, "bytes": 1595}
    assert rel["prefixos"][0]["prefixo"] == "demos"
    assert [m["upload_id"] for m in rel["multipart_incompletos"]] == ["u1", "u2"]
    assert rel["multipart_incompletos"][0]["iniciado_em"].startswith("2026-01-02T03:04:05")
    assert client.list_calls[1]["ContinuationToken"] == "1"
    assert client.multipart_calls[1]["KeyMarker"] == "curso-mira/a.mp4"
    assert client.multipart_calls[1]["UploadIdMarker"] == "u1"
    assert client.list_calls[0]["Bucket"] == "resenha-demos"
    assert "Prefix" not in client.list_calls[0]

    texto = storage_r2.formatar_inventario(rel)
    assert "Inventário R2: resenha-demos" in texto
    assert "replays" in texto
    assert "multipart incompletos: 2" in texto
    assert "upload_id=u1" in texto
    assert "TOTAL" in texto
    json.dumps(rel)


def test_inventariar_bucket_vazio():
    client = _ListaScriptada([{"IsTruncated": False}], [{"IsTruncated": False}])
    rel = storage_r2.inventariar(client, "resenha-demos")
    assert rel["total"] == {"objetos": 0, "bytes": 0}
    assert rel["prefixos"] == []
    assert rel["multipart_incompletos"] == []
    assert "TOTAL" in storage_r2.formatar_inventario(rel)


def _replay(nome, cru, encoding=None, content_type="application/json"):
    return {
        "key": nome,
        "body": cru if encoding is None else storage_r2.gzip_bytes(cru),
        "content_type": content_type,
        "content_encoding": encoding,
    }


def test_comprimir_dry_run_nao_grava_e_loga_bytes():
    cru = b'{"round":1,"frames":[' + b'{"t":0},' * 40 + b"{}]}"
    client = _FakeR2([
        _replay("replays/a.json", cru),
        _replay("replays/b.json", b'{"ja":1}', encoding="gzip"),
        {"key": "demos/a.dem.bz2", "body": b"dem-grande" * 20, "content_type": "application/octet-stream"},
    ])
    rel = storage_r2.comprimir_replays(client, "resenha-demos", dry_run=True)

    assert rel["dry_run"] is True
    assert rel["comprimidos"] == 1
    assert rel["pulados"] == 1
    assert rel["falhas"] == 0
    assert rel["bytes_antes"] == len(cru)
    assert rel["bytes_depois"] < rel["bytes_antes"]
    assert client.puts == []
    assert client.deletes == []
    assert client.gets == ["replays/a.json"]
    assert client.objetos["replays/a.json"]["body"] == cru
    assert "demos/a.dem.bz2" not in client.heads
    texto = storage_r2.formatar_comprimir(rel)
    assert "DRY-RUN" in texto
    assert f"{len(cru)} -> {rel['bytes_depois']} bytes" in texto
    assert "PULADO replays/b.json" in texto


def test_comprimir_aplica_na_mesma_chave_e_segunda_run_pula():
    cru = b'{"map":"de_anubis"}' * 30
    client = _FakeR2([
        _replay("replays/a.json", cru, content_type="application/json"),
        _replay("replays/a/round-1.json", b'{"frames":[1,2,3]}' * 20),
        _replay("replays/b.json", b'{"ja":true}', encoding="GZIP"),
    ])
    rel = storage_r2.comprimir_replays(client, "resenha-demos", dry_run=False)

    assert rel["comprimidos"] == 2
    assert rel["pulados"] == 1
    assert client.deletes == []
    assert {p["Key"] for p in client.puts} == {"replays/a.json", "replays/a/round-1.json"}
    for put in client.puts:
        assert put["ContentEncoding"] == "gzip"
        assert put["ContentType"] == "application/json"
        assert put["Bucket"] == "resenha-demos"
    gravado = client.objetos["replays/a.json"]
    assert gravado["content_encoding"] == "gzip"
    assert gravado["content_type"] == "application/json"
    assert gzip.decompress(gravado["body"]) == cru
    assert gzip.decompress(client.objetos["replays/a/round-1.json"]["body"]) == b'{"frames":[1,2,3]}' * 20

    puts_antes = len(client.puts)
    de_novo = storage_r2.comprimir_replays(client, "resenha-demos", dry_run=False)
    assert de_novo["comprimidos"] == 0
    assert de_novo["pulados"] == 3
    assert len(client.puts) == puts_antes
    assert client.deletes == []


def test_comprimir_limit_nao_conta_os_ja_gzip_e_nao_baixa_o_excedente():
    cru = b'{"x":1}' * 50
    client = _FakeR2([
        _replay("replays/a.json", cru),
        _replay("replays/b.json", b'{"ja":1}', encoding="x-gzip"),
        _replay("replays/c.json", cru),
        _replay("replays/d.json", cru),
    ], page_size=1)
    rel = storage_r2.comprimir_replays(client, "resenha-demos", dry_run=False, limit=2)

    assert rel["comprimidos"] == 2
    assert rel["pulados"] == 1
    assert rel["interrompido_por_limit"] is True
    assert client.gets == ["replays/a.json", "replays/c.json"]
    assert "replays/d.json" not in client.heads
    assert [p["Key"] for p in client.puts] == ["replays/a.json", "replays/c.json"]
    assert client.objetos["replays/d.json"]["body"] == cru
    assert client.objetos["replays/d.json"].get("content_encoding") is None
    assert client.deletes == []
    assert "interrompido pelo --limit" in storage_r2.formatar_comprimir(rel)


def test_comprimir_put_que_falha_nao_apaga_e_segue():
    cru_bom = b'{"ok":true}' * 20
    cru_ruim = b'{"ruim":true}' * 20
    client = _FakeR2([
        _replay("replays/bom.json", cru_bom),
        _replay("replays/ruim.json", cru_ruim),
    ])
    client.fail_put.add("replays/ruim.json")
    rel = storage_r2.comprimir_replays(client, "resenha-demos", dry_run=False)

    assert rel["comprimidos"] == 1
    assert rel["falhas"] == 1
    assert client.deletes == []
    assert gzip.decompress(client.objetos["replays/bom.json"]["body"]) == cru_bom
    assert client.objetos["replays/ruim.json"]["body"] == cru_ruim
    assert client.objetos["replays/ruim.json"].get("content_encoding") is None
    falha = next(o for o in rel["objetos"] if o["acao"] == "falha")
    assert falha["key"] == "replays/ruim.json"
    assert "put falhou" in falha["erro"]


def test_comprimir_limit_negativo():
    with pytest.raises(ValueError):
        storage_r2.comprimir_replays(_FakeR2([]), "resenha-demos", limit=-1)


def test_cmd_inventario_r2_imprime_texto_e_json(monkeypatch, capsys):
    relatorio = {
        "bucket": "resenha-demos",
        "prefixos": [{"prefixo": "replays", "objetos": 2, "bytes": 150}],
        "total": {"objetos": 2, "bytes": 150},
        "multipart_incompletos": [],
    }
    monkeypatch.setattr(main.storage_r2, "make_client", lambda config: object())
    monkeypatch.setattr(main.storage_r2, "inventariar", lambda client, bucket: relatorio)
    saida = main.cmd_inventario_r2(_config_r2())
    assert saida == relatorio
    out = capsys.readouterr().out
    assert "Inventário R2: resenha-demos" in out
    assert '"prefixo": "replays"' in out


def test_main_inventario_e_comprimir_nao_abrem_banco(monkeypatch, capsys):
    monkeypatch.setattr(main.dbmod, "connect", lambda *a, **k: pytest.fail("banco"))
    monkeypatch.setattr(main, "cmd_inventario_r2", lambda config: print("inventario-ok"))
    main.main(["inventario-r2"])
    assert "inventario-ok" in capsys.readouterr().out

    vistos = {}

    def fake(config, dry_run=True, limit=None):
        vistos["dry_run"] = dry_run
        vistos["limit"] = limit
        print("comprimir-ok")
        return {"falhas": 0}

    monkeypatch.setattr(main, "cmd_comprimir_replays", fake)
    main.main(["comprimir-replays"])
    assert vistos == {"dry_run": True, "limit": None}

    main.main(["comprimir-replays", "--dry-run", "--limit", "4"])
    assert vistos == {"dry_run": True, "limit": 4}

    main.main(["comprimir-replays", "--no-dry-run", "--limit", "3"])
    assert vistos == {"dry_run": False, "limit": 3}


def test_main_comprimir_falha_sai_1_e_limit_negativo_sai(monkeypatch):
    monkeypatch.setattr(main.dbmod, "connect", lambda *a, **k: pytest.fail("banco"))
    monkeypatch.setattr(main, "cmd_comprimir_replays", lambda *a, **k: {"falhas": 2})
    with pytest.raises(SystemExit) as exc:
        main.main(["comprimir-replays"])
    assert exc.value.code == 1

    with pytest.raises(SystemExit):
        main.main(["comprimir-replays", "--limit", "-1"])
