"""Cliente da Steam Web API para andar a corrente de share codes.

GetNextMatchSharingCode devolve o share code da PRÓXIMA Partida de um Jogador a
partir de um código conhecido. Andando essa corrente descobrimos Partidas novas
sem depender do cliente do jogo. (O download do .dem de matchmaking exige o Game
Coordinator via conta-bot — ver parse.py/README; a corrente aqui só descobre.)
"""

import json
import urllib.parse
import urllib.request

BASE = "https://api.steampowered.com/ICSGOPlayers_730/GetNextMatchSharingCode/v1/"


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


def _http_get_json(url):
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def walk_chain(api_key, steam_id64, auth_code, known_code, http_get_json=_http_get_json, limite=50):
    """Gera os próximos share codes a partir de known_code, em ordem, até acabar ou bater o limite.

    Retorna a lista de códigos novos (não inclui o known_code inicial).
    """
    novos = []
    atual = known_code
    for _ in range(limite):
        url = build_next_code_url(api_key, steam_id64, auth_code, atual)
        payload = http_get_json(url)
        proximo = parse_next_code_response(payload)
        if not proximo:
            break
        novos.append(proximo)
        atual = proximo
    return novos
