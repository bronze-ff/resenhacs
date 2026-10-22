"""Orquestrador do Coletor.

Dois modos:
  discover  — anda a corrente de share codes de cada Jogador (Steam Web API) e
              registra as Partidas novas como 'pending' (sem demo ainda).
  ingest    — parseia um .dem local, arquiva no R2 e grava os stats/highlights.

O download automático do .dem de matchmaking exige o Game Coordinator (conta-bot),
fora do escopo da Fase 2 — por isso 'discover' só descobre, e 'ingest' cobre o
caminho manual (o player/admin baixa o .dem e roda aqui). Ver README do coletor.

Data da Partida (played_at): o formato .dem não guarda data/hora em lugar nenhum.
'discover' grava a hora da descoberta (bem próxima da hora real, já que roda de
hora em hora); 'ingest' manual, sem --played-at, cai pra mtime do arquivo — que
pode estar bem errada se o .dem foi baixado dias depois de jogado. Use --played-at
quando souber a data certa.
"""

import argparse
import sys

import bz2
import datetime
import hashlib
import json
import subprocess
import urllib.parse
import urllib.request
import uuid

from . import db as dbmod
from . import discord
from . import parse as parsemod
from . import replay as replaymod
from . import lineups as lineupsmod
from . import sharecode
from . import steam_api
from . import faceit
from . import faceit_sync
from . import descompressao
from . import rede
from . import storage_r2
from . import transform
from .config import Config
from .observabilidade import FalhaTotalDiscover, capturar_erro, em_monitor_discover, init_sentry

# Janela em que o .dem bruto fica no R2 (ADR-0006). O workflow passa o mesmo número
# em `cleanup --days`. replay.json, uploads e curso-mira/ não entram nessa conta.
RETENCAO_DEMO_DIAS = 14


def cmd_discover(config, conn):
    config.require("steam_api_key")
    total = 0
    jogadores = dbmod.list_tracked_players(conn)
    falhas = 0
    for steam_id64, auth_code, last_code in jogadores:
        # Um jogador com auth code inválido/expirado (ou rate limit persistente) não deve
        # abortar a descoberta dos outros.
        try:
            novos = steam_api.walk_chain(config.steam_api_key, steam_id64, auth_code, last_code)
        except Exception as e:  # noqa: BLE001
            capturar_erro(e, "discover")
            print(f"{_ref(steam_id64)}: erro ao andar a corrente ({type(e).__name__}) — pulando")
            falhas += 1
            continue
        for code in novos:
            if sharecode.is_valid(code):
                dbmod.record_pending_match(conn, code, discovered_by=steam_id64)
                total += 1
        if novos:
            dbmod.set_last_share_code(conn, steam_id64, novos[-1])
        print(f"{_ref(steam_id64)}: {len(novos)} share codes novos")
    print(f"discover: {total} Partidas pendentes registradas")
    if jogadores and falhas == len(jogadores):
        # Todos falharam (Steam fora, chave revogada): em_monitor_discover marca o
        # check-in do cron como error, sem derrubar o processo.
        raise FalhaTotalDiscover(f"discover: falha total ({falhas} Jogadores)")
    return total


# Logs do Coletor saem no GitHub Actions de um repositório PÚBLICO: SteamID64 e share
# code não podem aparecer em claro (o share code baixa a demo, com os 10 jogadores).
# `_ref` dá uma referência curta e estável (mesmo valor -> mesma ref) pra cruzar linhas
# de log sem expor o dado.
def _ref(valor):
    return "#" + hashlib.sha256(str(valor).encode("utf-8")).hexdigest()[:8]


def _resolver_demo_urls(codes, bot_dir, node_bin):
    """Chama o bot (Node) pra resolver share codes → links de .dem via Game Coordinator.
    Devolve [{shareCode, demoUrl, matchTime}]. O bot loga na conta-bot uma vez e resolve
    todos os codes numa sessão (ver bot/src/resolve.js).

    Credenciais: STEAM_BOT_USER/PASS do ambiente (caso do CI); rodando local, se não
    estiverem no ambiente, carrega do bot/.env (git-ignored) — o subprocess não herda
    o --env-file do Node sozinho."""
    import os
    import subprocess

    env = dict(os.environ)
    if not env.get("STEAM_BOT_USER") or not env.get("STEAM_BOT_PASS"):
        dotenv = bot_dir / ".env"
        if dotenv.exists():
            for linha in dotenv.read_text(encoding="utf-8").splitlines():
                linha = linha.strip()
                if linha and not linha.startswith("#") and "=" in linha:
                    k, _, v = linha.partition("=")
                    env.setdefault(k.strip(), v.strip())

    proc = subprocess.run(
        [node_bin, "src/resolve.js", *codes],
        cwd=str(bot_dir),
        env=env,
        capture_output=True,
        text=True,
        timeout=60 + len(codes) * 20,
    )
    if not proc.stdout.strip():
        raise RuntimeError(f"bot não devolveu nada (stderr: {proc.stderr[-400:]})")
    return json.loads(proc.stdout)


# Tetos do download de demo da Valve. Uma demo de CS2 real fica na casa de dezenas a
# poucas centenas de MB descomprimida; os tetos ficam bem acima disso pra nunca barrar
# partida legítima, só lixo/ataque.
_MAX_DEM_COMPRIMIDO_BYTES = 1_000_000_000
_MAX_DEM_BYTES = 3_000_000_000
_BLOCO_DESCOMPRESSAO = 8 << 20


def _baixar_e_descomprimir(url, destino_dem):
    """Baixa um .dem.bz2 da Valve e descomprime em streaming pro caminho .dem indicado.

    Valida integridade em duas frentes — sem isso, um corte de conexão no meio do
    download (comum na CDN da Valve) resultava num .dem parcial sendo parseado "com
    sucesso" e gravando stats errados, em silêncio: (1) bytes recebidos batem com o
    Content-Length declarado pela resposta HTTP, quando o header existe; (2) o
    decompressor bz2 terminou o stream de verdade (dec.eof), não só parou de receber
    bytes — cobre o caso de a CDN não mandar Content-Length.
    """
    # Segurança: a URL vem do Game Coordinator via bot, mas só http(s) entra (urllib
    # também abriria file:// e ftp://), e o .dem descomprimido tem teto — sem ele um
    # bz2 pequeno e malicioso (bomba de descompressão) enchia o disco do runner.
    if urllib.parse.urlsplit(url).scheme not in ("http", "https"):
        raise RuntimeError(f"URL de demo com esquema não permitido: {url[:40]}")
    dec = bz2.BZ2Decompressor()
    with rede.abrir_url(url, timeout=120) as resp, open(destino_dem, "wb") as out:
        content_length = resp.headers.get("Content-Length")
        esperado = int(content_length) if content_length is not None else None
        recebido = 0
        escrito = 0
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            recebido += len(chunk)
            if recebido > _MAX_DEM_COMPRIMIDO_BYTES:
                raise RuntimeError(f"download excedeu o teto de {_MAX_DEM_COMPRIMIDO_BYTES} bytes")
            # max_length limita a saída de cada chamada; o laço drena o resto sem
            # nunca materializar mais do que um bloco por vez.
            parte = dec.decompress(chunk, max_length=_BLOCO_DESCOMPRESSAO)
            while True:
                escrito += len(parte)
                if escrito > _MAX_DEM_BYTES:
                    raise RuntimeError(f"demo descomprimida excedeu o teto de {_MAX_DEM_BYTES} bytes")
                out.write(parte)
                if dec.eof or dec.needs_input:
                    break
                parte = dec.decompress(b"", max_length=_BLOCO_DESCOMPRESSAO)

    if esperado is not None and recebido != esperado:
        raise RuntimeError(f"download truncado: recebido {recebido} bytes, esperado {esperado}")
    if not dec.eof:
        raise RuntimeError("download truncado: stream bz2 incompleto (sem EOF)")


# Auditoria finding #16: a fila de Partidas Pro (hltvUrl) lia a resposta inteira em
# memória de uma vez (resp.read() sem teto). A validação de origem em si (allowlist
# hltv.org) já vive em site/server/src/routes/partidasPro.js, ANTES de enfileirar — mas
# mesmo restrito ao domínio certo, uma resposta inesperadamente enorme (ou um redirect
# pra outro lugar que a validação de string não pega) não devia poder estourar a memória
# do runner. 1GB cobre uma série Bo5 inteira num único .rar com folga.
_MAX_HLTV_DOWNLOAD_BYTES = 1_000_000_000


def _baixar_com_teto(url, max_bytes, timeout=120):
    """Baixa `url` em streaming (chunks de 1MB), abortando assim que o total lido
    ultrapassa `max_bytes` — em vez de só descobrir que era grande demais depois de
    um resp.read() completo já ter consumido a memória inteira."""
    # O server já restringe a hltv.org; o redirect segue só a regra de IP (R120).
    with rede.abrir_url(url, timeout=timeout, dominios=("hltv.org",)) as resp:
        partes = []
        total = 0
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise RuntimeError(f"download de {url} excedeu o teto de {max_bytes} bytes")
            partes.append(chunk)
        return b"".join(partes)


# Erro transitório na CDN da Valve (502/503, timeout de rede — aconteceu de verdade em
# 2026-07-22, share_code CSGO-t7Wnv-cjwub-UOS5t-iEfz2-ZLhnL) não pode marcar a Partida
# como 'failed' de cara: dbmod.falhar_fetch_pendente dá algumas tentativas (mesma
# semântica de falhar_faceit_pendente) antes de desistir de vez.
_MAX_TENTATIVAS_FETCH = 3


def cmd_fetch(config, conn, since=None, bot_dir=None, node_bin="node"):
    """Baixa e ingere as Partidas pendentes (descobertas pelo discover, ainda sem demo).

    Fluxo: lista pendentes → bot resolve os links do .dem via GC → baixa/descomprime →
    ingere com played_at = matchtime real (bem mais confiável que a mtime do arquivo).
    `since` (YYYY-MM-DD, opcional) ingere só Partidas a partir dessa data; as anteriores
    viram 'skipped' pra não serem re-tentadas toda hora.
    """
    import datetime
    import tempfile
    from pathlib import Path

    # Lote por run: baixar+parsear é serial (~1-2 min/demo) e o job do Actions tem 45 min.
    # Com a fila grande (noite de jogatina), resolver/baixar tudo de uma vez estoura o timeout
    # e o run é cancelado SEM commitar o lote inteiro. Limitando por run, cada execução termina
    # e commita cada partida; os runs de 30 em 30 min drenam o resto (FIFO por played_at).
    LIMITE_POR_RUN = 15
    codes = dbmod.list_pending_share_codes(conn, limit=LIMITE_POR_RUN)
    if not codes:
        print("fetch: nenhuma Partida pendente")
        return 0
    restantes = dbmod.contar_pendentes(conn)
    if restantes > len(codes):
        print(f"fetch: {restantes} pendentes na fila — processando as {len(codes)} mais antigas neste run")

    bot_dir = bot_dir or (Path(__file__).resolve().parents[3] / "bot")
    print(f"fetch: resolvendo {len(codes)} share code(s) via Game Coordinator…")
    try:
        resolvidos = _resolver_demo_urls(codes, bot_dir, node_bin)
    except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        # Bot fora (Steam, LoggedInElsewhere, timeout do GC): as Partidas continuam
        # pendentes sem gastar tentativa, e o job segue pros passos seguintes
        # (cleanup, uploads, FACEIT). O stderr do bot não vai pro log público.
        capturar_erro(e, "fetch")
        print(f"fetch: bot não resolveu os share codes ({type(e).__name__}) — tenta de novo na próxima run")
        return 0

    since_ts = None
    if since:
        since_ts = datetime.datetime.fromisoformat(since).replace(tzinfo=datetime.timezone.utc).timestamp()

    total = 0
    for r in resolvidos:
        code, url, mt = r.get("shareCode"), r.get("demoUrl"), r.get("matchTime")
        if not url:
            # Gasta tentativa: sem isso, um código que o GC nunca resolve ficava no topo
            # da fila pra sempre e segurava o lote de 15.
            print(f"  {_ref(code)}: sem link de demo (GC não devolveu)")
            dbmod.falhar_fetch_pendente(
                conn, code, "GC não devolveu link de demo", max_tentativas=_MAX_TENTATIVAS_FETCH,
            )
            continue
        if since_ts is not None and mt is not None and mt < since_ts:
            print(f"  {_ref(code)}: antes de {since} — marcando como skipped")
            dbmod.mark_skipped(conn, code)
            continue
        played_at = (
            datetime.datetime.fromtimestamp(mt, tz=datetime.timezone.utc).isoformat() if mt else None
        )
        try:
            with tempfile.TemporaryDirectory() as tmp:
                dem = Path(tmp) / "match.dem"
                # Auditoria finding #10: nunca logar a URL assinada de download — ela
                # dá acesso direto ao .dem por tempo limitado, sem exigir autenticação
                # nenhuma; o share code já identifica a Partida sem vazar isso.
                print(f"  {_ref(code)}: baixando demo")
                _baixar_e_descomprimir(url, dem)
                mid = ingest_demo(
                    config, conn, dem, share_code=code, source="valve_mm",
                    upload=True, played_at=played_at,
                )
                print(f"  {_ref(code)}: ingerida {mid} (played_at={played_at})")
                total += 1
        except Exception as e:  # noqa: BLE001
            # Uma partida com demo problemático não derruba o lote; registra a tentativa
            # (mesmo padrão de falhar_faceit_pendente) em vez de marcar 'failed' de cara —
            # erro transitório da CDN da Valve (502/503, timeout) não deve custar a
            # Partida inteira numa falha só. Só vira 'failed' de vez após esgotar as
            # tentativas; até lá fica 'pending' e é re-baixada automaticamente no
            # próximo ciclo do fetch.
            conn.rollback()
            capturar_erro(e, "fetch")
            print(f"  {_ref(code)}: FALHOU ({type(e).__name__})")
            # Host recusado (R120) não muda tentando de novo: failed na primeira.
            definitivo = isinstance(e, rede.HostNaoPermitidoError)
            dbmod.falhar_fetch_pendente(
                conn, code, e, max_tentativas=1 if definitivo else _MAX_TENTATIVAS_FETCH,
            )

    print(f"fetch: {total} Partida(s) ingerida(s)")
    return total


def cmd_cleanup(config, conn, days=RETENCAO_DEMO_DIAS):
    """Apaga do R2 o .dem BRUTO (não o replay.json, que a UI usa pra sempre) de Partidas
    com played_at há mais de `days` dias. ADR-0006: 14 dias, pra o bucket resenha-demos
    caber perto do free tier do R2. replay_url continua intacto; só demo_url vira NULL
    (a rota /:id/demo e o pedido de clipe Allstar já devolvem 404 nesse caso)."""
    import datetime

    limite = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    with conn.cursor() as cur:
        # greatest ignora nulo: Partida sem played_at cai em created_at, e uma ingestão
        # tardia (Partida antiga enviada agora) ganha os 14 dias a partir da chegada.
        cur.execute(
            "select id, demo_url from matches where status = 'parsed' and demo_url is not null "
            "and greatest(played_at, created_at) < %s",
            (limite,),
        )
        rows = cur.fetchall()
    if not rows:
        print(f"cleanup: nenhuma Partida com demo mais velha que {days} dias")
        return 0

    client = storage_r2.make_client(config)
    total = 0
    for match_id, demo_url in rows:
        key = storage_r2.key_from_url(demo_url, config.r2_bucket)
        if not key:
            continue
        try:
            storage_r2.delete_object(client, config.r2_bucket, key)
            with conn.cursor() as cur:
                cur.execute("update matches set demo_url = null where id = %s", (match_id,))
            conn.commit()
            total += 1
            print(f"  {match_id}: demo apagado ({key})")
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            capturar_erro(e, "cleanup")
            print(f"  {match_id}: falha ao apagar ({type(e).__name__})")
    print(f"cleanup: {total} demo(s) apagado(s)")
    return total


def _agrupar_dems_por_mapa(dem_paths):
    """Agrupa `dem_paths` (ordem de extração do .rar = ordem real da série) por mapa,
    só quando ADJACENTES — um reinício técnico no meio de um mapa faz o HLTV distribuir
    esse mapa como 2+ .dem seguidos (ver docstring de ingest_demo_multiparte). O nome
    do arquivo (-p1/-p2) é convenção, não garantia; o mapa vem do header de cada .dem
    (parsemod.cabecalho_mapa, barato — não parseia o arquivo inteiro). Não agrupa mapas
    iguais não-adjacentes: isso não deveria acontecer numa série real (repetir mapa).

    Com 1 único .dem (caso comum) nem precisa abrir o arquivo pra descobrir o mapa —
    não há nada pra comparar."""
    if len(dem_paths) <= 1:
        return [list(dem_paths)]
    grupos = []
    for path in dem_paths:
        mapa = parsemod.cabecalho_mapa(path)
        if grupos and grupos[-1][0] == mapa:
            grupos[-1][1].append(path)
        else:
            grupos.append((mapa, [path]))
    return [g[1] for g in grupos]


def cmd_processar_fila_pro(config, conn):
    """Processa a fila de partida profissional: baixa .rar/.dem (do HLTV ou de um
    upload manual em staging no R2 — hltv.org bloqueia download automático atrás de
    um desafio Cloudflare, então o caminho normal é o admin subir o arquivo pela UI),
    extrai o .dem se necessário, ingere pelo mesmo pipeline de sempre (source='pro').
    Roda no job agendado (não numa request HTTP do site — a Vercel não aguenta
    baixar/parsear demo grande síncrono)."""
    import tempfile
    import urllib.request
    from pathlib import Path

    from . import rar_extract

    interrompidos = dbmod.interromper_fila_pro(conn)
    if interrompidos:
        print(f"processar-fila-pro: {len(interrompidos)} item(ns) interrompido(s) no run anterior viraram 'falhou'")

    pendentes = dbmod.listar_fila_pro_pendente(conn)
    if not pendentes:
        print("processar-fila-pro: nenhuma partida pendente")
        return 0

    client = storage_r2.make_client(config)
    total = 0
    for fila_id, hltv_url, arquivo_r2_key, adicionado_em in pendentes:
        dbmod.atualizar_fila_pro(conn, fila_id, "baixando")
        concluida = False
        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp = Path(tmp)
                if arquivo_r2_key:
                    print(f"  {fila_id}: baixando do R2 ({arquivo_r2_key})")
                    dados = storage_r2.download_bytes(
                        client, config.r2_bucket, arquivo_r2_key, max_bytes=_MAX_HLTV_DOWNLOAD_BYTES,
                    )
                    ext = Path(arquivo_r2_key).suffix.lower()
                else:
                    print(f"  {fila_id}: baixando {hltv_url}")
                    dados = _baixar_com_teto(hltv_url, _MAX_HLTV_DOWNLOAD_BYTES)
                    ext = ".rar"

                dbmod.atualizar_fila_pro(conn, fila_id, "processando")
                # Um .rar do HLTV pode trazer vários mapas de uma série Bo3/Bo5 — um
                # .dem por mapa, exceto quando um reinício técnico no meio de um mapa
                # faz o HLTV distribuir ESSE mapa em 2+ .dem seguidos (mesmo grupo,
                # ver _agrupar_dems_por_mapa/ingest_demo_multiparte). Cada GRUPO
                # processa (e falha) de forma isolada: um mapa com erro não deve
                # derrubar os outros mapas da MESMA série. Upload manual de um .dem
                # avulso pula a extração — já é o arquivo final, grupo de 1.
                if ext == ".dem":
                    dem_path = tmp / "demo.dem"
                    dem_path.write_bytes(dados)
                    grupos = [[dem_path]]
                else:
                    rar_path = tmp / "demo.rar"
                    rar_path.write_bytes(dados)
                    dem_paths = rar_extract.extrair_dems_de_rar(rar_path, tmp / "extraido")
                    grupos = _agrupar_dems_por_mapa(dem_paths)

                match_ids = []
                mapas_falhos = []
                for grupo in grupos:
                    try:
                        if len(grupo) == 1:
                            mid = ingest_demo(config, conn, grupo[0], source="pro", upload=True)
                        else:
                            mid = ingest_demo_multiparte(config, conn, grupo, source="pro", upload=True)
                        match_ids.append(mid)
                    except Exception as e:  # noqa: BLE001
                        conn.rollback()
                        # Vai pra coluna erro (só o super admin vê), não pro log público.
                        mapas_falhos.append(f"{grupo[0].name} ({type(e).__name__}: {str(e)[:120]})")
                        capturar_erro(e, "processar-fila-pro")
                        print(f"  {fila_id}: mapa {grupo[0].name} FALHOU ({type(e).__name__})")

                if mapas_falhos:
                    # Série incompleta: 'falhou' guardando os mapas já gravados, e o
                    # staging fica pro retry do admin. No retry, os mapas que já
                    # entraram casam pelo fingerprint e não duplicam.
                    erro = (
                        f"{len(match_ids)}/{len(grupos)} mapas processados; "
                        f"falharam: {', '.join(mapas_falhos)}"
                    )[:500]
                    dbmod.atualizar_fila_pro(
                        conn, fila_id, "falhou",
                        match_id=match_ids[0] if match_ids else None, match_ids=match_ids, erro=erro,
                    )
                    print(f"  {fila_id}: FALHOU ({len(match_ids)}/{len(grupos)} mapa(s))")
                    continue

                dbmod.atualizar_fila_pro(conn, fila_id, "concluida", match_id=match_ids[0], match_ids=match_ids)
                print(f"  {fila_id}: concluida ({len(match_ids)}/{len(grupos)} mapa(s))")
                total += 1
                concluida = True
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            if arquivo_r2_key and storage_r2.objeto_ausente(e):
                # O PUT do admin ainda pode estar subindo (URL assinada vale 15 min).
                if _staging_recente(adicionado_em):
                    dbmod.atualizar_fila_pro(conn, fila_id, "pendente")
                    print(f"  {fila_id}: arquivo ainda não chegou ao R2 — espera a próxima run")
                else:
                    dbmod.atualizar_fila_pro(conn, fila_id, "falhou", erro="o arquivo não chegou ao R2")
                    print(f"  {fila_id}: FALHOU (arquivo não chegou ao R2)")
                continue
            capturar_erro(e, "processar-fila-pro")
            dbmod.atualizar_fila_pro(conn, fila_id, "falhou", erro=str(e)[:500])
            print(f"  {fila_id}: FALHOU ({type(e).__name__})")

        # Staging só sai quando a série inteira entrou. Fora do try: falha no delete
        # não muda status nem match_ids (o órfão fica pro retry/limpeza).
        if concluida and arquivo_r2_key:
            try:
                storage_r2.delete_object(client, config.r2_bucket, arquivo_r2_key)
            except Exception as e_del:  # noqa: BLE001
                capturar_erro(e_del, "processar-fila-pro")
                print(f"  {fila_id}: aviso — staging não foi apagado do R2 ({type(e_del).__name__})")

    print(f"processar-fila-pro: {total} partida(s) processada(s)")
    return total


# Auditoria finding #2: teto de tamanho aplicado no HEAD do objeto antes do download
# (ver storage_r2.download_bytes) — mesmo valor comunicado ao usuário no upload.js.
_MAX_UPLOAD_BYTES = 400 * 1024 * 1024

# Auditoria finding #8: quanto tempo um item pode ficar 'processando' antes de ser
# considerado travado (processo morreu no meio — crash do runner, timeout do job).
_TIMEOUT_PROCESSANDO_MINUTOS = 30

# Erro transitório num upload manual: quantas tentativas antes de virar 'falhou'.
_MAX_TENTATIVAS_UPLOAD = 3

# Staging ausente no R2 até esta idade é PUT ainda em andamento (a URL assinada vale
# 15 min), não falha. Depois disso o arquivo não vem mais.
_JANELA_STAGING_AUSENTE = datetime.timedelta(minutes=20)


def _staging_recente(adicionado_em):
    if adicionado_em is None:
        return False
    return datetime.datetime.now(datetime.timezone.utc) - adicionado_em < _JANELA_STAGING_AUSENTE


class DemoNaoConfereError(Exception):
    """A Demo enviada não corresponde à Partida que o envio diz enriquecer.

    Erro DEFINITIVO, não transitório: retry não melhora, então quem trata apaga
    o staging do R2 em vez de guardar pra próxima rodada."""


def _validar_demo_contra_alvo(parsed, alvo):
    """Validação estrita do envio amarrado a uma Partida: mapa igual, os mesmos
    Participantes E o mesmo placar. O roster da Partida FACEIT vem da API
    oficial, então 10 steam ids batendo já é forte prova de que é a Partida
    certa — mas duas Partidas do MESMO lobby, no MESMO mapa, na mesma noite,
    têm mapa e roster IDÊNTICOS; sem o placar, a validação aceitaria a demo de
    uma no lugar da outra, e a Partida errada receberia silenciosamente
    placar/rounds/stats de outro jogo. Não depende de K/D (que o parser conta
    diferente da API) nem de horário (o .dem não guarda data).

    Portão de mapa pulado quando `alvo["map"]` está vazio/nulo: o caminho
    stats-only da FACEIT (faceit.montar_parsed_stats_only) grava matches.map = ""
    quando a API não devolve o mapa — recusar por mapa vazio trancaria essa
    Partida pra sempre, sem nenhum jeito de enriquecer (o arquivo seria sempre
    apagado do R2 na validação). O cliente já trata esse caso (o pré-check
    de mapa deixa passar quando o mapa da Partida está vazio); aqui, o conjunto
    EXATO dos 10 steam ids já é prova suficiente de que é a Partida certa.
    """
    if alvo["map"] and parsed.get("map") != alvo["map"]:
        raise DemoNaoConfereError(
            f"o mapa da demo ({parsed.get('map')}) não confere com o desta partida ({alvo['map']})"
        )
    ids_demo = {p.get("steam_id64") for p in parsed.get("players", [])}
    if ids_demo != alvo["steam_ids"]:
        raise DemoNaoConfereError("os jogadores da demo não são os desta partida")

    # Placar sem ordem: no caminho stats-only da FACEIT (faceit.montar_parsed_
    # stats_only), o time A é a faction1 da API e o B a faction2 — mas o parser
    # atribui A/B pela lógica dele a partir da demo, sem garantia de que os dois
    # lados cheguem à mesma atribuição. Comparar score_a==score_a/score_b==score_b
    # recusaria demos legítimas sistematicamente só porque os lados vieram
    # invertidos; comparar o PAR sem ordem ({13,7} contra {13,7}) ainda pega a
    # partida errada (13:11 contra 13:7 não bate) sem esse falso positivo.
    # Placar ausente na Partida alvo (None em qualquer um dos dois) pula a
    # checagem — mesmo raciocínio do portão de mapa: dado ausente não pode virar
    # bloqueio permanente.
    if alvo.get("score_a") is not None and alvo.get("score_b") is not None:
        placar_alvo = {alvo["score_a"], alvo["score_b"]}
        placar_demo = {parsed.get("score_a"), parsed.get("score_b")}
        if placar_demo != placar_alvo:
            raise DemoNaoConfereError(
                f"o placar da demo ({parsed.get('score_a')}x{parsed.get('score_b')}) não "
                f"confere com o desta partida ({alvo['score_a']}x{alvo['score_b']})"
            )


def cmd_processar_uploads_pendentes(config, conn):
    """Processa a fila de uploads manuais de demo (qualquer membro do grupo, via
    'Enviar Demo' no site): baixa o .dem do R2 (staging de upload direto via URL
    pré-assinada — a Vercel não aguenta receber o arquivo síncrono, ver
    site/server/src/routes/upload.js)."""
    import tempfile
    from pathlib import Path

    # Antes de listar: qualquer item preso em 'processando' há mais que o teto (o
    # processo anterior morreu no meio, sem chance de marcar 'concluido'/'falhou')
    # volta a ficar elegível — senão fica 'processando' pra sempre (achado #8).
    revertidos = dbmod.reverter_uploads_travados(conn, minutos=_TIMEOUT_PROCESSANDO_MINUTOS)
    if revertidos:
        print(f"processar-uploads-pendentes: {len(revertidos)} upload(s) travado(s) em 'processando' revertido(s)")

    pendentes = dbmod.listar_uploads_pendentes(conn)
    if not pendentes:
        print("processar-uploads-pendentes: nenhum upload pendente")
        return 0

    client = storage_r2.make_client(config)
    total = 0
    for (upload_id, adicionado_por, arquivo_r2_key, share_code, played_at,
         plataforma_manual, match_alvo_id, adicionado_em) in pendentes:
        dbmod.atualizar_upload_pendente(conn, upload_id, "processando")
        concluido = False
        try:
            alvo = None
            # Com alvo, a Partida enriquecida CONTINUA sendo a mesma Partida que já
            # era (ex.: 'faceit') — só ganha os stats do parser por cima. Sem isso,
            # o ingest gravava source='upload' incondicionalmente e a Partida
            # perdia a identidade: o badge de plataforma sumia, origemPartida
            # virava "MANUAL" e a competição passava a marcar como origem não
            # verificada (ver spec, seção 5).
            source_do_upload = "upload"
            if match_alvo_id:
                dados = dbmod.dados_da_partida_alvo(conn, match_alvo_id)
                if dados is None:
                    raise DemoNaoConfereError("a partida deste envio não existe mais")
                alvo = {
                    "match_id": match_alvo_id, "map": dados["map"], "steam_ids": dados["steam_ids"],
                    "score_a": dados["score_a"], "score_b": dados["score_b"],
                }
                source_do_upload = dados["source"]

            with tempfile.TemporaryDirectory() as tmp:
                tmp = Path(tmp)
                print(f"  {upload_id}: baixando do R2 ({arquivo_r2_key})")
                dados_dem = storage_r2.download_bytes(
                    client, config.r2_bucket, arquivo_r2_key, max_bytes=_MAX_UPLOAD_BYTES,
                )
                dem_path = tmp / "demo.dem"
                if arquivo_r2_key.endswith(".dem.gz"):
                    descompressao.descomprimir_gzip(
                        dados_dem, dem_path, max_bytes=_MAX_UPLOAD_BYTES,
                    )
                else:
                    dem_path.write_bytes(dados_dem)

                match_id = ingest_demo(
                    config, conn, dem_path,
                    share_code=share_code, source=source_do_upload, upload=True,
                    played_at=played_at, plataforma_manual=plataforma_manual,
                    alvo=alvo, enviado_por=adicionado_por,
                )
                dbmod.atualizar_upload_pendente(conn, upload_id, "concluido", match_id=match_id)
                print(f"  {upload_id}: concluido ({match_id})")
                total += 1
                concluido = True
        except (DemoNaoConfereError, storage_r2.ArquivoGrandeDemaisError, descompressao.GzipInvalidoError) as e:
            # Falha DEFINITIVA (validação, tamanho ou gzip inválido): nenhum
            # retry muda o resultado, então o staging sai na hora.
            conn.rollback()
            dbmod.atualizar_upload_pendente(conn, upload_id, "falhou", erro=str(e)[:500])
            _apagar_staging_upload(client, config, upload_id, arquivo_r2_key)
            print(f"  {upload_id}: RECUSADO ({type(e).__name__})")
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            if storage_r2.objeto_ausente(e):
                # O PUT do Jogador ainda pode estar subindo (URL assinada vale 15 min):
                # espera sem gastar tentativa. Depois da janela, não vem mais.
                if _staging_recente(adicionado_em):
                    dbmod.atualizar_upload_pendente(conn, upload_id, "pendente")
                    print(f"  {upload_id}: arquivo ainda não chegou ao R2 — espera a próxima run")
                else:
                    dbmod.atualizar_upload_pendente(conn, upload_id, "falhou", erro="o arquivo não chegou ao R2")
                    print(f"  {upload_id}: FALHOU (arquivo não chegou ao R2)")
                continue
            # Transitório (R2, DB, rede, parser): volta pra fila. Na última tentativa
            # vira 'falhou' e o staging sai junto (sem Demo órfã no R2, prazo LGPD).
            capturar_erro(e, "processar-uploads-pendentes")
            status = dbmod.falhar_upload_pendente(
                conn, upload_id, e, max_tentativas=_MAX_TENTATIVAS_UPLOAD,
            )
            print(f"  {upload_id}: FALHOU ({type(e).__name__}) — {status}")
            if status == "falhou":
                _apagar_staging_upload(client, config, upload_id, arquivo_r2_key)

        # Staging sai em sucesso, fora do try: falha no delete não muda status nem
        # match_id (o órfão fica pro cmd_limpar_uploads_orfaos).
        if concluido:
            _apagar_staging_upload(client, config, upload_id, arquivo_r2_key)

    print(f"processar-uploads-pendentes: {total} partida(s) processada(s)")
    return total


def _apagar_staging_upload(client, config, upload_id, arquivo_r2_key):
    """Apaga o .dem de staging de um upload que virou 'falhou'. Falha aqui (R2 fora)
    não muda o status nem derruba a fila: só vai pro Sentry, e o órfão fica pro
    cmd_limpar_uploads_orfaos."""
    try:
        storage_r2.delete_object(client, config.r2_bucket, arquivo_r2_key)
    except Exception as e_del:  # noqa: BLE001
        capturar_erro(e_del, "processar-uploads-pendentes")
        print(f"  {upload_id}: aviso — staging não foi apagado do R2 ({type(e_del).__name__})")


def cmd_limpar_uploads_orfaos(config, conn, dias=30):
    """Auditoria finding #17: apaga do R2 o `.dem` órfão de uploads manuais que
    falharam definitivamente há mais de `dias` dias — sem isso, todo upload com erro
    fica pra sempre ocupando espaço no bucket, ao contrário da fila de Partidas Pro
    (que tem retry reaproveitando o staging, e cleanup/reprocess pro caminho de
    sucesso). NÃO roda automaticamente ainda (sem cron/schedule): é um subcomando
    manual (`python -m coletor.main limpar-uploads-orfaos [--days N]`), pra rodar sob
    demanda — ver README (seção Manutenção) sobre quando/como usar."""
    candidatos = dbmod.listar_uploads_falhos_antigos(conn, dias=dias)
    if not candidatos:
        print(f"limpar-uploads-orfaos: nenhum upload falho há mais de {dias} dias")
        return 0

    client = storage_r2.make_client(config)
    total = 0
    for upload_id, arquivo_r2_key in candidatos:
        try:
            storage_r2.delete_object(client, config.r2_bucket, arquivo_r2_key)
            dbmod.marcar_upload_limpo(conn, upload_id)
            total += 1
            print(f"  {upload_id}: objeto órfão apagado ({arquivo_r2_key})")
        except Exception as e:  # noqa: BLE001
            capturar_erro(e, "limpar-uploads-orfaos")
            print(f"  {upload_id}: falha ao apagar ({type(e).__name__})")
    print(f"limpar-uploads-orfaos: {total} objeto(s) apagado(s)")
    return total


DEMOSLAP_API = "https://api.demo-slap.net/public-api"
# Trecho de montagem tem ~5 s (poucos MB). O teto só barra resposta absurda.
_MAX_TRECHO_BYTES = 200 * 1024 * 1024


def _demoslap_trechos(api_key, job_id):
    """{video jobId: URL assinada do .mp4} dos trechos gravados numa análise da DEMO-SLAP."""
    req = urllib.request.Request(
        f"{DEMOSLAP_API}/render/{urllib.parse.quote(job_id, safe='')}/data",
        headers={"x-api-key": api_key},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        dados = json.loads(resp.read())
    return {vid: (info or {}).get("clipUrl") for vid, info in (dados.get("highlightClips") or {}).items()}


def _baixar_trecho(url, destino):
    # Só https: urllib também abriria file:// e ftp://.
    if urllib.parse.urlsplit(url).scheme != "https":
        raise RuntimeError("URL de trecho com esquema não permitido")
    with urllib.request.urlopen(url, timeout=120) as resp, open(destino, "wb") as out:
        recebido = 0
        while chunk := resp.read(1 << 20):
            recebido += len(chunk)
            if recebido > _MAX_TRECHO_BYTES:
                raise RuntimeError(f"trecho excedeu o teto de {_MAX_TRECHO_BYTES} bytes")
            out.write(chunk)


def _ffmpeg_concat(trechos, saida):
    import subprocess

    lista = saida.with_suffix(".txt")
    lista.write_text("".join(f"file '{p.as_posix()}'\n" for p in trechos), encoding="utf-8")
    base = ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lista)]
    fim = ["-movflags", "+faststart", str(saida)]
    # Os trechos saem do mesmo render (mesmo codec e resolução): copiar o stream basta.
    # Se o ffmpeg recusar, recodifica.
    try:
        subprocess.run(base + ["-c", "copy"] + fim, check=True, capture_output=True, timeout=300)
    except subprocess.CalledProcessError:
        subprocess.run(
            base + ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac"] + fim,
            check=True, capture_output=True, timeout=600,
        )


def cmd_juntar_clipes(config, conn):
    """Junta os trechos de cada montagem da aba Clipes num vídeo único no R2.

    O render-fragmovie da DEMO-SLAP recusa trechos do render-custom, então a junção é
    nossa: baixa os trechos (URL assinada da DEMO-SLAP), junta com ffmpeg e grava em
    `clipes/<id>.mp4`. Sem DEMOSLAP_API_KEY é no-op. Erro numa montagem não derruba as
    outras; ela é tentada de novo na próxima run (por até 1 dia, ver db).
    """
    if not config.demoslap_api_key:
        print("juntar-clipes: DEMOSLAP_API_KEY vazio, nada a fazer")
        return 0
    montagens = dbmod.listar_montagens_sem_video(conn)
    if not montagens:
        print("juntar-clipes: nenhuma montagem esperando o vídeo único")
        return 0

    import tempfile
    from pathlib import Path

    client = storage_r2.make_client(config)
    total = 0
    for clipe_id, job_id, video_job_ids in montagens:
        try:
            urls = _demoslap_trechos(config.demoslap_api_key, job_id)
            with tempfile.TemporaryDirectory() as tmp:
                pasta = Path(tmp)
                trechos = []
                for i, vid in enumerate(video_job_ids):
                    if not urls.get(vid):
                        raise RuntimeError(f"trecho {vid} sem vídeo na DEMO-SLAP")
                    trechos.append(pasta / f"trecho_{i}.mp4")
                    _baixar_trecho(urls[vid], trechos[-1])
                saida = pasta / "montagem.mp4"
                _ffmpeg_concat(trechos, saida)
                key = storage_r2.clipe_key(clipe_id)
                storage_r2.upload_bytes(client, config.r2_bucket, key, saida.read_bytes(), content_type="video/mp4")
            dbmod.gravar_video_montagem(conn, clipe_id, key)
            total += 1
            print(f"  {clipe_id}: {len(trechos)} trechos juntados ({key})")
        except Exception as e:  # noqa: BLE001
            capturar_erro(e, "juntar-clipes")
            print(f"  {clipe_id}: falha ao juntar ({type(e).__name__})")
    print(f"juntar-clipes: {total} montagem(ns) com vídeo único")
    return total


TIPO_POR_CHAVE = {"smokes": "smoke", "fires": "molotov", "flashes": "flash", "hes": "he"}


def _montar_lineups(rdata, replay_json, mapa, source):
    """Monta a lista de lineups de granada (Task 4/db._write_lineups) a partir do rdata
    cru de extract_replay — usada tanto por ingest_demo quanto por cmd_reprocess, já que
    _write_lineups sempre apaga os lineups existentes antes de inserir (reprocess sem
    recriar a lista perderia tudo silenciosamente).

    Só entra item com posição de arremesso conhecida (throwerX/Y — pode faltar quando não
    há weapon_fire correlacionado, ver parse.py); checa a posição, não o thrower (que o
    parser sempre preenche, mesmo sem posição). Normaliza thrower_x/y e target_x/y pra
    0..1 (mesmo world_to_radar do Replay 2D) — sem calibração do mapa, mantém cru, mesma
    postura defensiva que replay.build_replay já tem.
    """
    cal = replaymod.MAP_CALIBRATION.get(mapa)

    def norm(x, y):
        return replaymod.world_to_radar(x, y, cal) if cal else (x, y)

    lineups = []
    frames = lineupsmod.frames_por_granada(rdata, replay_json)
    for chave, tipo in TIPO_POR_CHAVE.items():
        for i, g in enumerate(rdata.get(chave, [])):
            if g.get("throwerX") is None or g.get("throwerY") is None:
                continue
            tx, ty = norm(g["throwerX"], g["throwerY"])
            ax, ay = norm(g["x"], g["y"])
            lineups.append({
                "round_number": g["round"], "map": mapa, "tipo": tipo,
                "thrower_steam_id": g["thrower"],
                "thrower_nick": replay_json["names"].get(g["thrower"], "") if replay_json else "",
                "thrower_x": tx, "thrower_y": ty,
                "thrower_yaw": g.get("throwerYaw", 0), "thrower_pitch": g.get("throwerPitch", 0),
                "target_x": ax, "target_y": ay,
                "tick": g.get("tickStart", g.get("tick")),
                "origem": "pro" if source == "pro" else "grupo",
                "lado": g.get("throwerLado"),
                # 0055: mundo (setpos de treino) + frame do Replay 2D — nullable.
                **lineupsmod.campos_mundo(g),
                "replay_frame": frames.get((chave, i)),
            })
    return lineups


def cmd_reprocess(config, conn, match_id=None, since=None):
    """Reprocessa Partida(s) já gravadas cujo .dem ainda está no R2 (janela de
    RETENCAO_DEMO_DIAS do cleanup) — baixa de novo, roda o parser ATUAL e regrava
    stats + replay.json no MESMO match_id (store_parsed é idempotente por fingerprint,
    e aqui nem precisa disso: já sabemos o id). Não usa ingest_demo: aquele resolve a
    key do R2 por share_code/hash de path, que pra upload manual sem share_code muda a
    cada chamada — aqui reaproveita a key já gravada em demo_url/replay_url, garantindo
    que sobrescreve o objeto certo em vez de deixar um novo órfão.

    `match_id` (opcional, uuid): reprocessa só essa Partida; sem isso, todas que ainda
    têm demo_url (pending/failed não têm o que reprocessar).
    `since` (opcional, "YYYY-MM-DD"): só Partidas jogadas nessa data em diante — reprocess
    completo pode levar horas (cada Partida baixa+reparseia o .dem inteiro); útil pra
    aplicar um fix novo só nas Partidas recentes sem esperar o histórico inteiro.

    Sem `match_id`/`since`, a query ordena por `reprocessed_at nulls first, id`: nunca
    reprocessadas primeiro, depois as mais antigas. Cada Partida processada com sucesso
    é marcada (`reprocessed_at = now()`) — se o job estourar o timeout do workflow antes
    de cobrir tudo (visto na prática: 300min só deu pra ~93 de 266), a PRÓXIMA rodada
    continua exatamente de onde parou em vez de repetir as mesmas do início.
    """
    import tempfile
    from pathlib import Path

    with conn.cursor() as cur:
        if match_id:
            cur.execute(
                "select id, share_code, source, demo_url, replay_url, played_at from matches "
                "where id = %s and demo_url is not null",
                (match_id,),
            )
        elif since:
            cur.execute(
                "select id, share_code, source, demo_url, replay_url, played_at from matches "
                "where status = 'parsed' and demo_url is not null and played_at >= %s "
                "order by reprocessed_at nulls first, id",
                (since,),
            )
        else:
            cur.execute(
                "select id, share_code, source, demo_url, replay_url, played_at from matches "
                "where status = 'parsed' and demo_url is not null "
                "order by reprocessed_at nulls first, id"
            )
        rows = cur.fetchall()
    if not rows:
        print("reprocess: nenhuma Partida com demo ainda arquivado")
        return 0

    client = storage_r2.make_client(config)
    total = 0
    for mid, share_code, source, demo_url, replay_url, played_at in rows:
        demo_key = storage_r2.key_from_url(demo_url, config.r2_bucket)
        if not demo_key:
            print(f"  {mid}: demo_url fora do bucket configurado — pulando")
            continue
        try:
            with tempfile.TemporaryDirectory() as tmp:
                dem = Path(tmp) / "match.dem"
                dados = storage_r2.download_bytes(client, config.r2_bucket, demo_key)
                dem.write_bytes(_descomprimir_dem_arquivado(dados))

                parsed = parsemod.parse_demo(dem)
                parsed["players"] = transform.fill_kd_from_kills(parsed["players"], parsed["kills"])
                parsed = transform.enrich(parsed)
                parsed["played_at"] = played_at.isoformat() if played_at else parsed.get("played_at")

                rdata = parsemod.extract_replay(dem)
                winner_by_round = {r["round_number"]: r.get("winner_team") for r in parsed.get("rounds", [])}
                replay_json = replaymod.build_replay(
                    parsed["map"], rdata["ticks"], kills=rdata["kills"], extras=rdata,
                    winner_by_round=winner_by_round,
                )
                parsed["highlights"] = transform.attach_replay_frames(parsed["highlights"], replay_json["rounds"])
                parsed["lineups"] = _montar_lineups(rdata, replay_json, parsed["map"], source or "valve_mm")

                # Sobrescreve o MESMO objeto (key extraída do replay_url já gravado) —
                # não recalcula um novo, senão o antigo fica órfão e o link salvo quebra.
                replay_key = storage_r2.key_from_url(replay_url, config.r2_bucket) if replay_url else None
                if replay_key:
                    _upload_replay(client, config.r2_bucket, replay_key, replay_json)

                dbmod.store_parsed(
                    conn, parsed, share_code=share_code, source=source or "valve_mm",
                    demo_url=demo_url, replay_url=replay_url, prefer_new_played_at=False,
                    tem_demo=True,
                    # O id já é conhecido: sem isso, Partida sem Share Code cujo K/D
                    # mudou com o parser novo perdia a dedupe e virava linha nova.
                    match_id_alvo=mid,
                )
                with conn.cursor() as cur2:
                    cur2.execute("update matches set reprocessed_at = now() where id = %s", (mid,))
                conn.commit()
                print(f"  {mid}: reprocessada")
                total += 1
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            capturar_erro(e, "reprocess")
            print(f"  {mid}: FALHOU ({type(e).__name__})")
    print(f"reprocess: {total} Partida(s) reprocessada(s)")
    return total


def _descomprimir_dem_arquivado(dados):
    """Descomprime bytes de .dem lidos do R2 (chave demos/{id}.dem.bz2). Compatível com
    arquivos arquivados ANTES do fix de compressão do upload — esses estão gravados como
    .dem cru apesar da chave dizer .bz2 (bug: a extensão sempre mentiu, nenhum caminho do
    código realmente comprimia). Se não for um stream bz2 válido, assume que já é o .dem
    descomprimido e devolve como está."""
    try:
        return bz2.decompress(dados)
    except OSError:
        return dados


def _upload_json_gzip(client, bucket, key, payload):
    """Grava JSON na mesma chave, com corpo gzip e ContentEncoding=gzip.

    Content-Type continua application/json. O back repassa o Content-Encoding e o
    fetch().json() do navegador descomprime. Objeto antigo sem o header segue cru.
    """
    cru = json.dumps(payload).encode("utf-8")
    storage_r2.upload_bytes(
        client, bucket, key, storage_r2.gzip_bytes(cru),
        content_type="application/json", content_encoding="gzip",
    )


def _upload_replay(client, bucket, rkey, replay_json):
    """Sobe o replay quebrado em índice (pequeno, sem frames) + um objeto por round —
    streaming por round no client (FIL-54b): a Partida toca o round 1 sem esperar o
    replay inteiro baixar; os demais rounds são buscados sob demanda. `rkey` é a
    chave do índice (a mesma que `replay_url` sempre apontou — nenhuma mudança de
    schema); os rounds vão pro mesmo prefixo, trocando ".json" por "/round-{n}.json".

    Índice e rounds saem gzip (mesma chave). O backfill `comprimir-replays` trata
    os objetos gravados antes disso."""
    index, rounds = replaymod.split_for_storage(replay_json)
    _upload_json_gzip(client, bucket, rkey, index)
    base = rkey[: -len(".json")] if rkey.endswith(".json") else rkey
    for round_number, round_data in rounds.items():
        _upload_json_gzip(client, bucket, f"{base}/round-{round_number}.json", round_data)


def _id_do_conteudo(dem_paths):
    """uuid do sha256 dos bytes das Demos (as partes na ordem). Estável no retry do mesmo
    arquivo; Partidas distintas com o mesmo fingerprint têm Demos diferentes."""
    total = hashlib.sha256()
    for caminho in dem_paths:
        with open(caminho, "rb") as fh:
            total.update(hashlib.file_digest(fh, "sha256").digest())
    return str(uuid.UUID(total.hexdigest()[:32]))


def _finalizar_ingest(config, conn, parsed, replay_json, dem_path_upload, share_code,
                      source, upload, played_at, match_id_alvo=None, dem_paths=None):
    """Cauda comum de ingest_demo/ingest_demo_multiparte: arquiva demo+replay no R2 (se
    configurado) e grava no banco. Devolve match_id. `dem_path_upload` é o .dem cujos
    bytes brutos sobem pro R2 (partida de arquivo único: o próprio; partida fundida de
    várias partes: ver escolha em ingest_demo_multiparte)."""
    demo_url = replay_url = None
    if upload and config.r2_endpoint:
        client = storage_r2.make_client(config)
        # Sem Share Code, a chave é a Partida alvo ou o hash do conteúdo das Demos: o
        # retry de uma série pro regrava os mesmos objetos em vez de deixar órfãos. O
        # fingerprint não serve (Partidas curtas distintas colidem) nem o hash de 32 bits
        # do caminho (colidia e regravava a Demo e o Replay 2D de outra Partida).
        if share_code:
            ids = sharecode.decode(share_code)
        elif match_id_alvo is not None:
            ids = {"match_id": str(match_id_alvo)}
        else:
            ids = {"match_id": _id_do_conteudo(dem_paths or [dem_path_upload])}

        key = storage_r2.demo_key(ids["match_id"])
        with open(dem_path_upload, "rb") as fh:
            # A chave sempre foi demos/{id}.dem.bz2 — comprime de verdade agora, antes o
            # arquivo subia cru (dívida técnica: extensão mentia, custo de storage 3-5x
            # maior que o necessário). Ler de volta: ver _descomprimir_dem_arquivado.
            storage_r2.upload_bytes(client, config.r2_bucket, key, bz2.compress(fh.read()))
        demo_url = f"{config.r2_endpoint}/{config.r2_bucket}/{key}"

        if replay_json is not None:
            rkey = storage_r2.replay_key(ids["match_id"])
            _upload_replay(client, config.r2_bucket, rkey, replay_json)
            replay_url = f"{config.r2_endpoint}/{config.r2_bucket}/{rkey}"

    return dbmod.store_parsed(
        conn, parsed, share_code=share_code, source=source,
        demo_url=demo_url, replay_url=replay_url,
        prefer_new_played_at=bool(played_at),
        tem_demo=True,
        match_id_alvo=match_id_alvo,
    )


def _atualizar_avatares(config, conn, steam_ids):
    """Busca e grava o avatar Steam de `steam_ids` que ainda não têm cache fresco
    (steam_avatares). Best-effort: TODOS os jogadores da demo (não só os do grupo)
    ganham avatar no scoreboard, mas uma falha da Steam Web API não pode derrubar
    o ingest — o resto da Partida já está gravado."""
    if not config.steam_api_key:
        return
    try:
        faltando = dbmod.listar_steam_ids_sem_avatar_fresco(conn, steam_ids)
        if not faltando:
            return
        mapa = steam_api.buscar_avatares(config.steam_api_key, faltando)
        dbmod.upsert_avatares(conn, mapa)
    except Exception as e:  # noqa: BLE001
        print(f"aviso: avatares Steam não atualizados ({type(e).__name__})")


MSG_SEM_PARTICIPACAO = "Você nem seus amigos aparecem nesta Demo."
MSG_PARTIDA_JA_REGISTRADA = "Essa Partida já está registrada."
MSG_DEMO_DE_OUTRA_PARTIDA = "Essa Demo não é da Partida desse Share Code."


def _validar_envio(conn, parsed, enviado_por, share_code):
    """Upload do Jogador sem alvo (R114). Roda antes de qualquer gravação no R2 ou no
    banco: sem isso, um Share Code alheio regravava demos/<id>, replays/<id> e o
    mapa/placar/roster da Partida dele (on conflict (share_code) do update)."""
    participantes = {p["steam_id64"] for p in parsed.get("players", [])}
    if enviado_por not in participantes and not (participantes & dbmod.amigos_aceitos(conn, enviado_por)):
        raise DemoNaoConfereError(MSG_SEM_PARTICIPACAO)
    partida = dbmod.partida_por_share_code(conn, share_code) if share_code else None
    if partida is None:
        return
    status, descoberta_por = partida
    if status == "parsed":
        raise DemoNaoConfereError(MSG_PARTIDA_JA_REGISTRADA)
    # Quem descobriu o Share Code joga a Partida real: sem ele na Demo, é outra Partida
    # tentando ocupar a linha pendente de alguém. Linha antiga sem discovered_by passa.
    if descoberta_por and descoberta_por not in participantes:
        raise DemoNaoConfereError(MSG_DEMO_DE_OUTRA_PARTIDA)


def ingest_demo(config, conn, path, share_code=None, source="upload", upload=True,
                played_at=None, plataforma_manual=None, alvo=None, enviado_por=None):
    """Parseia um .dem, arquiva no R2 (se configurado) e grava no banco. Devolve match_id.

    `played_at` (ISO 8601, opcional): quando o operador sabe a hora real da Partida,
    essa informação é mais confiável que a mtime do arquivo (que só reflete quando o
    .dem foi baixado/copiado — pode ser dias depois) e vence mesmo sobre um played_at
    já gravado por descoberta automática (prefer_new_played_at=True em store_parsed).

    `plataforma_manual` (opcional, 'faceit'|'gamers_club'|'xplay_gg'): rótulo informativo
    de qual plataforma sem integração oficial o jogador escolheu no upload manual (ver
    site/server/src/routes/upload.js) — não vem da demo, só metadado do fluxo de envio.

    `alvo` (opcional): {"match_id", "map", "steam_ids"} da Partida que este envio
    diz enriquecer. Quando informado, a Demo é validada contra ela ANTES de
    qualquer trabalho caro (Replay 2D) e os dados são gravados NAQUELA linha, sem
    passar pela dedupe por fingerprint.
    """
    parsed = parsemod.parse_demo(path)
    parsed["players"] = transform.fill_kd_from_kills(parsed["players"], parsed["kills"])
    parsed = transform.enrich(parsed)
    if alvo is not None:
        _validar_demo_contra_alvo(parsed, alvo)
    elif enviado_por is not None:
        _validar_envio(conn, parsed, enviado_por, share_code)
    if played_at:
        parsed["played_at"] = played_at
    parsed["plataforma_manual"] = plataforma_manual

    # Replay 2D + clutch (sempre computados; só ARQUIVADOS no R2 se configurado).
    # Falha aqui não derruba o ingest dos stats.
    replay_json = None
    try:
        rdata = parsemod.extract_replay(path)
        winner_by_round = {r["round_number"]: r.get("winner_team") for r in parsed.get("rounds", [])}
        replay_json = replaymod.build_replay(
            parsed["map"], rdata["ticks"], kills=rdata["kills"], extras=rdata,
            winner_by_round=winner_by_round,
        )
        # Frame do Replay 2D pra cada highlight (deep link — Partida.jsx abre o replay
        # já no momento exato ao clicar), casando pela última kill do jogador no round.
        # Os highlights de clutch já vêm de transform.enrich() (fonte única de verdade,
        # a mesma que conta clutch_wins/clutch_attempts) — não usa mais o detect_clutch
        # de replay.py aqui, que tinha critério mais permissivo (elimina todo mundo =
        # "clutch", mesmo perdendo o round por outro motivo — bomba explode depois).
        parsed["highlights"] = transform.attach_replay_frames(parsed["highlights"], replay_json["rounds"])
        parsed["lineups"] = _montar_lineups(rdata, replay_json, parsed["map"], source)
    except Exception as e:  # noqa: BLE001
        print(f"aviso: replay 2D / clutch não gerado ({type(e).__name__})")

    try:
        match_id = _finalizar_ingest(
            config, conn, parsed, replay_json, path, share_code, source, upload, played_at,
            match_id_alvo=alvo["match_id"] if alvo else None,
        )
    except Exception as e:  # noqa: BLE001
        # Cenário recorrente (ver spec): a mesma demo já tinha sido enviada antes
        # pela página genérica "Enviar Demo" e criou uma Partida duplicata
        # carregando esse fingerprint (matches.fingerprint é único). Ao enriquecer
        # a linha da Partida alvo com essa mesma demo, o UPDATE colide nesse
        # índice — sem tratar, o Jogador via a mensagem crua do psycopg no banner
        # (o except genérico não sabia que era definitivo, então mantinha o .dem
        # de 300MB no R2 pra sempre esperando um retry que nunca ia resolver).
        # Detecta pelo SQLSTATE (23505 = unique_violation), não pela classe
        # psycopg.errors.UniqueViolation — importar psycopg no topo do módulo
        # quebra o job de testes do CI, que instala só dev-requirements.txt
        # (sem psycopg; ver db.py e storage_r2.py pro mesmo padrão de import
        # preguiçoso). Só converte pra falha DEFINITIVA quando há alvo: fora
        # desse caminho (cmd_fetch/processar-fila-pro/envio genérico), uma
        # colisão de fingerprint só acontece numa corrida entre execuções
        # concorrentes — é TRANSITÓRIA, e converter aqui apagaria do R2 o
        # .dem de 300MB que devia sobreviver pro retry.
        if alvo is not None and getattr(e, "sqlstate", None) == "23505":
            raise DemoNaoConfereError("esta demo já foi processada em outra partida") from e
        raise
    _atualizar_avatares(config, conn, [p["steam_id64"] for p in parsed.get("players", [])])
    if source != "pro":
        try:
            discord.notificar_partida(conn, match_id)
        except Exception as e:  # noqa: BLE001 — Discord nunca derruba o ingest
            print(f"aviso: Discord não notificado ({type(e).__name__})")
    return match_id


def ingest_demo_multiparte(config, conn, dem_paths, share_code=None, source="pro", upload=True, played_at=None):
    """Ingere um GRUPO de 2+ .dem que são o MESMO mapa dividido em pedaços por um
    reinício técnico no meio da partida (queda de servidor etc.) — o HLTV distribui
    esse único mapa como vários .dem separados dentro do mesmo .rar da série (ex.:
    "...-m1-anubis-p1.dem" + "...-p2.dem"). Sem essa função, cada parte viraria uma
    Partida INDEPENDENTE (2 entradas "de_anubis", cada uma com metade do placar) — o
    que é enganoso: é 1 mapa só, incompleto nos dois. Aqui as partes são fundidas numa
    ÚNICA Partida coerente (rounds contínuos, placar completo, stats somadas) antes de
    rodar o resto do pipeline (fill_kd_from_kills/enrich/build_replay/lineups) UMA VEZ
    só — evita ter que somar/recalcular campos derivados (rating, clutch etc.) que não
    são simplesmente somáveis entre partes, reusando 100% do código de transform.py/
    replay.py em cima dos dados crus já fundidos (ver parse.fundir_partes_mesmo_mapa).
    Devolve UM match_id só.
    """
    partes = [parsemod.parse_demo(p) for p in dem_paths]

    rdatas = []
    try:
        rdatas = [parsemod.extract_replay(p) for p in dem_paths]
    except Exception as e:  # noqa: BLE001
        print(f"aviso: replay 2D não gerado pro grupo ({type(e).__name__})")
        rdatas = []

    parsed, rdata = parsemod.fundir_partes_mesmo_mapa(partes, rdatas or None)

    parsed["players"] = transform.fill_kd_from_kills(parsed["players"], parsed["kills"])
    parsed = transform.enrich(parsed)
    if played_at:
        parsed["played_at"] = played_at

    replay_json = None
    if rdata is not None:
        try:
            winner_by_round = {r["round_number"]: r.get("winner_team") for r in parsed.get("rounds", [])}
            replay_json = replaymod.build_replay(
                parsed["map"], rdata["ticks"], kills=rdata["kills"], extras=rdata,
                winner_by_round=winner_by_round,
            )
            parsed["highlights"] = transform.attach_replay_frames(parsed["highlights"], replay_json["rounds"])
            parsed["lineups"] = _montar_lineups(rdata, replay_json, parsed["map"], source)
        except Exception as e:  # noqa: BLE001
            print(f"aviso: replay 2D / clutch não gerado ({type(e).__name__})")

    # .dem BRUTO arquivado pro reprocessamento (cmd_reprocess baixa de volta um único
    # .dem pra reparsear com parse_demo, que não sabe fundir partes): sobe a ÚLTIMA
    # parte, a escolha mais simples — um reprocessamento futuro dessa Partida ficaria
    # incompleto (só a última parte), mesma limitação que já existiria pra qualquer
    # .dem cortado; documentado aqui de propósito pra não surpreender no futuro.
    return _finalizar_ingest(
        config, conn, parsed, replay_json, dem_paths[-1], share_code, source, upload, played_at,
        dem_paths=dem_paths,
    )


def cmd_avatares(config, conn):
    """Backfill: busca o avatar de TODOS os steam_id64 já vistos em alguma Partida
    (match_players) e que ainda não têm cache fresco em steam_avatares — cobre os
    5+ jogadores por Partida que não são do grupo e nunca tiveram avatar."""
    config.require("steam_api_key")
    faltando = dbmod.listar_steam_ids_de_match_players_sem_avatar_fresco(conn)
    if not faltando:
        print("avatares: nenhum steam_id sem avatar fresco")
        return 0
    print(f"avatares: buscando {len(faltando)} avatar(es)…")
    mapa = steam_api.buscar_avatares(config.steam_api_key, faltando)
    dbmod.upsert_avatares(conn, mapa)
    print(f"avatares: {len(mapa)} avatar(es) gravado(s)")
    return len(mapa)


def cmd_sincronizar_faceit(config, conn, limite=10):
    """FACEIT: descoberta (com `from`), fila (Demo ou só estatísticas), re-tentativa
    espaçada da Demo e ELO. A lógica mora em faceit_sync.py."""
    return faceit_sync.sincronizar(
        config, conn, ingest_demo=ingest_demo, ref=_ref, limite=limite,
        erros_definitivos=(DemoNaoConfereError, rede.HostNaoPermitidoError),
    )


def _imprimir_relatorio(texto, relatorio):
    print(texto)
    print(json.dumps(relatorio, ensure_ascii=False, indent=2))


def cmd_inventario_r2(config):
    """Só leitura: contagem e bytes por prefixo de topo + multipart incompletos."""
    config.require("r2_account_id", "r2_access_key_id", "r2_secret_access_key")
    client = storage_r2.make_client(config)
    relatorio = storage_r2.inventariar(client, config.r2_bucket)
    _imprimir_relatorio(storage_r2.formatar_inventario(relatorio), relatorio)
    return relatorio


def cmd_comprimir_replays(config, dry_run=True, limit=None):
    """Backfill gzip dos replays. dry_run é o padrão — não grava sem --no-dry-run."""
    config.require("r2_account_id", "r2_access_key_id", "r2_secret_access_key")
    client = storage_r2.make_client(config)
    relatorio = storage_r2.comprimir_replays(client, config.r2_bucket, dry_run=dry_run, limit=limit)
    _imprimir_relatorio(storage_r2.formatar_comprimir(relatorio), relatorio)
    return relatorio


def main(argv=None):
    init_sentry()
    argv = argv if argv is not None else sys.argv[1:]
    ap = argparse.ArgumentParser(prog="coletor")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("discover")
    p_ing = sub.add_parser("ingest")
    p_ing.add_argument("demo", help="caminho para o .dem ou .dem.bz2")
    p_ing.add_argument("--share-code", default=None)
    p_ing.add_argument("--source", default="upload")
    p_ing.add_argument("--no-upload", action="store_true")
    p_ing.add_argument(
        "--played-at", default=None,
        help="Hora real da Partida em ISO 8601 (ex.: 2026-07-09T20:15:00-03:00). "
             "Use quando souber a data certa — mais confiável que a mtime do arquivo.",
    )
    p_fetch = sub.add_parser("fetch", help="Baixa/ingere as Partidas pendentes (bot GC → .dem → stats).")
    p_fetch.add_argument(
        "--since", default=None,
        help="Só ingere Partidas a partir desta data (YYYY-MM-DD, UTC); anteriores viram skipped.",
    )
    p_fetch.add_argument("--bot-dir", default=None, help="Caminho da pasta bot/ (default: ../bot ao lado de coletor/).")
    p_fetch.add_argument("--node", default="node", help="Executável do Node (default: node no PATH).")
    p_cleanup = sub.add_parser("cleanup", help="Apaga do R2 o .dem bruto de Partidas processadas há mais de N dias (mantém o replay.json).")
    p_cleanup.add_argument(
        "--days", type=int, default=RETENCAO_DEMO_DIAS,
        help=f"Idade mínima em dias (default: {RETENCAO_DEMO_DIAS}).",
    )
    p_reproc = sub.add_parser(
        "reprocess",
        help="Re-roda o parser atual em cima do .dem já arquivado no R2 (bug corrigido depois do ingest original) e regrava stats/replay.json.",
    )
    p_reproc.add_argument("--match-id", default=None, help="Reprocessa só essa Partida (uuid); sem isso, todas com demo ainda no R2.")
    p_reproc.add_argument("--since", default=None, help="Só Partidas jogadas nessa data em diante (YYYY-MM-DD) — evita reprocessar o histórico inteiro.")
    sub.add_parser(
        "processar-fila-pro",
        help="Processa a fila de partidas profissionais: baixa .rar do HLTV, extrai o .dem e ingere (source='pro').",
    )
    sub.add_parser(
        "processar-uploads-pendentes",
        help="Processa a fila de uploads manuais de demo (qualquer membro do grupo, via 'Enviar Demo').",
    )
    p_limpar = sub.add_parser(
        "limpar-uploads-orfaos",
        help="Apaga do R2 o .dem de uploads que falharam definitivamente há mais de N dias (default 30). Comando manual — não roda automaticamente ainda.",
    )
    p_limpar.add_argument("--days", type=int, default=30, help="Idade mínima em dias do status 'falhou' (default: 30).")
    sub.add_parser(
        "juntar-clipes",
        help="Junta os trechos das montagens da aba Clipes (DEMO-SLAP) num vídeo único no R2, com ffmpeg.",
    )
    sub.add_parser(
        "configurar-cors",
        help="Configura CORS no bucket R2 (uma vez) pra aceitar upload direto do navegador.",
    )
    sub.add_parser(
        "avatares",
        help="Backfill: busca o avatar Steam de todos os jogadores já vistos em alguma Partida (inclusive fora do grupo).",
    )
    sub.add_parser(
        "sincronizar-faceit",
        help="FACEIT Fase B: descobre e ingere partidas 5v5 de membros vinculados + ELO.",
    )
    sub.add_parser(
        "inventario-r2",
        help="Só leitura: conta objetos e bytes por prefixo de topo no bucket R2, mais multipart incompletos.",
    )
    p_gzip = sub.add_parser(
        "comprimir-replays",
        help="Backfill: regrava replays/ na mesma chave com gzip. Não apaga. Dry-run é o padrão.",
    )
    gzip_modo = p_gzip.add_mutually_exclusive_group()
    gzip_modo.add_argument(
        "--dry-run", dest="dry_run", action="store_true",
        help="Simula: mede bytes antes/depois sem gravar (padrão).",
    )
    gzip_modo.add_argument(
        "--no-dry-run", dest="dry_run", action="store_false",
        help="Grava de verdade. Só substitui a chave depois do upload concluir.",
    )
    p_gzip.set_defaults(dry_run=True)
    p_gzip.add_argument(
        "--limit", type=int, default=None,
        help="Máximo de objetos a comprimir nesta run (os já gzip não contam). Sem limite se omitido.",
    )

    args = ap.parse_args(argv)
    # Inventário e backfill só falam com o R2 — não abrem o banco.
    if args.cmd in ("inventario-r2", "comprimir-replays"):
        config = Config()
        if args.cmd == "inventario-r2":
            cmd_inventario_r2(config)
            return
        if args.limit is not None and args.limit < 0:
            ap.error("--limit deve ser >= 0")
        relatorio = cmd_comprimir_replays(config, dry_run=args.dry_run, limit=args.limit)
        if relatorio["falhas"]:
            sys.exit(1)
        return

    config = Config()
    config.require("database_url")
    conn = dbmod.connect(config.database_url)
    try:
        if args.cmd == "discover":
            em_monitor_discover(lambda: cmd_discover(config, conn))
        elif args.cmd == "ingest":
            from pathlib import Path

            mid = ingest_demo(
                config, conn, Path(args.demo),
                share_code=args.share_code, source=args.source, upload=not args.no_upload,
                played_at=args.played_at,
            )
            print(f"ingest: Partida gravada {mid}")
        elif args.cmd == "fetch":
            from pathlib import Path

            bot_dir = Path(args.bot_dir) if args.bot_dir else None
            cmd_fetch(config, conn, since=args.since, bot_dir=bot_dir, node_bin=args.node)
        elif args.cmd == "cleanup":
            cmd_cleanup(config, conn, days=args.days)
        elif args.cmd == "reprocess":
            cmd_reprocess(config, conn, match_id=args.match_id, since=args.since)
        elif args.cmd == "processar-fila-pro":
            cmd_processar_fila_pro(config, conn)
        elif args.cmd == "processar-uploads-pendentes":
            cmd_processar_uploads_pendentes(config, conn)
        elif args.cmd == "limpar-uploads-orfaos":
            cmd_limpar_uploads_orfaos(config, conn, dias=args.days)
        elif args.cmd == "juntar-clipes":
            cmd_juntar_clipes(config, conn)
        elif args.cmd == "configurar-cors":
            client = storage_r2.make_client(config)
            storage_r2.configurar_cors(
                client,
                config.r2_bucket,
                [
                    "https://resenha-phi.vercel.app",
                    "https://resenhacs.vercel.app",
                    "http://localhost:5173",
                ],
            )
            print(f"configurar-cors: regra aplicada no bucket {config.r2_bucket}")
        elif args.cmd == "avatares":
            cmd_avatares(config, conn)
        elif args.cmd == "sincronizar-faceit":
            cmd_sincronizar_faceit(config, conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
