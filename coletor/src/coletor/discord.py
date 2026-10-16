"""Aviso no Discord do grupo quando uma Partida termina de ser ingerida.

No-op se DISCORD_WEBHOOK_URL estiver vazio. Falha aqui NUNCA derruba o ingest: quem
chama (main.ingest_demo) embrulha em try/except, e este módulo também engole erro de
rede. Sem SteamID nem share code no embed nem no log (o Actions é de repo público), e
a URL do webhook (que carrega o token) nunca é impressa.
"""

import json
import os
import urllib.request

COR_VITORIA = 0x3DDC97
COR_DERROTA = 0xF2555A
COR_NEUTRA = 0x8A8A93
TIMEOUT_S = 10


def _nome_mapa(mapa):
    if not mapa:
        return "Mapa desconhecido"
    limpo = mapa[3:] if mapa.startswith("de_") else mapa
    return limpo[:1].upper() + limpo[1:]


def dados_da_partida(conn, match_id):
    """Mapa, placar e Jogadores do grupo (is_tracked) da Partida. None se não existe."""
    with conn.cursor() as cur:
        cur.execute(
            "select map, score_a, score_b, played_at from matches where id = %s",
            (match_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        mapa, score_a, score_b, played_at = row
        cur.execute(
            "select coalesce(nullif(p.nick, ''), mp.nick) as nick, mp.team, mp.won, mp.rating, "
            "mp.kills, mp.deaths "
            "from match_players mp left join players p on p.steam_id64 = mp.steam_id64 "
            "where mp.match_id = %s and mp.is_tracked",
            (match_id,),
        )
        grupo = [
            {"nick": r[0], "team": r[1], "won": r[2], "rating": r[3], "kills": r[4], "deaths": r[5]}
            for r in cur.fetchall()
        ]
    return {"map": mapa, "score_a": score_a, "score_b": score_b, "played_at": played_at, "grupo": grupo}


def montar_embed(dados, match_id, app_url):
    """Payload do webhook. None se nenhum Jogador do grupo jogou (nada a avisar)."""
    grupo = dados.get("grupo") or []
    if not grupo:
        return None

    times = {j["team"] for j in grupo}
    if all(j["won"] is True for j in grupo):
        resultado, cor = "Vitória", COR_VITORIA
    elif all(j["won"] is False for j in grupo):
        resultado, cor = "Derrota", COR_DERROTA
    elif len(times) > 1:
        resultado, cor = "Grupo dos dois lados", COR_NEUTRA
    else:
        resultado, cor = "Empate", COR_NEUTRA

    a, b = dados.get("score_a"), dados.get("score_b")
    if a is None or b is None:
        placar = "–"
    elif len(times) == 1 and "B" in times:
        placar = f"{b} x {a}"  # placar do ponto de vista do grupo
    else:
        placar = f"{a} x {b}"

    com_rating = [j for j in grupo if j["rating"] is not None]
    mvp = max(com_rating, key=lambda j: float(j["rating"])) if com_rating else None

    mapa = _nome_mapa(dados.get("map"))
    campos = [
        {"name": "Placar", "value": placar, "inline": True},
        {"name": "Resultado", "value": resultado, "inline": True},
    ]
    if mvp:
        campos.append({
            "name": "MVP do grupo",
            "value": f"{mvp['nick']} · rating {float(mvp['rating']):.2f} · {mvp['kills']}/{mvp['deaths']}",
            "inline": False,
        })
    campos.append({
        "name": "Jogaram",
        "value": ", ".join(sorted(j["nick"] for j in grupo))[:1000],
        "inline": False,
    })

    embed = {"title": f"{resultado} na {mapa}", "color": cor, "fields": campos}
    if app_url:
        embed["url"] = f"{app_url.rstrip('/')}/partida/{match_id}"
    played_at = dados.get("played_at")
    if played_at is not None and hasattr(played_at, "isoformat"):
        embed["timestamp"] = played_at.isoformat()
    # allowed_mentions vazio: nick com "@everyone" não vira ping no servidor.
    return {"embeds": [embed], "allowed_mentions": {"parse": []}}


def _postar(webhook_url, payload):
    req = urllib.request.Request(
        webhook_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "ResenhaColetor/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:  # noqa: S310 (URL do secret)
        return resp.status


def _reservar(conn, match_id):
    """Marca a Partida como notificada ANTES de postar; devolve False se já estava.
    Sem isso, uma Partida reingerida (reprocessamento, demo enviada depois) era postada
    de novo no canal. O update condicional é atômico: duas rodadas simultâneas não
    postam as duas."""
    with conn.cursor() as cur:
        cur.execute(
            "update matches set discord_notificado_em = now() "
            "where id = %s and discord_notificado_em is null returning id",
            (match_id,),
        )
        reservou = cur.fetchone() is not None
    conn.commit()
    return reservou


def _liberar(conn, match_id):
    """Desfaz a reserva quando o post falha, pra próxima ingestão tentar de novo."""
    with conn.cursor() as cur:
        cur.execute("update matches set discord_notificado_em = null where id = %s", (match_id,))
    conn.commit()


def notificar_partida(conn, match_id, webhook_url=None, app_url=None):
    """Posta o embed da Partida no webhook. Devolve True se postou."""
    webhook_url = webhook_url if webhook_url is not None else os.environ.get("DISCORD_WEBHOOK_URL", "")
    app_url = app_url if app_url is not None else os.environ.get("APP_URL", "")
    if not webhook_url:
        return False
    try:
        dados = dados_da_partida(conn, match_id)
        payload = montar_embed(dados, match_id, app_url) if dados else None
        if payload is None:
            return False
        if not _reservar(conn, match_id):
            return False
        try:
            _postar(webhook_url, payload)
        except Exception:
            _liberar(conn, match_id)
            raise
        return True
    except Exception as e:  # noqa: BLE001
        # Só o tipo/código: a mensagem de erro de rede pode carregar a URL (com token).
        codigo = getattr(e, "code", "")
        print(f"aviso: Discord não notificado ({type(e).__name__}{f' {codigo}' if codigo else ''})")
        return False
