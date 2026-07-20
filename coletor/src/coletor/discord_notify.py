"""Aviso automático no Discord quando o Coletor processa uma Partida nova (item 6 do
ROADMAP.md). Um embed por grupo com membro na partida, placar/MVP do ponto de vista
daquele grupo (dados vindos de db.resumo_da_partida_para_grupo). HTTP sempre injetável
(http_post=...) pra teste, mesmo padrão de faceit.py.
"""

import json
import urllib.request

COR_VITORIA = 5763719   # verde (Discord embed color, decimal RGB)
COR_DERROTA = 15548997  # vermelho
COR_EMPATE = 9807270    # cinza


def montar_embed(resumo, match_id, app_url):
    """resumo: dict de db.resumo_da_partida_para_grupo. app_url: base do site, sem
    barra final (ex.: "https://resenha-phi.vercel.app")."""
    score_grupo = resumo["score_grupo"]
    score_rival = resumo["score_rival"]

    if score_grupo > score_rival:
        resultado, cor = "Vitória", COR_VITORIA
    elif score_grupo < score_rival:
        resultado, cor = "Derrota", COR_DERROTA
    else:
        resultado, cor = "Empate", COR_EMPATE

    embed = {
        "title": f"{resultado} {score_grupo}×{score_rival} no {resumo['map']}",
        "color": cor,
        "url": f"{app_url}/partidas/{match_id}",
        "footer": {"text": "Resenha"},
    }
    if resumo["mvp_nick"] is not None:
        embed["description"] = (
            f"MVP do grupo: **{resumo['mvp_nick']}** ({resumo['mvp_rating']:.2f} rating)"
        )
    return {"embeds": [embed]}


def _http_post_json(url, payload, timeout=15):
    dados = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=dados, headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status


def enviar_webhook(webhook_url, payload, http_post=_http_post_json):
    """Manda o embed pro Discord. Propaga qualquer exceção de rede/HTTP (inclusive
    HTTPError da urllib pra status != 2xx) — quem chama decide se ignora (main.py:
    loga e segue, nunca derruba o fetch)."""
    http_post(webhook_url, payload)
