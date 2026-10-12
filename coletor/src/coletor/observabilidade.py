"""Scrub e init do Sentry no Coletor.

Sem SENTRY_DSN o módulo não importa o sentry-sdk (teste e dev seguem no-op).
A lógica de minimização espelha site/client/src/observabilidade/scrub.js.
"""

import os
import re
from urllib.parse import urlsplit, urlunsplit

REDACTED = "[Redacted]"

_TRANSPORTE = {
    "event_id",
    "timestamp",
    "start_timestamp",
    "platform",
    "sdk",
    "level",
    "logger",
    "span_id",
    "parent_span_id",
    "trace_id",
    "op",
    "origin",
    "dist",
    "environment",
    "release",
    "server_name",
    "debug_meta",
    "measurements",
    "profile",
    "type",
    "category",
}

_DESCARTAR = re.compile(
    r"^(headers|cookies|cookie|set-cookie|query_string|query|body|request_body|response_body|env|authorization)$",
    re.IGNORECASE,
)
# (?<!re) evita que "resenha" (marca do produto) dispare "senha".
# "token" segue sem fronteira de palavra para pegar access_token.
_PALAVRA = re.compile(r"(?<!re)senha|token|authorization|cookie", re.IGNORECASE)
_PII = [
    re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b"),
    re.compile(r"\b\d{11}\b"),
    re.compile(r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b"),
    re.compile(r"\b\d{14}\b"),
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    # Fixo (8 dígitos) e celular (9). +55 opcional; DDD com ou sem parênteses.
    re.compile(
        r"(?<!\d)\+?(?:55[\s./-]*)?\(?\d{2}\)?[\s./-]*9?[\s./-]*\d{4}[\s./-]*\d{4}(?!\d)"
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


def redigir_string(valor):
    if not isinstance(valor, str):
        return valor

    texto = _URL.sub(lambda match: _cortar_url(match.group(0)), valor)
    texto = _REL.sub(lambda match: match.group(1) + _cortar_url(match.group(2)), texto)
    if _PALAVRA.search(texto) or any(padrao.search(texto) for padrao in _PII):
        return REDACTED
    return texto


def _chave_sensivel(chave):
    return isinstance(chave, str) and _PALAVRA.search(chave)


def scrub_valor(valor, chave=None):
    if isinstance(chave, str) and chave in _TRANSPORTE:
        return valor
    if _chave_sensivel(chave):
        return REDACTED
    if isinstance(valor, str):
        return redigir_string(valor)
    if isinstance(valor, list):
        return [scrub_valor(item) for item in valor]
    if isinstance(valor, dict):
        saida = {}
        for k, v in valor.items():
            if k in _TRANSPORTE:
                saida[k] = v
                continue
            if isinstance(k, str) and _DESCARTAR.match(k):
                continue
            saida[k] = scrub_valor(v, k)
        return saida
    return valor


def minimizar_evento(evento):
    if not isinstance(evento, dict):
        return evento
    saida = scrub_valor(evento)
    req = saida.get("request")
    if isinstance(req, dict):
        novo = {}
        if isinstance(req.get("method"), str):
            novo["method"] = req["method"]
        if isinstance(req.get("url"), str):
            novo["url"] = redigir_string(req["url"])
        saida["request"] = novo
    user = saida.get("user")
    if isinstance(user, dict):
        ident = user.get("id")
        saida["user"] = {"id": redigir_string(str(ident))} if ident not in (None, "") else {}
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
            if _DESCARTAR.match(k) or re.search(r"query|header|cookie|body|fragment", k, re.I) or _PALAVRA.search(k):
                del data[k]
    return saida


def before_send(evento, hint):
    return minimizar_evento(evento)


def before_breadcrumb(crumb, hint):
    if isinstance(crumb, dict) and crumb.get("category") == "console":
        return None
    return minimizar_evento(crumb)


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


def em_monitor_discover(fn):
    """Check-in do cron só na run de produção do Actions. Fora isso, só executa fn."""
    if not (
        _ativo
        and os.environ.get("GITHUB_ACTIONS") == "true"
        and os.environ.get("SENTRY_ENVIRONMENT") == "producao"
    ):
        return fn()
    from sentry_sdk.crons import monitor

    with monitor(monitor_slug="resenhacs-coletor", monitor_config=MONITOR_COLETOR):
        return fn()
