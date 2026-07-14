"""Cliente da Steam Web API para andar a corrente de share codes.

GetNextMatchSharingCode devolve o share code da PRÓXIMA Partida de um Jogador a
partir de um código conhecido. Andando essa corrente descobrimos Partidas novas
sem depender do cliente do jogo. (O download do .dem de matchmaking exige o Game
Coordinator via conta-bot — ver parse.py/README; a corrente aqui só descobre.)
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.steampowered.com/ICSGOPlayers_730/GetNextMatchSharingCode/v1/"
BASE_PLAYER_SUMMARIES = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
LOTE_PLAYER_SUMMARIES = 100  # limite de steamids por chamada da GetPlayerSummaries


def build_next_code_url(api_key, steam_id64, auth_code, known_code):
    qs = urllib.parse.urlencode(
        {
            "key": api_key,
            "steamid": steam_id64,
            "steamidkey": auth_code,
            "knowncode": known_code,
        }
    )
    return f"{BASE}?{qs}"


def parse_next_code_response(payload):
    """Extrai o próximo share code de um corpo JSON. Devolve None quando não há mais."""
    data = payload if isinstance(payload, dict) else json.loads(payload)
    code = (data.get("result") or {}).get("nextcode")
    if not code or code == "n/a":
        return None
    return code


def _http_get_json(url, tentativas=4, backoff=5.0, sleep=time.sleep):
    """GET JSON com retry no 429 (rate limit da Steam Web API). Espera backoff crescente
    entre tentativas. Um 404 aqui significa 'sem próximo code ainda' (a Steam responde 404
    quando o knowncode é o mais recente) — tratado como fim da corrente, não erro."""
    for tentativa in range(tentativas):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"result": {"nextcode": "n/a"}}
            if e.code == 429 and tentativa < tentativas - 1:
                sleep(backoff * (tentativa + 1))
                continue
            raise


def buscar_avatares(api_key, steam_ids, http_get_json=_http_get_json):
    """Busca o avatar (avatarmedium, 64px) de cada steam_id64 via GetPlayerSummaries,
    em lotes de até 100 (limite da própria API). Devolve {steam_id64: avatar_url}.

    Um steamid sem perfil (banido/inexistente) simplesmente não vem na resposta —
    não é erro, só fica de fora do dict devolvido."""
    steam_ids = [s for s in dict.fromkeys(steam_ids) if s]  # dedup preservando ordem
    resultado = {}
    for i in range(0, len(steam_ids), LOTE_PLAYER_SUMMARIES):
        lote = steam_ids[i:i + LOTE_PLAYER_SUMMARIES]
        qs = urllib.parse.urlencode({"key": api_key, "steamids": ",".join(lote)})
        payload = http_get_json(f"{BASE_PLAYER_SUMMARIES}?{qs}")
        jogadores = (payload or {}).get("response", {}).get("players", [])
        for j in jogadores:
            steam_id = j.get("steamid")
            avatar = j.get("avatarmedium") or j.get("avatar")
            if steam_id and avatar:
                resultado[steam_id] = avatar
    return resultado


def walk_chain(
    api_key, steam_id64, auth_code, known_code,
    http_get_json=_http_get_json, limite=50, intervalo=1.2, sleep=time.sleep,
):
    """Gera os próximos share codes a partir de known_code, em ordem, até acabar ou bater o limite.

    Retorna a lista de códigos novos (não inclui o known_code inicial). Dá um respiro
    (`intervalo`) entre chamadas pra não tomar 429 da Steam.
    """
    novos = []
    atual = known_code
    for i in range(limite):
        url = build_next_code_url(api_key, steam_id64, auth_code, atual)
        payload = http_get_json(url)
        proximo = parse_next_code_response(payload)
        if not proximo:
            break
        novos.append(proximo)
        atual = proximo
        sleep(intervalo)
    return novos
