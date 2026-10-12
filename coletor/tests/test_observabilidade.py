import json
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
