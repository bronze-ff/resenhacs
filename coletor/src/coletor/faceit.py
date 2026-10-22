"""Cliente da FACEIT Data API v4 + Downloads API (Fase B — ingestão automática).

HTTP sempre injetável (http_get_json=...) pra teste, igual steam_api.py. Auth por
header Bearer com a FACEIT_API_KEY (chave server-side criada no App Studio).
Formatos confirmados no swagger oficial (open.faceit.com/data/v4/docs/swagger.json).
"""

import gzip
import zlib
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from . import rede
from .storage_r2 import ArquivoGrandeDemaisError

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


# Tetos da demo da FACEIT (mesma ordem de grandeza do download da Valve em main.py):
# a resposta e o gzip descomprimido não podem crescer sem limite na memória do runner.
MAX_DEMO_COMPRIMIDA_BYTES = 1_000_000_000
MAX_DEMO_BYTES = 3_000_000_000


def _http_get_bytes(url, timeout=120, max_bytes=MAX_DEMO_COMPRIMIDA_BYTES, hosts_exatos=None):
    if urllib.parse.urlsplit(url).scheme != "https":
        raise RuntimeError("URL assinada da FACEIT sem https")
    partes = []
    total = 0
    with rede.abrir_url(url, timeout=timeout, hosts_exatos=hosts_exatos) as resp:
        content_length = resp.headers.get("Content-Length")
        # Recusa antes de ler: o tamanho anunciado já passa do teto.
        if content_length is not None and int(content_length) > max_bytes:
            raise ArquivoGrandeDemaisError(f"demo da FACEIT excedeu o teto de {max_bytes} bytes")
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise ArquivoGrandeDemaisError(f"demo da FACEIT excedeu o teto de {max_bytes} bytes")
            partes.append(chunk)
    # Corte de conexão no meio: sem isso a Demo parcial seguia pro parser.
    if content_length is not None and total != int(content_length):
        raise RuntimeError(f"download da FACEIT truncado: recebido {total} bytes, esperado {content_length}")
    return b"".join(partes)


# Hosts do CDN de Demo da FACEIT aceitos no link vindo da extensão (igualdade exata, em
# todo salto). Vazia até o X0 trazer os hosts reais: toda URL é recusada (falha fechada).
# Igual a shared/extensao/faceit-demo-hosts.json (teste de igualdade).
FACEIT_DEMO_HOSTS = ()
_MAX_ORIGEM_URL = 2048
MSG_LINK_EXPIRADO = "O link da FACEIT expirou. Envie o arquivo baixado pela página da Partida."


class LinkExpiradoError(Exception):
    """403/410 no link assinado da FACEIT. Definitivo: tentar de novo não muda."""

    def __init__(self):
        super().__init__(MSG_LINK_EXPIRADO)


class DownloadFaceitError(Exception):
    """Falha transitória no download do link da extensão, sem o link na mensagem."""


def validar_origem_url(url):
    """Link de Demo vindo da extensão: só https, até 2048 caracteres, sem usuário/senha,
    porta padrão e host exato em FACEIT_DEMO_HOSTS. Mensagens sem o link."""
    partes = urllib.parse.urlsplit(url)
    try:
        porta = partes.port
    except ValueError:
        porta = -1
    if (
        len(url) > _MAX_ORIGEM_URL or partes.scheme != "https"
        or partes.username is not None or partes.password is not None
        or porta not in (None, 443) or partes.hostname not in FACEIT_DEMO_HOSTS
    ):
        raise rede.HostNaoPermitidoError("link de Demo da FACEIT recusado")


def baixar_demo_origem(url, timeout=120):
    """Baixa o .dem.gz do link assinado que a extensão mandou (caminho B). A allowlist
    exata vale em todo redirect; Content-Length e leitura com teto de comprimido."""
    validar_origem_url(url)
    try:
        return _http_get_bytes(
            url, timeout=timeout, max_bytes=MAX_DEMO_COMPRIMIDA_BYTES, hosts_exatos=FACEIT_DEMO_HOSTS,
        )
    except urllib.error.HTTPError as e:
        if e.code in (403, 410):
            raise LinkExpiradoError() from None
        raise DownloadFaceitError(f"falha ao baixar a Demo da FACEIT (HTTP {e.code})") from None
    except (rede.HostNaoPermitidoError, ArquivoGrandeDemaisError):
        raise
    except Exception as e:  # noqa: BLE001
        # A exceção original (URLError, RuntimeError de truncado) pode trazer o link.
        raise DownloadFaceitError(f"falha ao baixar a Demo da FACEIT ({type(e).__name__})") from None


def _descomprimir_gzip_com_teto(dados, max_bytes=MAX_DEMO_BYTES):
    dec = zlib.decompressobj(16 + zlib.MAX_WBITS)
    saida = bytearray()
    restante = dados
    while restante:
        saida += dec.decompress(restante, max_bytes + 1 - len(saida))
        if len(saida) > max_bytes:
            raise RuntimeError(f"demo da FACEIT descomprimida excedeu o teto de {max_bytes} bytes")
        restante = dec.unconsumed_tail
    saida += dec.flush()
    if len(saida) > max_bytes:
        raise RuntimeError(f"demo da FACEIT descomprimida excedeu o teto de {max_bytes} bytes")
    if not dec.eof:
        raise RuntimeError("download da FACEIT truncado: stream gzip incompleto (sem EOF)")
    return bytes(saida)


# Piso da descoberta: a FACEIT usa "1 mês atrás" quando `from` não vem (foi o bug de
# ~3 meses com 0 partidas). Na primeira varredura de um membro o histórico inteiro de
# CS2 é pedido a partir do lançamento do CS2 (27/09/2023) — mesmo efeito de from=0,
# sem depender de como a API trata o zero.
INICIO_CS2_EPOCH = 1_695_772_800
# Teto de páginas por membro/rodada (100 itens cada) — só uma trava contra laço infinito.
MAX_PAGINAS = 50


def listar_historico_5v5(api_key, faceit_player_id, ja_vistas, desde=None, ate=None,
                         http_get_json=_http_get_json):
    """Anda /players/{id}/history?game=cs2&from=...&to=... paginando até o fim.

    `desde`/`ate`: epoch em segundos. `desde` None (primeira varredura) vira
    INICIO_CS2_EPOCH. Devolve {"novas", "na_api", "ja_conhecidas", "ignoradas"}:
    `novas` são as partidas 5v5 terminadas ainda não vistas, MAIS ANTIGA PRIMEIRO;
    os contadores alimentam o log da descoberta."""
    desde_efetivo = max(int(desde or 0), INICIO_CS2_EPOCH)
    novas, vistas_agora = [], set()
    na_api = ja_conhecidas = ignoradas = 0
    offset = 0
    for _ in range(MAX_PAGINAS):
        params = {"game": "cs2", "from": desde_efetivo, "offset": offset, "limit": PAGINA}
        if ate:
            params["to"] = int(ate)
        qs = urllib.parse.urlencode(params)
        payload = http_get_json(f"{BASE_DATA}/players/{faceit_player_id}/history?{qs}", api_key)
        items = payload.get("items") or []
        if not items:
            break
        for i in items:
            mid = i.get("match_id")
            if not mid or mid in vistas_agora:
                continue
            vistas_agora.add(mid)
            na_api += 1
            status = str(i.get("status") or "FINISHED").upper()
            if i.get("teams_size") != 5 or status != "FINISHED":
                ignoradas += 1
                continue
            if mid in ja_vistas:
                ja_conhecidas += 1
                continue
            novas.append({"faceit_match_id": mid, "finished_at": i.get("finished_at")})
        if len(items) < PAGINA:
            break
        offset += PAGINA
    novas.sort(key=lambda n: n.get("finished_at") or 0)
    return {"novas": novas, "na_api": na_api, "ja_conhecidas": ja_conhecidas,
            "ignoradas": ignoradas}


def sem_acesso_downloads(exc):
    """True quando o erro é a Downloads API recusando a chave (403; 401 por garantia).
    É o caso de chave sem a aprovação separada da FACEIT — ver docs/operacao.md."""
    import urllib.error

    return isinstance(exc, urllib.error.HTTPError) and exc.code in (401, 403)


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
        return _descomprimir_gzip_com_teto(dados)
    return dados


def _epoch_para_iso(epoch):
    if not epoch:
        return None
    return datetime.fromtimestamp(int(epoch), tz=timezone.utc).isoformat()


def _num(v):
    """'84.3' / '12' / 7 -> float; ausente ou lixo -> None (não confunde com zero)."""
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _int(v, padrao=0):
    n = _num(v)
    return int(n) if n is not None else padrao


def _int_ou_none(v):
    n = _num(v)
    return int(n) if n is not None else None


def _rounds_do_placar(round_stats, placar):
    """Rounds jogados: 'Rounds' do /stats; senão o 'Score' do /stats ('13 / 7');
    senão a soma do placar de /matches/{id}."""
    total = _int(round_stats.get("Rounds"))
    if total:
        return total
    score = str(round_stats.get("Score") or "")
    partes = [p for p in score.replace(":", "/").split("/") if p.strip()]
    if len(partes) == 2:
        soma = _int(partes[0].strip()) + _int(partes[1].strip())
        if soma:
            return soma
    return _int(placar.get("faction1")) + _int(placar.get("faction2"))


def _mapa(round_stats, detalhes):
    mapa = round_stats.get("Map")
    if mapa:
        return mapa
    pick = (((detalhes.get("voting") or {}).get("map") or {}).get("pick")) or []
    return pick[0] if pick else ""


def _stats_do_jogador(ps, rounds_total):
    """Converte o player_stats do /matches/{id}/stats (CS2) nas colunas de
    match_players. Só preenche o que a FACEIT manda; o resto fica no padrão (0/None)."""
    kills = _int(ps.get("Kills"))

    headshots = _int_ou_none(ps.get("Headshots"))
    if headshots is None:
        hs_pct = _num(ps.get("Headshots %"))
        headshots = round(kills * hs_pct / 100) if hs_pct is not None else 0

    damage = _int_ou_none(ps.get("Damage"))
    if damage is None:
        adr = _num(ps.get("ADR"))
        damage = round(adr * rounds_total) if adr is not None and rounds_total else 0

    out = {
        "kills": kills,
        "deaths": _int(ps.get("Deaths")),
        "assists": _int(ps.get("Assists")),
        "headshot_kills": headshots,
        "damage": damage,
        "mvps": _int_ou_none(ps.get("MVPs")),
        "triple_kills": _int_ou_none(ps.get("Triple Kills")),
        "quadro_kills": _int_ou_none(ps.get("Quadro Kills")),
        "penta_kills": _int_ou_none(ps.get("Penta Kills")),
    }

    # Duelo de abertura: "Entry Wins" = aberturas vencidas, "Entry Count" = aberturas
    # disputadas. entry_wins (abertura + round ganho) não existe na API: fica 0.
    entry_vencidas = _int_ou_none(ps.get("Entry Wins"))
    if entry_vencidas is None:
        entry_vencidas = _int_ou_none(ps.get("First Kills"))
    entry_total = _int_ou_none(ps.get("Entry Count"))
    if entry_vencidas is not None:
        out["entry_kills"] = entry_vencidas
        if entry_total is not None:
            out["entry_deaths"] = max(entry_total - entry_vencidas, 0)

    # Clutch: a API só detalha 1v1 e 1v2.
    tentativas = [_int_ou_none(ps.get(k)) for k in ("1v1Count", "1v2Count")]
    vitorias = [_int_ou_none(ps.get(k)) for k in ("1v1Wins", "1v2Wins")]
    if any(v is not None for v in tentativas):
        out["clutch_attempts"] = sum(v or 0 for v in tentativas)
        out["clutch_wins"] = sum(v or 0 for v in vitorias)

    for chave_api, coluna in (("Flash Count", "flashes_thrown"),
                              ("Enemies Flashed", "enemies_flashed"),
                              ("Utility Damage", "utility_damage")):
        v = _int_ou_none(ps.get(chave_api))
        if v is not None:
            out[coluna] = v
    return out


def montar_parsed_stats_only(detalhes, stats):
    """Monta o dict `parsed` aceito por db.store_parsed a partir só da API (Partida sem
    Demo): placar, mapa, data e o que o /matches/{id}/stats do CS2 entrega por jogador —
    K/D/A, HS, dano (Damage, ou ADR × rounds), aberturas, clutch 1v1/1v2, flashes e dano
    de utilitária. MVPs e Triple/Quadro/Penta vão em chaves próprias (gravadas à parte
    por db.gravar_extras_faceit). KAST, rating, economia, Replay 2D e granadas só a Demo
    produz: ficam nulos/vazios e a UI esconde o que é nulo."""
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

    rounds_total = _rounds_do_placar(round_stats, placar)
    players = []
    for faccao, letra in (("faction1", "A"), ("faction2", "B")):
        for r in (times.get(faccao) or {}).get("roster") or []:
            ps = stats_por_faceit_id.get(r.get("player_id"), {})
            players.append({
                "steam_id64": r.get("game_player_id"),
                "nick": r.get("nickname") or "",
                "team": letra,
                **_stats_do_jogador(ps, rounds_total),
                "rounds_played": rounds_total,
                "won": (vencedor == faccao) if vencedor in ("faction1", "faction2") else None,
                "weapons": {},
            })

    return {
        "map": _mapa(round_stats, detalhes),
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
