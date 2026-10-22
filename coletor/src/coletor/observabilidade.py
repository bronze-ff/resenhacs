"""Scrub e init do Sentry no Coletor.

Sem SENTRY_DSN o módulo não importa o sentry-sdk (teste e dev seguem no-op).
A lógica de minimização espelha site/server/src/observabilidade/scrub.js.
A lista de palavras mora em palavras.py.
"""

import os
import re
from urllib.parse import unquote, urlsplit, urlunsplit

from .palavras import PALAVRA, chave_sensivel

REDACTED = "[Redacted]"

_CHAVES_EVENTO = (
    "event_id",
    "timestamp",
    "start_timestamp",
    "level",
    "platform",
    "release",
    "environment",
    "exception",
    "message",
    "logentry",
    "breadcrumbs",
    "tags",
    "contexts",
    "sdk",
    "request",
    "user",
    "transaction",
    "type",
    "fingerprint",
)

_DESCARTAR = re.compile(
    r"^(headers|cookies|cookie|set-cookie|query_string|query|body|request_body|response_body|env|authorization)$",
    re.IGNORECASE,
)
_PII = [
    re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b"),
    re.compile(r"\b\d{11}\b"),
    re.compile(r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b"),
    re.compile(r"\b\d{14}\b"),
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    # 8 a 13 dígitos, com espaço, ponto, hífen, parênteses ou +. Cobre fixo, celular e
    # 0800/0300/0500/0900. A data ISO YYYY-MM-DD fica de fora. SteamID (17) não cabe
    # no teto e placar curto não chega em 8 dígitos. (?<!\d)/(?!\d) barram dígito colado.
    re.compile(
        r"(?<!\d)(?!\d{4}-\d{2}-\d{2}(?!\d))\+?(?:\d[\s.()\-+]*){7,12}\d(?!\d)"
    ),
    re.compile(r"\b[A-Z]{3}-?\d{4}\b", re.IGNORECASE),
    re.compile(r"\b[A-Z]{3}\d[A-Z]\d{2}\b", re.IGNORECASE),
]
_URL = re.compile(r"https?://[^\s<>\"']+")
_REL = re.compile(r"(^|[\s\"'`(])(/(?!/)[^\s\"'`<>)]*)")

_ativo = False

MONITOR_COLETOR = {
    "schedule": {"type": "crontab", "value": "*/10 * * * *"},
    "timezone": "Etc/UTC",
    "checkin_margin": 10,
    "max_runtime": 20,
    "failure_issue_threshold": 1,
    "recovery_threshold": 1,
}


def so_origem_caminho(valor):
    if not isinstance(valor, str) or valor == "":
        return valor
    if valor.startswith("/") and not valor.startswith("//"):
        return re.split(r"[?#]", valor, maxsplit=1)[0]
    partes = urlsplit(valor)
    if partes.scheme not in ("http", "https") or not partes.netloc:
        return valor
    return urlunsplit((partes.scheme, partes.netloc, partes.path, "", ""))


def _cortar_url(url):
    limpa = re.sub(r"[),.;]+$", "", url)
    return so_origem_caminho(limpa) + url[len(limpa):]


def _redigir(valor):
    texto = _URL.sub(lambda match: _cortar_url(match.group(0)), valor)
    texto = _REL.sub(lambda match: match.group(1) + _cortar_url(match.group(2)), texto)
    if PALAVRA.search(texto) or any(padrao.search(texto) for padrao in _PII):
        return REDACTED
    return texto


_MAX_DECODIFICACOES = 3


def redigir_string(valor):
    if not isinstance(valor, str):
        return valor

    # Decodifica em camadas (%2540 -> %40 -> @) até estabilizar, no máximo 3 vezes, todas
    # no modo tolerante: % sem dois hex fica literal e UTF-8 inválido vira U+FFFD (conta
    # como mudança e não decodifica de novo). Mesma regra do scrub.js.
    camadas = [valor]
    while True:
        decodificado = unquote(camadas[-1], errors="replace")
        if decodificado == camadas[-1]:
            break
        if len(camadas) > _MAX_DECODIFICACOES:
            return REDACTED  # ainda muda depois de 3 decodificações: falha fechada
        camadas.append(decodificado)

    sanitizada = None
    for camada in camadas:
        redigida = _redigir(camada)
        if redigida == REDACTED:
            return REDACTED  # redação integral tem prioridade
        if redigida != camada:
            sanitizada = redigida
    # A camada mais profunda que a sanitização mudou (ex.: query que só aparece depois de
    # decodificar sai cortada); o original só volta se nenhuma camada mudou.
    return valor if sanitizada is None else sanitizada


def scrub_valor(valor, chave=None):
    if chave_sensivel(chave):
        return REDACTED
    if isinstance(valor, str):
        return redigir_string(valor)
    if isinstance(valor, list):
        return [scrub_valor(item) for item in valor]
    if isinstance(valor, dict):
        saida = {}
        for k, v in valor.items():
            if isinstance(k, str) and _DESCARTAR.match(k):
                continue
            saida[k] = scrub_valor(v, k)
        return saida
    return valor


def _contexts_minimos(valor):
    if not isinstance(valor, dict):
        return None
    trace = valor.get("trace")
    if not isinstance(trace, dict):
        return {}
    return {"trace": scrub_valor(trace)}


def minimizar_breadcrumb(breadcrumb):
    if not isinstance(breadcrumb, dict):
        return breadcrumb
    if breadcrumb.get("category") == "console":
        return None
    return scrub_valor(breadcrumb)


def _minimizar_breadcrumbs(valor):
    if isinstance(valor, list):
        return [item for item in (minimizar_breadcrumb(b) for b in valor) if item is not None]
    if not isinstance(valor, dict):
        return None
    saida = {}
    for k, v in valor.items():
        if k == "values" and isinstance(v, list):
            saida["values"] = [item for item in (minimizar_breadcrumb(b) for b in v) if item is not None]
            continue
        if isinstance(k, str) and _DESCARTAR.match(k):
            continue
        saida[k] = scrub_valor(v, k)
    return saida


def minimizar_evento(evento):
    if not isinstance(evento, dict):
        return evento
    saida = {}
    for chave in _CHAVES_EVENTO:
        if chave not in evento:
            continue
        if chave == "breadcrumbs":
            migalhas = _minimizar_breadcrumbs(evento.get("breadcrumbs"))
            if migalhas is not None:
                saida["breadcrumbs"] = migalhas
            continue
        if chave == "contexts":
            contexts = _contexts_minimos(evento.get("contexts"))
            if contexts is not None:
                saida["contexts"] = contexts
            continue
        saida[chave] = scrub_valor(evento[chave])
    req = saida.get("request")
    if isinstance(req, dict):
        novo = {}
        if isinstance(req.get("method"), str):
            novo["method"] = req["method"]
        if isinstance(req.get("url"), str):
            novo["url"] = req["url"]
        saida["request"] = novo
    user = saida.get("user")
    if isinstance(user, dict):
        ident = user.get("id")
        if ident in (None, ""):
            saida["user"] = {}
        elif isinstance(ident, str):
            saida["user"] = {"id": ident}
        else:
            saida["user"] = {"id": redigir_string(str(ident))}
    return saida


def minimizar_span(span):
    if not isinstance(span, dict):
        return span
    saida = scrub_valor(span)
    for bloco_nome in ("data", "attributes"):
        data = saida.get(bloco_nome)
        if not isinstance(data, dict):
            continue
        for k in list(data):
            if not isinstance(k, str):
                continue
            if _DESCARTAR.match(k) or re.search(r"query|header|cookie|body|fragment", k, re.I) or PALAVRA.search(k):
                del data[k]
    return saida


def before_send(evento, hint):
    return minimizar_evento(evento)


def before_breadcrumb(crumb, hint):
    return minimizar_breadcrumb(crumb)


def before_send_span(span, hint):
    return minimizar_span(span)


def init_sentry():
    """Inicializa o SDK só com DSN. Devolve False quando fica no-op."""
    global _ativo
    dsn = (os.environ.get("SENTRY_DSN") or "").strip()
    if not dsn or _ativo:
        return _ativo
    try:
        import sentry_sdk
    except ImportError:
        print("SENTRY_DSN definido, mas sentry-sdk não está instalado — seguindo sem Sentry", flush=True)
        return False
    kwargs = dict(
        dsn=dsn,
        environment=os.environ.get("SENTRY_ENVIRONMENT") or "dev",
        # SENTRY_RELEASE está documentada na atribuição (não comentada) de
        # coletor/.env.example — o exemplo que o Coletor usa. O processo lê
        # os.environ. A mesma linha está em site/client/.env.example e
        # site/server/.env.example.
        release=os.environ.get("GITHUB_SHA") or os.environ.get("SENTRY_RELEASE") or None,
        send_default_pii=False,
        traces_sample_rate=0,
        trace_lifecycle="stream",
        include_local_variables=False,
        before_send=before_send,
        before_breadcrumb=before_breadcrumb,
        before_send_span=before_send_span,
        max_request_body_size="never",
    )
    sentry_sdk.init(**kwargs)
    _ativo = True
    return True


def capturar_erro(erro, etapa):
    """Manda ao Sentry um erro que o laço por item engoliu, com a tag `etapa`.

    No-op sem DSN. O evento passa pelo before_send (allowlist + scrub). Falha do
    próprio Sentry nunca derruba quem chamou.
    """
    if not _ativo:
        return
    try:
        import sentry_sdk

        with sentry_sdk.new_scope() as escopo:
            escopo.set_tag("etapa", etapa)
            sentry_sdk.capture_exception(erro)
    except Exception:  # noqa: BLE001
        pass


class FalhaTotalDiscover(Exception):
    """Todos os Jogadores falharam no discover. em_monitor_discover marca o check-in
    como error e engole: o processo sai 0 pros passos seguintes do job rodarem."""


def _monitorar():
    return (
        _ativo
        and os.environ.get("GITHUB_ACTIONS") == "true"
        and os.environ.get("SENTRY_ENVIRONMENT") == "producao"
    )


def _check_in(status, check_in_id=None):
    """Check-in manual do cron (in_progress abre, ok/error fecham o MESMO id).
    Falha do Sentry nunca derruba o discover."""
    try:
        from sentry_sdk.crons import capture_checkin

        return capture_checkin(
            monitor_slug="resenhacs-coletor", check_in_id=check_in_id, status=status,
            monitor_config=MONITOR_COLETOR if check_in_id is None else None,
        )
    except Exception:  # noqa: BLE001
        return None


def em_monitor_discover(fn):
    """Roda o discover com check-in do cron (só na run de produção do Actions).

    Falha total (FalhaTotalDiscover): check-in error + capturar_erro, sem levantar.
    Outro erro: check-in error e propaga, como o `with monitor` fazia."""
    check_in_id = _check_in("in_progress") if _monitorar() else None
    try:
        resultado = fn()
    except FalhaTotalDiscover as e:
        capturar_erro(e, "discover")
        if check_in_id is not None:
            _check_in("error", check_in_id)
        print(f"{e} — check-in do cron marcado como erro")
        return None
    except Exception:
        if check_in_id is not None:
            _check_in("error", check_in_id)
        raise
    if check_in_id is not None:
        _check_in("ok", check_in_id)
    return resultado
