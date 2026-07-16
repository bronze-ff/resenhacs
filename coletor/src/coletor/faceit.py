"""Cliente da FACEIT Data API v4 + Downloads API (Fase B — ingestão automática).

HTTP sempre injetável (http_get_json=...) pra teste, igual steam_api.py. Auth por
header Bearer com a FACEIT_API_KEY (chave server-side criada no App Studio).
Formatos confirmados no swagger oficial (open.faceit.com/data/v4/docs/swagger.json).
"""

import gzip
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE_DATA = "https://open.faceit.com/data/v4"
URL_DOWNLOAD = "https://open.faceit.com/download/v2/demos/download"
PAGINA = 100


def _req_json(url, api_key, body=None, timeout=30):
    dados = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=dados, headers={
        "Authorization": f"Bearer {api_key}",
        **({"Content-Type": "application/json"} if body is not None else {}),
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _http_get_json(url, api_key):
    return _req_json(url, api_key)


def _http_post_json(url, api_key, body):
    return _req_json(url, api_key, body=body)


def _http_get_bytes(url, timeout=120):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def listar_historico_5v5(api_key, faceit_player_id, ja_vistas, andar_tudo=False,
                         http_get_json=_http_get_json):
    """Anda /players/{id}/history?game=cs2 paginando. Devolve as partidas 5v5 ainda não
    vistas, MAIS ANTIGA PRIMEIRO (o histórico entra em ordem). Para na primeira página
    onde todos os itens já são conhecidos — exceto com andar_tudo=True (primeira
    sincronização do membro), quando anda até a página vazia (histórico inteiro)."""
    novas = []
    offset = 0
    while True:
        qs = urllib.parse.urlencode({"game": "cs2", "offset": offset, "limit": PAGINA})
        payload = http_get_json(f"{BASE_DATA}/players/{faceit_player_id}/history?{qs}", api_key)
        items = payload.get("items") or []
        if not items:
            break
        ineditas = [i for i in items
                    if i.get("teams_size") == 5 and i.get("match_id")
                    and i["match_id"] not in ja_vistas]
        novas.extend({"faceit_match_id": i["match_id"], "finished_at": i.get("finished_at")}
                     for i in ineditas)
        # página inteira conhecida = já alcançamos o que tínhamos (5v5 ou não, o critério
        # é match_id conhecido) — só continua se for a primeira sincronização
        if not andar_tudo and all(i.get("match_id") in ja_vistas for i in items):
            break
        offset += PAGINA
    novas.sort(key=lambda n: n.get("finished_at") or 0)
    return novas


def detalhes_partida(api_key, faceit_match_id, http_get_json=_http_get_json):
    return http_get_json(f"{BASE_DATA}/matches/{faceit_match_id}", api_key)


def stats_partida(api_key, faceit_match_id, http_get_json=_http_get_json):
    return http_get_json(f"{BASE_DATA}/matches/{faceit_match_id}/stats", api_key)


def elo_atual(api_key, faceit_player_id, http_get_json=_http_get_json):
    payload = http_get_json(f"{BASE_DATA}/players/{faceit_player_id}", api_key)
    cs2 = (payload.get("games") or {}).get("cs2") or {}
    return cs2.get("faceit_elo"), cs2.get("skill_level")


def baixar_demo(api_key, demo_resource_url, http_post_json=_http_post_json,
                http_get_bytes=_http_get_bytes):
    """Troca a demo_url por uma URL assinada (Downloads API) e baixa. Devolve os bytes
    do .dem já descomprimidos (FACEIT serve .dem.gz; tolera bytes crus sem gzip)."""
    resp = http_post_json(URL_DOWNLOAD, api_key, {"resource_url": demo_resource_url})
    assinada = (resp.get("payload") or {}).get("download_url") or resp.get("download_url")
    if not assinada:
        raise RuntimeError(f"Downloads API sem download_url (chaves: {sorted(resp.keys())})")
    dados = http_get_bytes(assinada)
    if dados[:2] == b"\x1f\x8b":  # magic do gzip
        return gzip.decompress(dados)
    return dados


def _epoch_para_iso(epoch):
    if not epoch:
        return None
    return datetime.fromtimestamp(int(epoch), tz=timezone.utc).isoformat()


def montar_parsed_stats_only(detalhes, stats):
    """Monta o dict `parsed` mínimo aceito por db.store_parsed a partir só da API
    (fallback quando a demo não está mais disponível): placar, mapa, data e stats
    básicas por jogador. Campos que só o parser produz (KAST, rating, economia,
    replay, granadas) ficam nulos/vazios — a UI já esconde o que é nulo."""
    times = detalhes.get("teams") or {}
    resultados = detalhes.get("results") or {}
    placar = resultados.get("score") or {}
    vencedor = resultados.get("winner")

    rodada = (stats.get("rounds") or [{}])[0]
    round_stats = rodada.get("round_stats") or {}
    stats_por_faceit_id = {}
    for time_stats in rodada.get("teams") or []:
        for p in time_stats.get("players") or []:
            stats_por_faceit_id[p.get("player_id")] = p.get("player_stats") or {}

    def _int(v):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0

    rounds_total = _int(round_stats.get("Rounds")) or (_int(placar.get("faction1")) + _int(placar.get("faction2")))
    players = []
    for faccao, letra in (("faction1", "A"), ("faction2", "B")):
        for r in (times.get(faccao) or {}).get("roster") or []:
            ps = stats_por_faceit_id.get(r.get("player_id"), {})
            players.append({
                "steam_id64": r.get("game_player_id"),
                "nick": r.get("nickname") or "",
                "team": letra,
                "kills": _int(ps.get("Kills")),
                "deaths": _int(ps.get("Deaths")),
                "assists": _int(ps.get("Assists")),
                "headshot_kills": _int(ps.get("Headshots")),
                "damage": 0,
                "rounds_played": rounds_total,
                "won": (vencedor == faccao) if vencedor in ("faction1", "faction2") else None,
                "weapons": {},
            })

    return {
        "map": round_stats.get("Map") or "",
        "score_a": _int(placar.get("faction1")),
        "score_b": _int(placar.get("faction2")),
        "team_a_name": (times.get("faction1") or {}).get("name"),
        "team_b_name": (times.get("faction2") or {}).get("name"),
        "played_at": _epoch_para_iso(detalhes.get("finished_at")),
        "players": players,
        "rounds": [], "kills": [], "highlights": [], "round_econ": [],
        "player_round_econ": [], "purchases": [], "player_damage": [],
        "player_flashes": [], "kill_positions": [], "lineups": [],
    }


def escolher_partida_para_elo(novas, snapshot_anterior_em):
    """Das partidas recém-ingeridas de um membro (`novas` = [(match_id, played_at_dt)]),
    escolhe a que ganha o carimbo de ELO before/after: a MAIS RECENTE jogada DEPOIS do
    snapshot anterior. Sem snapshot anterior (None) não há "before" honesto → None
    (é o caso do backfill: histórico fica sem delta, decisão da spec)."""
    if snapshot_anterior_em is None:
        return None
    candidatas = [(m, dt) for m, dt in novas if dt is not None and dt > snapshot_anterior_em]
    if not candidatas:
        return None
    return max(candidatas, key=lambda par: par[1])[0]
