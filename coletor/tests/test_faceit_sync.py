import sys
import types
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import faceit_sync, main
from coletor import db as dbmod
from coletor import faceit
from coletor.config import Config

AGORA = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)
ONTEM = int((AGORA - timedelta(days=1)).timestamp())


def _ref(v):
    return "#ref"


def _erro_403():
    return urllib.error.HTTPError("https://open.faceit.com/download/v2/demos/download", 403,
                                  "Forbidden", {}, None)


@pytest.fixture
def base(monkeypatch):
    """Banco todo via dbmod monkeypatchado; registra o que cada etapa gravou."""
    gravado = {"enfileiradas": [], "sincronizados": [], "concluidas": [], "marcadas": [],
               "store": [], "extras": [], "agendadas": [], "encerradas": [], "falhas": []}
    monkeypatch.setattr(dbmod, "listar_vinculados_faceit", lambda c: [("76561198000000001", "fid-1")])
    monkeypatch.setattr(dbmod, "faceit_match_ids_conhecidos", lambda c: set())
    monkeypatch.setattr(dbmod, "ultimo_finished_at_faceit", lambda c, s: None)
    monkeypatch.setattr(dbmod, "enfileirar_faceit",
                        lambda c, m, s, f=None: gravado["enfileiradas"].append((m, f)))
    monkeypatch.setattr(dbmod, "marcar_membro_sincronizado_faceit",
                        lambda c, s: gravado["sincronizados"].append(s))
    monkeypatch.setattr(dbmod, "listar_faceit_pendentes", lambda c, limite=10: [])
    monkeypatch.setattr(dbmod, "listar_retries_demo", lambda c, agora, limite=3: [])
    monkeypatch.setattr(dbmod, "store_parsed",
                        lambda c, parsed, **kw: gravado["store"].append((parsed, kw)) or "uuid-stats")
    monkeypatch.setattr(dbmod, "gravar_extras_faceit",
                        lambda c, mid, players: gravado["extras"].append(mid))
    monkeypatch.setattr(dbmod, "marcar_faceit_match", lambda c, mid, fmid: gravado["marcadas"].append((mid, fmid)))
    monkeypatch.setattr(dbmod, "concluir_faceit_pendente", lambda c, fmid: gravado["concluidas"].append(fmid))
    monkeypatch.setattr(dbmod, "falhar_faceit_pendente",
                        lambda c, fmid, erro, **kw: gravado["falhas"].append(fmid))
    monkeypatch.setattr(dbmod, "agendar_retry_demo",
                        lambda c, fmid, prox, n, erro: gravado["agendadas"].append((fmid, prox, n, str(erro))))
    monkeypatch.setattr(dbmod, "encerrar_retry_demo",
                        lambda c, fmid, erro=None: gravado["encerradas"].append((fmid, erro)))
    monkeypatch.setattr(dbmod, "elo_snapshot", lambda c, s: (None, None))
    monkeypatch.setattr(dbmod, "atualizar_elo", lambda c, s, e, l: None)
    monkeypatch.setattr(dbmod, "steam_ids_da_partida", lambda c, mid: set())
    monkeypatch.setattr(faceit, "listar_historico_5v5",
                        lambda *a, **kw: {"novas": [], "na_api": 0, "ja_conhecidas": 0, "ignoradas": 0})
    monkeypatch.setattr(faceit, "elo_atual", lambda key, fid, **kw: (None, None))
    monkeypatch.setattr(faceit, "stats_partida", lambda key, mid, **kw: {"rounds": []})
    monkeypatch.setattr(faceit, "montar_parsed_stats_only",
                        lambda d, s: {"players": [{"steam_id64": "1"}], "map": "de_mirage",
                                      "played_at": "2026-10-15T12:00:00+00:00"})
    return gravado


def _rodar(config=None, ingest_demo=None, **kw):
    conn = types.SimpleNamespace(rollback=lambda: None)
    return faceit_sync.sincronizar(
        config or Config(env={"FACEIT_API_KEY": "k"}), conn,
        ingest_demo=ingest_demo or (lambda *a, **k: "uuid-demo"), ref=_ref, agora=AGORA,
        erros_definitivos=(main.DemoNaoConfereError,), **kw,
    )


def test_sem_api_key_pula(capsys):
    assert _rodar(config=Config(env={})) == 0
    assert "FACEIT_API_KEY" in capsys.readouterr().out


# ---- descoberta ----

def test_descoberta_primeira_varredura_sem_from_e_log_com_contagens_sem_ids(base, monkeypatch, capsys):
    chamadas = []

    def listar(key, fid, ja_vistas, desde=None, ate=None, **kw):
        chamadas.append((fid, desde, ate))
        return {"novas": [{"faceit_match_id": "fm-1", "finished_at": ONTEM}],
                "na_api": 5, "ja_conhecidas": 3, "ignoradas": 1}

    monkeypatch.setattr(faceit, "listar_historico_5v5", listar)
    _rodar()
    assert chamadas == [("fid-1", None, int(AGORA.timestamp()))]
    assert base["enfileiradas"] == [("fm-1", ONTEM)]
    assert base["sincronizados"] == ["76561198000000001"]
    out = capsys.readouterr().out
    assert "5 na API / 3 já conhecida(s) / 1 nova(s)" in out
    assert "histórico inteiro" in out
    assert "76561198000000001" not in out and "fid-1" not in out and "fm-1" not in out


def test_descoberta_usa_ultima_partida_conhecida_menos_margem(base, monkeypatch):
    ultima = datetime(2026, 7, 10, tzinfo=timezone.utc)
    monkeypatch.setattr(dbmod, "ultimo_finished_at_faceit", lambda c, s: ultima)
    desdes = []
    monkeypatch.setattr(faceit, "listar_historico_5v5",
                        lambda key, fid, jv, desde=None, ate=None, **kw: desdes.append(desde) or
                        {"novas": [], "na_api": 0, "ja_conhecidas": 0, "ignoradas": 0})
    _rodar()
    assert desdes == [int((ultima - faceit_sync.MARGEM_DESCOBERTA).timestamp())]


def test_descoberta_que_falha_nao_marca_sincronizado(base, monkeypatch, capsys):
    def explode(*a, **kw):
        raise RuntimeError("api 500")

    monkeypatch.setattr(faceit, "listar_historico_5v5", explode)
    _rodar()
    assert base["sincronizados"] == []
    assert "FALHOU" in capsys.readouterr().out


# ---- fila ----

def _detalhes(demo=True, finished_at=ONTEM):
    return {"demo_url": ["https://demos.faceit.com/x.dem.gz"] if demo else [],
            "finished_at": finished_at, "teams": {}, "results": {}}


def test_fila_com_demo_ingere_pelo_pipeline_completo(base, monkeypatch):
    monkeypatch.setattr(dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 0)])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes())
    monkeypatch.setattr(faceit, "baixar_demo", lambda key, url, **kw: b"dem")
    recebidos = []
    total = _rodar(ingest_demo=lambda config, conn, path, **kw: recebidos.append(kw) or "uuid-demo")
    assert total == 1
    assert recebidos[0]["source"] == "faceit" and "alvo" not in recebidos[0]
    assert base["marcadas"] == [("uuid-demo", "fm1")]
    assert base["store"] == [] and base["agendadas"] == []


def test_fila_403_entra_so_com_estatisticas_agenda_retry_e_avisa_uma_vez(base, monkeypatch, capsys):
    monkeypatch.setattr(dbmod, "listar_faceit_pendentes",
                        lambda c, limite=10: [("fm1", "111", 0), ("fm2", "111", 0)])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes())
    downloads = []

    def baixar(key, url, **kw):
        downloads.append(url)
        raise _erro_403()

    monkeypatch.setattr(faceit, "baixar_demo", baixar)
    total = _rodar()
    assert total == 2
    assert len(downloads) == 1  # depois do 403 a rodada não tenta de novo
    assert [m for m, *_ in base["agendadas"]] == ["fm1", "fm2"]
    assert base["agendadas"][0][1] == AGORA + faceit_sync.espera_retry(1)
    assert base["agendadas"][0][2] == 1
    assert base["extras"] == ["uuid-stats", "uuid-stats"]
    assert base["concluidas"] == ["fm1", "fm2"]
    out = capsys.readouterr().out
    assert out.count("Downloads API sem acesso (403)") == 1


def test_fila_outro_erro_de_demo_loga_o_erro_e_agenda(base, monkeypatch, capsys):
    monkeypatch.setattr(dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 0)])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes())
    monkeypatch.setattr(faceit, "baixar_demo",
                        lambda key, url, **kw: (_ for _ in ()).throw(RuntimeError("demo not ready")))
    _rodar()
    out = capsys.readouterr().out
    # Log público: só o tipo do erro, nunca a mensagem crua.
    assert "RuntimeError" in out and "demo not ready" not in out and "403" not in out
    assert len(base["agendadas"]) == 1


def test_fila_partida_velha_sem_demo_nao_agenda(base, monkeypatch):
    velha = int((AGORA - timedelta(days=40)).timestamp())
    monkeypatch.setattr(dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 0)])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes(finished_at=velha))
    monkeypatch.setattr(faceit, "baixar_demo",
                        lambda key, url, **kw: (_ for _ in ()).throw(RuntimeError("expirada")))
    assert _rodar() == 1
    assert base["agendadas"] == [] and len(base["store"]) == 1


def test_fila_sem_demo_url_agenda_nova_tentativa(base, monkeypatch):
    # A FACEIT costuma publicar a demo_url um tempo depois do fim da partida.
    monkeypatch.setattr(dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 0)])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes(demo=False))
    assert _rodar() == 1
    assert base["agendadas"] == [("fm1", AGORA + timedelta(hours=1), 1, "Demo ainda não disponível na FACEIT")]
    assert base["store"][0][1]["source"] == "faceit"


def test_fila_stats_only_avisa_no_discord(base, monkeypatch):
    from coletor import discord
    avisadas = []
    monkeypatch.setattr(discord, "notificar_partida", lambda conn, mid, **kw: avisadas.append(mid))
    monkeypatch.setattr(dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 0)])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes(demo=False))
    _rodar()
    assert avisadas == ["uuid-stats"]


def test_fila_falha_no_discord_nao_derruba_a_importacao(base, monkeypatch):
    from coletor import discord

    def falha(conn, mid, **kw):
        raise RuntimeError("discord fora")

    monkeypatch.setattr(discord, "notificar_partida", falha)
    monkeypatch.setattr(dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 0)])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes(demo=False))
    assert _rodar() == 1
    assert base["falhas"] == []


def test_fila_falha_de_item_nao_derruba_o_lote(base, monkeypatch):
    monkeypatch.setattr(dbmod, "listar_faceit_pendentes",
                        lambda c, limite=10: [("fm-ruim", "111", 0), ("fm-bom", "111", 0)])

    def detalhes(key, mid, **kw):
        if mid == "fm-ruim":
            raise RuntimeError("api 500")
        return _detalhes(demo=False)

    monkeypatch.setattr(faceit, "detalhes_partida", detalhes)
    assert _rodar() == 1
    assert base["falhas"] == ["fm-ruim"]


def test_elo_carimba_a_partida_nova_mais_recente(base, monkeypatch):
    antes_dt = AGORA - timedelta(days=2)
    monkeypatch.setattr(dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 0)])
    monkeypatch.setattr(dbmod, "listar_vinculados_faceit", lambda c: [("111", "f-111")])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes())
    monkeypatch.setattr(faceit, "baixar_demo", lambda key, url, **kw: b"dem")
    monkeypatch.setattr(faceit, "elo_atual", lambda key, fid, **kw: (1425, 7))
    monkeypatch.setattr(dbmod, "elo_snapshot", lambda c, s: (1400, antes_dt))
    gravado = []
    monkeypatch.setattr(dbmod, "gravar_elo_partida", lambda c, mid, s, b, a: gravado.append((mid, s, b, a)))
    _rodar()
    assert gravado == [("uuid-demo", "111", 1400, 1425)]


# ---- re-tentativa da Demo ----

def _retry(tentativas=1, finished=None, match_id="uuid-m", tem_demo=False):
    return ("fm1", "111", tentativas, finished or (AGORA - timedelta(days=3)), match_id, tem_demo)


def test_retry_recupera_demo_na_mesma_partida(base, monkeypatch, capsys):
    monkeypatch.setattr(dbmod, "listar_retries_demo", lambda c, agora, limite=3: [_retry()])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes())
    monkeypatch.setattr(faceit, "baixar_demo", lambda key, url, **kw: b"dem")
    monkeypatch.setattr(dbmod, "dados_da_partida_alvo", lambda c, mid: {
        "map": "de_mirage", "steam_ids": {"1", "2"}, "source": "faceit", "score_a": 13, "score_b": 9})
    recebidos = []
    _rodar(ingest_demo=lambda config, conn, path, **kw: recebidos.append(kw) or "uuid-m")
    assert recebidos[0]["alvo"]["match_id"] == "uuid-m"
    assert recebidos[0]["alvo"]["steam_ids"] == {"1", "2"}
    assert recebidos[0]["source"] == "faceit"
    assert base["encerradas"] == [("fm1", None)]
    assert "1 Demo(s) recuperada(s)" in capsys.readouterr().out


def test_retry_403_reagenda_com_espera_diaria(base, monkeypatch):
    monkeypatch.setattr(dbmod, "listar_retries_demo", lambda c, agora, limite=3: [_retry(tentativas=4)])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes())
    monkeypatch.setattr(dbmod, "dados_da_partida_alvo", lambda c, mid: {
        "map": "de_mirage", "steam_ids": {"1"}, "source": "faceit", "score_a": 1, "score_b": 0})
    monkeypatch.setattr(faceit, "baixar_demo", lambda key, url, **kw: (_ for _ in ()).throw(_erro_403()))
    _rodar()
    assert base["agendadas"][0][0] == "fm1"
    assert base["agendadas"][0][1] == AGORA + timedelta(days=1)
    assert base["agendadas"][0][2] == 5


def test_retry_fora_da_janela_encerra_sem_chamar_api(base, monkeypatch):
    monkeypatch.setattr(dbmod, "listar_retries_demo", lambda c, agora, limite=3: [
        _retry(finished=AGORA - timedelta(days=29))])
    monkeypatch.setattr(faceit, "detalhes_partida",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("não devia chamar")))
    _rodar()
    assert base["encerradas"][0][0] == "fm1" and "4 semanas" in base["encerradas"][0][1]


def test_retry_sem_demo_url_reagenda_em_vez_de_encerrar(base, monkeypatch):
    monkeypatch.setattr(dbmod, "listar_retries_demo", lambda c, agora, limite=3: [_retry()])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes(demo=False))
    _rodar()
    assert base["encerradas"] == []
    assert len(base["agendadas"]) == 1
    assert base["agendadas"][0][0] == "fm1"
    assert base["agendadas"][0][3] == "Demo ainda não disponível na FACEIT"


def test_retry_partida_que_ja_tem_demo_encerra(base, monkeypatch):
    monkeypatch.setattr(dbmod, "listar_retries_demo", lambda c, agora, limite=3: [_retry(tem_demo=True)])
    _rodar()
    assert base["encerradas"] == [("fm1", None)]


def test_retry_demo_que_nao_confere_encerra(base, monkeypatch):
    monkeypatch.setattr(dbmod, "listar_retries_demo", lambda c, agora, limite=3: [_retry()])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes())
    monkeypatch.setattr(faceit, "baixar_demo", lambda key, url, **kw: b"dem")
    monkeypatch.setattr(dbmod, "dados_da_partida_alvo", lambda c, mid: {
        "map": "de_mirage", "steam_ids": {"1"}, "source": "faceit", "score_a": 1, "score_b": 0})

    def ingest(*a, **kw):
        raise main.DemoNaoConfereError("os jogadores da demo não são os desta partida")

    _rodar(ingest_demo=ingest)
    assert base["encerradas"][0][0] == "fm1"
    assert base["agendadas"] == []


def test_espera_retry_escalona_ate_diaria():
    assert faceit_sync.espera_retry(1) == timedelta(hours=1)
    assert faceit_sync.espera_retry(2) == timedelta(hours=6)
    assert faceit_sync.espera_retry(3) == timedelta(days=1)
    assert faceit_sync.espera_retry(10) == timedelta(days=1)


def test_cmd_sincronizar_faceit_delega_com_ingest_demo_do_main(base, monkeypatch):
    monkeypatch.setattr(dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 0)])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes())
    monkeypatch.setattr(faceit, "baixar_demo", lambda key, url, **kw: b"dem")
    monkeypatch.setattr(main, "ingest_demo", lambda config, conn, path, **kw: "uuid-main")
    conn = types.SimpleNamespace(rollback=lambda: None)
    assert main.cmd_sincronizar_faceit(Config(env={"FACEIT_API_KEY": "k"}), conn) == 1
    assert base["marcadas"] == [("uuid-main", "fm1")]


# ---- R02: erro por item vai pro Sentry com a etapa ----

@pytest.fixture
def capturados(monkeypatch):
    lista = []
    monkeypatch.setattr(faceit_sync, "capturar_erro", lambda e, etapa: lista.append((e, etapa)))
    return lista


def test_fila_falha_de_item_captura_com_etapa(base, monkeypatch, capturados, capsys):
    erro = RuntimeError("api 500 com corpo")
    monkeypatch.setattr(dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 0)])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: (_ for _ in ()).throw(erro))
    _rodar()
    assert capturados == [(erro, "sincronizar-faceit")]
    assert "api 500 com corpo" not in capsys.readouterr().out


def test_descoberta_que_falha_captura_com_etapa(base, monkeypatch, capturados, capsys):
    erro = RuntimeError("timeout com url")
    monkeypatch.setattr(faceit, "listar_historico_5v5", lambda *a, **kw: (_ for _ in ()).throw(erro))
    _rodar()
    assert capturados == [(erro, "sincronizar-faceit")]
    assert "timeout com url" not in capsys.readouterr().out


def test_erro_de_demo_que_nao_e_403_captura(base, monkeypatch, capturados):
    erro = RuntimeError("demo not ready")
    monkeypatch.setattr(dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 0)])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes())
    monkeypatch.setattr(faceit, "baixar_demo", lambda key, url, **kw: (_ for _ in ()).throw(erro))
    _rodar()
    assert capturados == [(erro, "sincronizar-faceit")]


def test_403_da_downloads_api_nao_vai_pro_sentry(base, monkeypatch, capturados):
    # Sem acesso à Downloads API é estado conhecido (aviso no log), não erro.
    monkeypatch.setattr(dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 0)])
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes())
    monkeypatch.setattr(faceit, "baixar_demo", lambda key, url, **kw: (_ for _ in ()).throw(_erro_403()))
    _rodar()
    assert capturados == []


def test_elo_que_falha_captura_com_etapa(base, monkeypatch, capturados):
    erro = RuntimeError("elo fora")
    monkeypatch.setattr(faceit, "elo_atual", lambda key, fid, **kw: (_ for _ in ()).throw(erro))
    _rodar()
    assert capturados == [(erro, "sincronizar-faceit")]


# ---- R113: ELO pra todos os vinculados do roster, não só quem enfileirou ----

def test_elo_carimba_os_dois_vinculados_da_mesma_partida(base, monkeypatch):
    antes_dt = AGORA - timedelta(days=2)
    monkeypatch.setattr(dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", 0)])
    monkeypatch.setattr(dbmod, "listar_vinculados_faceit", lambda c: [("111", "f-111"), ("222", "f-222")])
    monkeypatch.setattr(dbmod, "steam_ids_da_partida", lambda c, mid: {"111", "222", "999"})
    monkeypatch.setattr(faceit, "detalhes_partida", lambda key, mid, **kw: _detalhes())
    monkeypatch.setattr(faceit, "baixar_demo", lambda key, url, **kw: b"dem")
    monkeypatch.setattr(faceit, "elo_atual", lambda key, fid, **kw: (1500 if fid == "f-222" else 1425, 7))
    monkeypatch.setattr(dbmod, "elo_snapshot", lambda c, s: (1400, antes_dt))
    gravado = []
    monkeypatch.setattr(dbmod, "gravar_elo_partida", lambda c, mid, s, b, a: gravado.append((mid, s, b, a)))
    _rodar()
    assert sorted(gravado) == [("uuid-demo", "111", 1400, 1425), ("uuid-demo", "222", 1400, 1500)]
