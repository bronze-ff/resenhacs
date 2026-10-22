"""Avisos no Discord do grupo: Partida ingerida, Clipe pronto e Resenha da semana.

No-op se DISCORD_WEBHOOK_URL estiver vazio. Falha aqui NUNCA derruba o ingest: quem
chama (main.ingest_demo) embrulha em try/except, e este módulo também engole erro de
rede. Sem SteamID nem share code no embed nem no log (o Actions é de repo público), e
a URL do webhook (que carrega o token) nunca é impressa.
"""

import datetime
import json
import math
import os
import urllib.request
from zoneinfo import ZoneInfo

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


# ---- Clipe pronto (F3) ----
# Os dois tipos de Clipe ficam em tabelas próprias; o nome da tabela nunca vem de input.
_TABELAS_CLIPE = ("clipes_reais", "allstar_clips")
_ROTULO_MODO = {
    "clipe": "Clipe",
    "fails": "Fails",
    "coaching": "Coaching",
    "cheater": "Cheater analysis",
    "allstar": "Allstar",
}
MAX_POSTS_CLIPE = 3
MAX_LINHAS_CLIPE = 5

# Nick só de Jogador do grupo (match_players.is_tracked, como dados_da_partida); de fora
# vira nulo e a linha diz só "Clipe".
_NICK_DO_GRUPO = "case when mp.is_tracked then coalesce(nullif(p.nick, ''), mp.nick) end"
_SQL_CLIPES_REAIS = (
    f"select c.id, c.match_id, m.map, c.modo, {_NICK_DO_GRUPO} "
    "from clipes_reais c join matches m on m.id = c.match_id "
    "left join match_players mp on mp.match_id = c.match_id and mp.steam_id64 = c.pedido_por "
    "left join players p on p.steam_id64 = c.pedido_por "
    "where c.status = 'pronto' and c.discord_notificado_em is null "
    "and c.updated_at > now() - interval '48 hours' "
    "order by c.updated_at limit 20"
)
_SQL_CLIPES_ALLSTAR = (
    f"select c.id, c.match_id, m.map, 'allstar', {_NICK_DO_GRUPO} "
    "from allstar_clips c join matches m on m.id = c.match_id "
    "left join match_players mp on mp.match_id = c.match_id and mp.steam_id64 = c.steam_id64 "
    "left join players p on p.steam_id64 = c.steam_id64 "
    "where c.status = 'Processed' and c.discord_notificado_em is null "
    "and c.updated_at > now() - interval '48 hours' "
    "order by c.updated_at limit 20"
)


def _candidatos_clipes(conn):
    """{match_id: [(tabela, id, mapa, modo, nick)]} na ordem de updated_at."""
    por_partida = {}
    with conn.cursor() as cur:
        for tabela, sql in zip(_TABELAS_CLIPE, (_SQL_CLIPES_REAIS, _SQL_CLIPES_ALLSTAR)):
            cur.execute(sql)
            for clipe_id, match_id, mapa, modo, nick in cur.fetchall():
                por_partida.setdefault(match_id, []).append((tabela, clipe_id, mapa, modo, nick))
    return por_partida


def _reservar_clipe(conn, tabela, clipe_id):
    """Mesmo update condicional de _reservar: duas execuções não postam o mesmo Clipe."""
    with conn.cursor() as cur:
        cur.execute(
            f"update {tabela} set discord_notificado_em = now() "
            "where id = %s and discord_notificado_em is null returning id",
            (clipe_id,),
        )
        reservou = cur.fetchone() is not None
    conn.commit()
    return reservou


def _liberar_clipes(conn, clipes):
    with conn.cursor() as cur:
        for tabela, clipe_id, *_ in clipes:
            cur.execute(f"update {tabela} set discord_notificado_em = null where id = %s", (clipe_id,))
    conn.commit()


def montar_embed_clipes(match_id, clipes, app_url):
    linhas = []
    for _tabela, _id, _mapa, modo, nick in clipes[:MAX_LINHAS_CLIPE]:
        linhas.append(f"{nick} · {_ROTULO_MODO.get(modo, 'Clipe')}" if nick else "Clipe")
    embed = {
        "title": f"Clipe pronto na {_nome_mapa(clipes[0][2])}",
        "color": COR_NEUTRA,
        "description": "\n".join(linhas),
    }
    if app_url:
        embed["url"] = f"{app_url.rstrip('/')}/partida/{match_id}"
    return {"embeds": [embed], "allowed_mentions": {"parse": []}}


def avisar_clipes(conn, webhook_url, app_url):
    """Posta os Clipes prontos ainda não avisados: 1 post por Partida, no máximo 3 por
    execução. Devolve quantos posts fez. Post que falha libera a reserva e propaga."""
    posts = 0
    for match_id, clipes in _candidatos_clipes(conn).items():
        if posts >= MAX_POSTS_CLIPE:
            break
        reservados = [c for c in clipes if _reservar_clipe(conn, c[0], c[1])]
        if not reservados:
            continue
        try:
            _postar(webhook_url, montar_embed_clipes(match_id, reservados, app_url))
        except Exception:
            _liberar_clipes(conn, reservados)
            raise
        posts += 1
    return posts


# ---- Resenha da semana (F3) ----
# Porta 3 prêmios de site/server/src/premios.js (carregou, clutch, granadeiro).
# Paridade travada por shared/premios/casos-semana.json; premios.js é a fonte.
FUSO = ZoneInfo("America/Sao_Paulo")
HORA_RESENHA = 10
MINIMO_PARTIDAS_SEMANA = 2  # MINIMOS.semana.partidas em premios.js

_SQL_SEMANA = (
    "select m.id, m.map, mp.steam_id64, p.nick, mp.team, mp.won, mp.rating, mp.clutch_wins, "
    # Mesmo UTIL_INIMIGO_SQL de site/server/src/danoUtilitaria.js.
    "(case when mp.he_damage + mp.molotov_damage + mp.he_team_damage + mp.molotov_team_damage > 0 "
    "then mp.he_damage + mp.molotov_damage else mp.utility_damage end) "
    "from matches m "
    "join match_players mp on mp.match_id = m.id "
    "join players p on p.steam_id64 = mp.steam_id64 "
    "where m.status = 'parsed' and mp.is_tracked "
    "and m.played_at >= (%s::date::timestamp at time zone 'America/Sao_Paulo') "
    "and m.played_at < (%s::date::timestamp at time zone 'America/Sao_Paulo') "
    "limit 20000"
)
_COLUNAS_SEMANA = ("match_id", "map", "steam_id64", "nick", "team", "won", "rating", "clutch_wins", "utility_damage")


def _arred(valor, casas=2):
    # Math.round do JS: meio sobe. round() do Python arredonda para o par (1.125 -> 1.12).
    fator = 10 ** casas
    return math.floor(valor * fator + 0.5) / fator


def _melhor(jogadores, metrica, filtro):
    """Igual a melhor() de premios.js: empate fica com quem tem mais Partidas."""
    vencedor = None
    for j in jogadores:
        if not filtro(j):
            continue
        v = metrica(j)
        if v is None:
            continue
        if vencedor is None or v > vencedor[1] or (v == vencedor[1] and j["partidas"] > vencedor[0]["partidas"]):
            vencedor = (j, v)
    return vencedor


def calcular_premios_semana(linhas):
    partidas = {}
    por_jogador = {}
    for r in linhas:
        partidas.setdefault(r["match_id"], []).append(r.get("won"))
        j = por_jogador.setdefault(r["steam_id64"], {
            "steamId": r["steam_id64"], "nick": r.get("nick"), "partidas": 0,
            "comRating": 0, "somaRating": 0.0, "clutches": 0, "utilidade": 0,
        })
        j["partidas"] += 1
        if r.get("rating") is not None:
            j["comRating"] += 1
            j["somaRating"] += float(r["rating"])
        j["clutches"] += int(r.get("clutch_wins") or 0)
        j["utilidade"] += int(r.get("utility_damage") or 0)
    jogadores = list(por_jogador.values())
    com_minimo = lambda j: j["partidas"] >= MINIMO_PARTIDAS_SEMANA  # noqa: E731

    achados = [
        ("carregou", _melhor(
            jogadores, lambda j: _arred(j["somaRating"] / j["comRating"]) if j["comRating"] else None,
            lambda j: j["comRating"] >= MINIMO_PARTIDAS_SEMANA)),
        ("clutch", _melhor(
            jogadores, lambda j: _arred(j["clutches"] / j["partidas"]),
            lambda j: com_minimo(j) and j["clutches"] > 0)),
        ("granadeiro", _melhor(
            jogadores, lambda j: int(_arred(j["utilidade"] / j["partidas"], 0)),
            lambda j: com_minimo(j) and j["utilidade"] > 0)),
    ]
    return {
        "numeros": {
            "partidas": len(partidas),
            "vitorias": sum(1 for ws in partidas.values() if all(w is True for w in ws)),
            "derrotas": sum(1 for ws in partidas.values() if all(w is False for w in ws)),
        },
        "premios": [
            {"id": pid, "steamId": a[0]["steamId"], "nick": a[0]["nick"], "valor": a[1]}
            for pid, a in achados if a
        ],
    }


def semana_a_postar(agora):
    """Segunda-feira anterior se `agora` é segunda a partir das 10:00 de São Paulo; senão None."""
    local = agora.astimezone(FUSO)
    if local.weekday() != 0 or local.hour < HORA_RESENHA:
        return None
    return local.date() - datetime.timedelta(days=7)


_PREMIO_TEXTO = {
    "carregou": ("Carregou", lambda v: f"rating {v:.2f}"),
    "clutch": ("Rei do clutch", lambda v: f"{v:.2f} clutch por Partida"),
    "granadeiro": ("Granadeiro", lambda v: f"{v} de dano de utilitária por Partida"),
}


def montar_embed_resenha(resultado, semana, app_url):
    n = resultado["numeros"]
    embed = {
        "title": "Resenha da semana",
        "color": COR_NEUTRA,
        "description": f"{n['partidas']} Partidas · {n['vitorias']} vitórias · {n['derrotas']} derrotas",
        "fields": [
            {"name": _PREMIO_TEXTO[p["id"]][0], "value": f"{p['nick']} · {_PREMIO_TEXTO[p['id']][1](p['valor'])}", "inline": False}
            for p in resultado["premios"]
        ],
    }
    if app_url:
        embed["url"] = f"{app_url.rstrip('/')}/resenha?periodo=semana&ref={semana.isoformat()}"
    return {"embeds": [embed], "allowed_mentions": {"parse": []}}


def avisar_resenha_semanal(conn, webhook_url, app_url, agora):
    """Posta a Resenha da semana uma vez por semana. Devolve True se postou."""
    semana = semana_a_postar(agora)
    if semana is None:
        return False
    with conn.cursor() as cur:
        cur.execute(
            "insert into discord_resenha_semanal (semana) values (%s) on conflict do nothing returning semana",
            (semana,),
        )
        reservou = cur.fetchone() is not None
    conn.commit()
    if not reservou:
        return False
    with conn.cursor() as cur:
        cur.execute(_SQL_SEMANA, (semana, semana + datetime.timedelta(days=7)))
        linhas = [dict(zip(_COLUNAS_SEMANA, r)) for r in cur.fetchall()]
    if not linhas:
        return False  # a reserva fica: semana sem Partida não posta mais tarde
    try:
        _postar(webhook_url, montar_embed_resenha(calcular_premios_semana(linhas), semana, app_url))
    except Exception:
        with conn.cursor() as cur:
            cur.execute("delete from discord_resenha_semanal where semana = %s", (semana,))
        conn.commit()
        raise
    return True
