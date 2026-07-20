"""Integração com a API de clipes do Allstar (ADR-0004, docs/allstar/) — pedido de
clipe real (vídeo) por Highlight detectado. Teste restrito a uma allowlist de
steamId64 (config.allstar_steam_ids) até o preço por clipe ser confirmado com o
suporte deles (partners@allstar.gg). HTTP sempre injetável (http_post=...), mesmo
padrão de discord_notify.py/faceit.py.
"""

import json
import urllib.request

BASE = "https://prt.allstar.gg/cs"

# kind de highlight (transform.py: MULTIKILL_KIND / f"clutch_1v{vs}") -> endpoint do
# Allstar (Swagger da conta de parceiro RESENHACS — ver ADR-0004). Multi-kill/ace usa
# "mh" (Multi-kill Highlight); qualquer outra coisa (clutch, etc.) usa "potg" (melhor
# jogada) — cobre os dois use cases que a doc confirma sem ambiguidade.
_ENDPOINT_POR_KIND = {"ace": "mh", "quad": "mh", "triple": "mh"}
_ENDPOINT_PADRAO = "potg"


def endpoint_para_kind(kind):
    return _ENDPOINT_POR_KIND.get(kind, _ENDPOINT_PADRAO)


def _http_post_json(url, payload, api_key, timeout=30):
    dados = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=dados,
        headers={"Content-Type": "application/json", "X-Api-Key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def pedir_clipe(api_key, kind, steam_id64, nick, demo_url, round_number, webhook_url,
                metadata=None, http_post=_http_post_json):
    """Pede um clipe pro Highlight. Devolve o requestId. Propaga qualquer exceção de
    rede/HTTP — quem chama decide se ignora (main.py: loga e segue, nunca derruba
    o fetch, mesmo padrão de discord_notify.enviar_webhook)."""
    endpoint = endpoint_para_kind(kind)
    payload = {
        "steamId": steam_id64,
        "demoUrl": demo_url,
        "webhookUrl": webhook_url,
        "rounds": [round_number],
        "username": nick or steam_id64,
    }
    if metadata:
        payload["metadata"] = metadata
    resp = http_post(f"{BASE}/clip/{endpoint}", payload, api_key)
    request_id = resp.get("requestId") or resp.get("_id")
    if not request_id:
        raise RuntimeError(f"Allstar sem requestId na resposta (chaves: {sorted(resp.keys())})")
    return request_id
