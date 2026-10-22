import json

import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor.observabilidade import REDACTED, minimizar_evento, minimizar_span, before_breadcrumb, redigir_string
from coletor.palavras import PADRAO, chave_sensivel

RAIZ = Path(__file__).resolve().parents[2]
CASOS = json.loads((RAIZ / "shared/observabilidade/casos-palavras.json").read_text(encoding="utf-8"))

STEAM = "76561198000000000"


def test_request_fica_so_com_method_e_caminho():
    evento = minimizar_evento({
        "request": {
            "method": "GET",
            "url": "https://resenhacs.vercel.app/api/matches/abc?token=segredo#x",
            "headers": {"cookie": "a=b"},
            "cookies": {"a": "b"},
            "data": {"senha": "x"},
            "query_string": "token=segredo",
        }
    })
    assert evento["request"] == {
        "method": "GET",
        "url": "https://resenhacs.vercel.app/api/matches/abc",
    }


def test_allowlist_do_topo_descarta_o_resto_e_percorre_o_sdk():
    sdk = {"name": "sentry-sdk", "packages": [{"name": "token-interno"}]}
    evento = minimizar_evento({
        "event_id": "abc123",
        "sdk": sdk,
        "message": "falha lendo cookie da sessao",
        "extra": {"nota": "email a@b.com no texto"},
        "logger": "coletor",
        "profile": {"token": "x"},
        "debug_meta": {"images": []},
        "tags": {"nota": "email a@b.com no texto"},
        "contexts": {"trace": {"trace_id": "abc"}, "os": {"name": "Linux"}},
    })
    assert evento["event_id"] == "abc123"
    assert evento["sdk"] == {"name": "sentry-sdk", "packages": [{"name": REDACTED}]}
    assert evento["sdk"] is not sdk
    assert evento["message"] == REDACTED
    assert "extra" not in evento
    assert "logger" not in evento
    assert "profile" not in evento
    assert "debug_meta" not in evento
    assert evento["tags"]["nota"] == REDACTED
    assert evento["contexts"] == {"trace": {"trace_id": "abc"}}
    assert minimizar_evento({"event_id": "token-nao-mexer"})["event_id"] == REDACTED


def test_casos_compartilhados_e_padrao_igual_ao_javascript():
    for amostra in CASOS["redige"]:
        assert redigir_string(amostra) == REDACTED
        assert minimizar_evento({"message": amostra})["message"] == REDACTED
    for amostra in CASOS["intactos"]:
        assert redigir_string(amostra) == amostra
    for chave in CASOS["chavesSensiveis"]:
        assert chave_sensivel(chave)
        tags = minimizar_evento({"tags": {chave: "valor-limpo"}})["tags"]
        assert tags.get(chave, REDACTED) == REDACTED
    for chave in CASOS["chavesLivres"]:
        assert not chave_sensivel(chave)
    for amostra in CASOS["telefones"]:
        assert redigir_string(f"liga {amostra} agora") == REDACTED
        assert minimizar_evento({"message": f"liga {amostra} agora"})["message"] == REDACTED
    for amostra in CASOS["naoTelefone"]:
        assert redigir_string(amostra) == amostra
        assert minimizar_evento({"message": amostra})["message"] == amostra
    texto = (RAIZ / "site/server/src/observabilidade/palavras.js").read_text(encoding="utf-8")
    inicio = texto.index("export const PALAVRA =\n  /") + len("export const PALAVRA =\n  /")
    fim = texto.index("/i", inicio)
    assert texto[inicio:fim] == PADRAO


def test_telefone_fixo_e_celular():
    amostras = [
        "(11) 3456-7890",
        "+55 (11) 3456-7890",
        "1134567890",
        "11.3456.7890",
        "(11) 91234-5678",
        "+55 11 9 1234-5678",
        "11912345678",
        "3333-4444",
        "3333 4444",
        "33334444",
        "91234-5678",
        "91234 5678",
        "912345678",
    ]
    for amostra in amostras:
        assert minimizar_evento({"message": f"liga {amostra}"})["message"] == REDACTED
    intactos = [
        STEAM,
        "2026-10-12",
        "12/10/2026",
        "2026-10-12T21:00:00Z",
        "placar 13-9",
        "placar 16-14",
        "placar 13:9",
        "empate 12:12",
    ]
    for amostra in intactos:
        assert minimizar_evento({"message": amostra})["message"] == amostra


def test_caminho_relativo_perde_query_e_resenha_nao_vira_senha():
    evento = minimizar_evento({"request": {"url": "/api/auth/me?code=1"}})
    assert evento["request"]["url"] == "/api/auth/me"
    assert minimizar_evento({"message": "access_token vazou"})["message"] == REDACTED


def test_steam_id_nao_e_tratado_como_cpf():
    evento = minimizar_evento({"user": {"id": STEAM, "email": "a@b.com", "username": "nick"}})
    assert evento["user"] == {"id": STEAM}


def test_init_com_dsn_nao_quebra(monkeypatch):
    import sentry_sdk

    import coletor.observabilidade as obs

    monkeypatch.setenv("SENTRY_DSN", "https://public@o0.ingest.sentry.io/0")
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "dev")
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    obs._ativo = False
    cliente = None
    try:
        assert obs.init_sentry() is True
        partes = tuple(int(p) for p in sentry_sdk.VERSION.split(".")[:3])
        assert partes >= (2, 67, 0)
        cliente = sentry_sdk.get_client()
        assert cliente.options["before_send_span"] is obs.before_send_span
    finally:
        obs._ativo = False
        if cliente is not None:
            cliente.close(timeout=0)


def test_init_sem_dsn_nao_ativa(monkeypatch):
    import coletor.observabilidade as obs

    monkeypatch.delenv("SENTRY_DSN", raising=False)
    obs._ativo = False
    assert obs.init_sentry() is False
    assert obs.em_monitor_discover(lambda: "ok") == "ok"


def test_console_sai_e_span_perde_query():
    assert before_breadcrumb({"category": "console", "message": "oi"}, None) is None
    span = minimizar_span({
        "span_id": "abc",
        "trace_id": "def",
        "description": "GET https://api.exemplo.com/v1/jogadores?codigo=1",
        "data": {"http.query": "codigo=1", "http.url": "https://api.exemplo.com/v1/jogadores?codigo=1"},
    })
    assert span["span_id"] == "abc"
    assert span["description"] == "GET https://api.exemplo.com/v1/jogadores"
    assert "http.query" not in span["data"]
    assert span["data"]["http.url"] == "https://api.exemplo.com/v1/jogadores"


# ---- R02: capturar_erro manda o erro por item ao Sentry, com a etapa ----

class _SdkFake:
    def __init__(self):
        self.capturados = []
        self.tags = []

    def new_scope(self):
        sdk = self

        class _Escopo:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def set_tag(self, chave, valor):
                sdk.tags.append((chave, valor))

        return _Escopo()

    def capture_exception(self, erro):
        self.capturados.append((erro, list(self.tags)))


def test_capturar_erro_sem_dsn_e_no_op(monkeypatch):
    import coletor.observabilidade as obs

    sdk = _SdkFake()
    monkeypatch.setitem(sys.modules, "sentry_sdk", sdk)
    monkeypatch.setattr(obs, "_ativo", False)
    obs.capturar_erro(RuntimeError("x"), "fetch")
    assert sdk.capturados == []


def test_capturar_erro_com_sdk_ativo_marca_a_etapa(monkeypatch):
    import coletor.observabilidade as obs

    sdk = _SdkFake()
    monkeypatch.setitem(sys.modules, "sentry_sdk", sdk)
    monkeypatch.setattr(obs, "_ativo", True)
    erro = RuntimeError("x")
    obs.capturar_erro(erro, "uploads")
    assert sdk.capturados == [(erro, [("etapa", "uploads")])]


def test_capturar_erro_nunca_derruba_quem_chama(monkeypatch):
    import coletor.observabilidade as obs

    class _SdkQuebrado(_SdkFake):
        def capture_exception(self, erro):
            raise OSError("transporte caiu")

    monkeypatch.setitem(sys.modules, "sentry_sdk", _SdkQuebrado())
    monkeypatch.setattr(obs, "_ativo", True)
    obs.capturar_erro(RuntimeError("x"), "fetch")


def test_tag_etapa_sobrevive_ao_scrub():
    evento = minimizar_evento({"tags": {"etapa": "processar-uploads-pendentes"}})
    assert evento["tags"] == {"etapa": "processar-uploads-pendentes"}



# ---- R112: check-in do cron do discover (ok / error com o mesmo check_in_id) ----

def _crons_fake(monkeypatch):
    import types as _types
    import coletor.observabilidade as obs

    checkins = []

    def capture_checkin(monitor_slug=None, check_in_id=None, status=None, duration=None, monitor_config=None):
        checkins.append({"slug": monitor_slug, "id": check_in_id, "status": status,
                         "config": monitor_config})
        return check_in_id or "ck-1"

    monkeypatch.setitem(sys.modules, "sentry_sdk.crons", _types.SimpleNamespace(capture_checkin=capture_checkin))
    monkeypatch.setattr(obs, "_ativo", True)
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "producao")
    capturados = []
    monkeypatch.setattr(obs, "capturar_erro", lambda e, etapa: capturados.append((str(e), etapa)))
    return obs, checkins, capturados


def test_monitor_discover_parcial_ou_ok_fecha_check_in_ok(monkeypatch):
    obs, checkins, capturados = _crons_fake(monkeypatch)
    assert obs.em_monitor_discover(lambda: 3) == 3
    assert [c["status"] for c in checkins] == ["in_progress", "ok"]
    assert checkins[0]["slug"] == "resenhacs-coletor" and checkins[0]["config"] == obs.MONITOR_COLETOR
    assert checkins[1]["id"] == "ck-1"
    assert capturados == []


def test_monitor_discover_falha_total_fecha_error_e_nao_levanta(monkeypatch):
    obs, checkins, capturados = _crons_fake(monkeypatch)

    def _discover():
        raise obs.FalhaTotalDiscover("discover: falha total (2 Jogadores)")

    assert obs.em_monitor_discover(_discover) is None
    assert [c["status"] for c in checkins] == ["in_progress", "error"]
    assert checkins[1]["id"] == "ck-1"  # mesmo check-in do in_progress
    assert capturados == [("discover: falha total (2 Jogadores)", "discover")]


def test_monitor_discover_falha_total_sem_dsn_e_no_op_e_nao_levanta(monkeypatch):
    import coletor.observabilidade as obs

    monkeypatch.setattr(obs, "_ativo", False)

    def _discover():
        raise obs.FalhaTotalDiscover("discover: falha total")

    assert obs.em_monitor_discover(_discover) is None


def test_monitor_discover_erro_inesperado_fecha_error_e_propaga(monkeypatch):
    obs, checkins, capturados = _crons_fake(monkeypatch)

    def _discover():
        raise ConnectionError("banco fora")

    with pytest.raises(ConnectionError):
        obs.em_monitor_discover(_discover)
    assert [c["status"] for c in checkins] == ["in_progress", "error"]


def test_percent_encoding_e_redigido_depois_de_decodificar():
    # Mesmos casos do casos-palavras.json (R119); o laço compartilhado cobre quando o JSON chegar.
    assert redigir_string("/jogador/ana%40exemplo.com") == REDACTED
    assert redigir_string("senha%3Dabc") == REDACTED
    assert redigir_string("/partida/abc%20def") == "/partida/abc%20def"
    assert redigir_string("erro pa%73sword=1") == REDACTED
    assert minimizar_evento({"message": "liga%20(11)%203456-7890"})["message"] == REDACTED


def test_percent_malformado_nao_lanca_e_para_de_decodificar():
    assert redigir_string("100% certo") == "100% certo"
    assert redigir_string("/partida/%E0%A4%A") == "/partida/%E0%A4%A"
    assert redigir_string("/partida/abc%2520def") == "/partida/abc%2520def"


def test_percent_encoding_em_camadas_e_redigido():
    # Codex P0 no PR #110: duplo encoding escapava da decodificação única.
    assert redigir_string("/jogador/ana%2540exemplo.com") == REDACTED
    assert redigir_string("/jogador/ana%252540exemplo.com") == REDACTED
    assert redigir_string("se%25256Eha%253Dabc") == REDACTED


def test_utf8_invalido_em_outra_parte_nao_esconde_o_email():
    # Sentinela P1 no a5e2d0c: o UnicodeDecodeError parava antes da 1a camada.
    assert redigir_string("/jogador/ana%40exemplo.com?x=%E0%A4") == REDACTED
    assert redigir_string("/jogador/ana%2540exemplo.com/%E0%A4") == REDACTED
    assert redigir_string("/partida/abc%20def/%E0%A4") == "/partida/abc%20def/%E0%A4"


def test_percent_encoding_que_ainda_muda_depois_de_3_camadas_falha_fechado():
    assert redigir_string("/jogador/ana%25252540exemplo.com") == REDACTED
    # Sem dado sensível em camada nenhuma; 7 dígitos seguidos não casam com telefone.
    assert redigir_string("/partida/abc%2525252Fdef") == REDACTED
