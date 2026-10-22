import gzip
from types import SimpleNamespace

import pytest

from coletor import main


class _Conn:
    def rollback(self):
        pass

    def commit(self):
        pass


def _configurar_fila(monkeypatch, key, dados, alvo_id=None):
    config = SimpleNamespace(r2_bucket="demos")
    conn = _Conn()
    linha = ("u1", "765", key, None, None, None, alvo_id, None)
    atualizacoes = []
    apagados = []

    monkeypatch.setattr(main.dbmod, "reverter_uploads_travados", lambda *a, **kw: [])
    monkeypatch.setattr(main.dbmod, "listar_uploads_pendentes", lambda c: [linha])
    monkeypatch.setattr(
        main.dbmod, "atualizar_upload_pendente",
        lambda c, upload_id, status, **kw: atualizacoes.append((status, kw)),
    )
    monkeypatch.setattr(main.storage_r2, "make_client", lambda c: "fake")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda *a, **kw: dados)
    monkeypatch.setattr(
        main.storage_r2, "delete_object",
        lambda client, bucket, object_key: apagados.append(object_key),
    )
    return config, conn, atualizacoes, apagados


def _configurar_ingest_real(monkeypatch, parsed, capturas):
    def parse_demo(path):
        dados = path.read_bytes()
        capturas.append(dados)
        return {**parsed}

    monkeypatch.setattr(main.parsemod, "parse_demo", parse_demo)
    monkeypatch.setattr(main.transform, "fill_kd_from_kills", lambda players, kills: players)
    monkeypatch.setattr(main.transform, "enrich", lambda dados: dados)
    monkeypatch.setattr(main.parsemod, "extract_replay", lambda path: (_ for _ in ()).throw(RuntimeError("sem replay")))
    monkeypatch.setattr(main, "_atualizar_avatares", lambda *a, **kw: None)
    monkeypatch.setattr(main.discord, "notificar_partida", lambda *a, **kw: None)
    finalizados = []

    def finalizar(config, conn, dados, replay, path, share_code, source, upload, played_at, **kw):
        finalizados.append((dados, source, upload, played_at, kw))
        return "m1"

    monkeypatch.setattr(main, "_finalizar_ingest", finalizar)
    return finalizados


@pytest.mark.parametrize("extensao", [".dem", ".dem.gz"])
def test_upload_generico_chega_ao_parser_e_preserva_participacao(monkeypatch, extensao):
    conteudo = b"demo cru"
    key = f"uploads-pendentes/a{extensao}"
    config, conn, atualizacoes, apagados = _configurar_fila(
        monkeypatch, key, gzip.compress(conteudo) if extensao == ".dem.gz" else conteudo
    )
    capturas = []
    finalizados = _configurar_ingest_real(
        monkeypatch,
        {
            "map": "de_inferno",
            "players": [{"steam_id64": "765"}, {"steam_id64": "B"}],
            "kills": [],
            "rounds": [],
            "score_a": 13,
            "score_b": 7,
        },
        capturas,
    )

    assert main.cmd_processar_uploads_pendentes(config, conn) == 1

    assert capturas == [conteudo]
    assert finalizados[0][1:4] == ("upload", True, None)
    assert apagados == [key]
    assert atualizacoes[-1][0] == "concluido"


def test_upload_dem_gz_sem_participacao_e_recusado_por_i6(monkeypatch):
    key = "uploads-pendentes/a.dem.gz"
    config, conn, atualizacoes, apagados = _configurar_fila(monkeypatch, key, gzip.compress(b"demo"))
    monkeypatch.setattr(main.dbmod, "amigos_aceitos", lambda c, steam_id: set())
    finalizados = _configurar_ingest_real(monkeypatch, {
        "map": "de_inferno", "players": [{"steam_id64": "OUTRO"}], "kills": [], "rounds": [],
    }, [])

    assert main.cmd_processar_uploads_pendentes(config, conn) == 0
    assert finalizados == []
    assert apagados == [key]
    assert atualizacoes[-1] == ("falhou", {"erro": main.MSG_SEM_PARTICIPACAO})


def test_upload_dem_gz_descomprime_antes_do_parser_e_preserva_alvo(monkeypatch):
    conteudo = b"demo FACEIT"
    alvo_id = "match-alvo"
    config, conn, atualizacoes, apagados = _configurar_fila(
        monkeypatch, "uploads-pendentes/a.dem.gz", gzip.compress(conteudo), alvo_id
    )
    monkeypatch.setattr(
        main.dbmod, "dados_da_partida_alvo",
        lambda c, match_id: {
            "map": "de_inferno", "steam_ids": {"A", "B"},
            "score_a": 13, "score_b": 7, "source": "faceit",
        },
    )
    capturas = []
    finalizados = _configurar_ingest_real(
        monkeypatch,
        {
            "map": "de_inferno",
            "players": [{"steam_id64": "A"}, {"steam_id64": "B"}],
            "kills": [],
            "rounds": [],
            "score_a": 7,
            "score_b": 13,
        },
        capturas,
    )

    assert main.cmd_processar_uploads_pendentes(config, conn) == 1

    assert capturas == [conteudo]
    parsed, source, upload, played_at, kw = finalizados[0]
    assert source == "faceit"
    assert upload is True
    assert played_at is None
    assert parsed["players"] == [{"steam_id64": "A"}, {"steam_id64": "B"}]
    assert kw["match_id_alvo"] == alvo_id
    assert apagados == ["uploads-pendentes/a.dem.gz"]
    assert atualizacoes[-1][0] == "concluido"


@pytest.mark.parametrize("divergencia", [
    {"map": "de_mirage"},
    {"players": [{"steam_id64": "A"}, {"steam_id64": "C"}]},
    {"score_b": 9},
], ids=["mapa", "jogadores", "placar"])
def test_upload_dem_gz_divergente_e_recusado_antes_do_replay(monkeypatch, divergencia):
    config, conn, atualizacoes, apagados = _configurar_fila(
        monkeypatch, "uploads-pendentes/a.dem.gz", gzip.compress(b"demo"), "match-alvo"
    )
    monkeypatch.setattr(
        main.dbmod, "dados_da_partida_alvo",
        lambda c, match_id: {
            "map": "de_inferno", "steam_ids": {"A", "B"},
            "score_a": 13, "score_b": 7, "source": "faceit",
        },
    )
    replay_chamado = []
    monkeypatch.setattr(
        main.parsemod, "parse_demo",
        lambda path: {
            "map": "de_inferno",
            "players": [{"steam_id64": "A"}, {"steam_id64": "B"}],
            "kills": [],
            "rounds": [],
            "score_a": 13,
            "score_b": 7,
            **divergencia,
        },
    )
    monkeypatch.setattr(main.transform, "fill_kd_from_kills", lambda players, kills: players)
    monkeypatch.setattr(main.transform, "enrich", lambda dados: dados)
    monkeypatch.setattr(main.parsemod, "extract_replay", lambda path: replay_chamado.append(path))
    finalizados = []
    monkeypatch.setattr(main, "_finalizar_ingest", lambda *a, **kw: finalizados.append(a))

    assert main.cmd_processar_uploads_pendentes(config, conn) == 0

    assert replay_chamado == []
    assert finalizados == []
    assert apagados == ["uploads-pendentes/a.dem.gz"]
    assert atualizacoes[-1][0] == "falhou"


def test_upload_dem_gz_acima_do_teto_e_definitivo_sem_chamar_parser(monkeypatch):
    config, conn, atualizacoes, apagados = _configurar_fila(
        monkeypatch, "uploads-pendentes/a.dem.gz", gzip.compress(b"12345")
    )
    monkeypatch.setattr(main, "_MAX_UPLOAD_BYTES", 4)
    parse_chamado = []
    monkeypatch.setattr(main.parsemod, "parse_demo", lambda path: parse_chamado.append(path))

    assert main.cmd_processar_uploads_pendentes(config, conn) == 0
    assert parse_chamado == []
    assert apagados == ["uploads-pendentes/a.dem.gz"]
    assert atualizacoes[-1][0] == "falhou"


def test_upload_dem_gz_invalido_e_definitivo_sem_chamar_parser(monkeypatch):
    config, conn, atualizacoes, apagados = _configurar_fila(
        monkeypatch, "uploads-pendentes/a.dem.gz", gzip.compress(b"demo")[:-3]
    )
    parse_chamado = []
    monkeypatch.setattr(main.parsemod, "parse_demo", lambda path: parse_chamado.append(path))
    monkeypatch.setattr(main.transform, "fill_kd_from_kills", lambda players, kills: players)
    monkeypatch.setattr(main.transform, "enrich", lambda dados: dados)
    monkeypatch.setattr(main, "_finalizar_ingest", lambda *a, **kw: "m1")

    assert main.cmd_processar_uploads_pendentes(config, conn) == 0

    assert parse_chamado == []
    assert apagados == ["uploads-pendentes/a.dem.gz"]
    assert atualizacoes[-1] == ("falhou", {"erro": "arquivo .dem.gz inválido"})
