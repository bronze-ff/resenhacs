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

import json

from . import db as dbmod
from . import parse as parsemod
from . import replay as replaymod
from . import sharecode
from . import steam_api
from . import storage_r2
from . import transform
from .config import Config


def cmd_discover(config, conn):
    config.require("steam_api_key")
    total = 0
    for steam_id64, auth_code, last_code in dbmod.list_tracked_players(conn):
        # Um jogador com auth code inválido/expirado (ou rate limit persistente) não deve
        # abortar a descoberta dos outros.
        try:
            novos = steam_api.walk_chain(config.steam_api_key, steam_id64, auth_code, last_code)
        except Exception as e:  # noqa: BLE001
            print(f"{steam_id64}: erro ao andar a corrente ({e}) — pulando")
            continue
        for code in novos:
            if sharecode.is_valid(code):
                dbmod.record_pending_match(conn, code)
                total += 1
        if novos:
            dbmod.set_last_share_code(conn, steam_id64, novos[-1])
        print(f"{steam_id64}: {len(novos)} share codes novos")
    print(f"discover: {total} Partidas pendentes registradas")
    return total


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


def _baixar_e_descomprimir(url, destino_dem):
    """Baixa um .dem.bz2 da Valve e descomprime em streaming pro caminho .dem indicado."""
    import bz2
    import urllib.request

    dec = bz2.BZ2Decompressor()
    with urllib.request.urlopen(url, timeout=120) as resp, open(destino_dem, "wb") as out:
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            out.write(dec.decompress(chunk))


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

    codes = dbmod.list_pending_share_codes(conn)
    if not codes:
        print("fetch: nenhuma Partida pendente")
        return 0

    bot_dir = bot_dir or (Path(__file__).resolve().parents[3] / "bot")
    print(f"fetch: resolvendo {len(codes)} share code(s) via Game Coordinator…")
    resolvidos = _resolver_demo_urls(codes, bot_dir, node_bin)

    since_ts = None
    if since:
        since_ts = datetime.datetime.fromisoformat(since).replace(tzinfo=datetime.timezone.utc).timestamp()

    total = 0
    for r in resolvidos:
        code, url, mt = r.get("shareCode"), r.get("demoUrl"), r.get("matchTime")
        if not url:
            print(f"  {code}: sem link de demo (GC não devolveu) — deixando pendente")
            continue
        if since_ts is not None and mt is not None and mt < since_ts:
            print(f"  {code}: antes de {since} — marcando como skipped")
            dbmod.mark_skipped(conn, code)
            continue
        played_at = (
            datetime.datetime.fromtimestamp(mt, tz=datetime.timezone.utc).isoformat() if mt else None
        )
        try:
            with tempfile.TemporaryDirectory() as tmp:
                dem = Path(tmp) / "match.dem"
                print(f"  {code}: baixando {url}")
                _baixar_e_descomprimir(url, dem)
                mid = ingest_demo(
                    config, conn, dem, share_code=code, source="valve_mm",
                    upload=True, played_at=played_at,
                )
                print(f"  {code}: ingerida {mid} (played_at={played_at})")
                total += 1
        except Exception as e:  # noqa: BLE001
            # Uma partida com demo problemático não derruba o lote; marca failed pra
            # não ficar re-baixando 200MB toda hora (dá pra re-tentar voltando pra
            # pending na mão depois de corrigir o parser).
            conn.rollback()
            print(f"  {code}: FALHOU ({e}) — marcando como failed")
            with conn.cursor() as cur:
                cur.execute(
                    "update matches set status = 'failed' where share_code = %s and status = 'pending'",
                    (code,),
                )
            conn.commit()

    print(f"fetch: {total} Partida(s) ingerida(s)")
    return total


def cmd_cleanup(config, conn, days=90):
    """Apaga do R2 o .dem BRUTO (não o replay.json, que a UI usa pra sempre) de Partidas
    já processadas há mais de `days` dias. Decisão do usuário: bug de parser corrigido
    depois exige reprocessar a demo original (aconteceu 3x só nesta fase do projeto) —
    por isso a janela de 90 dias, não deleção imediata. replay_url continua intacto;
    só demo_url vira NULL (a rota /:id/demo já devolve 404 nesse caso, mesmo tratamento
    de "sem demo" que já existia)."""
    import datetime

    limite = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    with conn.cursor() as cur:
        cur.execute(
            "select id, demo_url from matches where status = 'parsed' and demo_url is not null and played_at < %s",
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
            print(f"  {match_id}: falha ao apagar ({e})")
    print(f"cleanup: {total} demo(s) apagado(s)")
    return total


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

    pendentes = dbmod.listar_fila_pro_pendente(conn)
    if not pendentes:
        print("processar-fila-pro: nenhuma partida pendente")
        return 0

    client = storage_r2.make_client(config)
    total = 0
    for fila_id, hltv_url, arquivo_r2_key in pendentes:
        dbmod.atualizar_fila_pro(conn, fila_id, "baixando")
        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp = Path(tmp)
                if arquivo_r2_key:
                    print(f"  {fila_id}: baixando do R2 ({arquivo_r2_key})")
                    dados = storage_r2.download_bytes(client, config.r2_bucket, arquivo_r2_key)
                    ext = Path(arquivo_r2_key).suffix.lower()
                else:
                    print(f"  {fila_id}: baixando {hltv_url}")
                    with urllib.request.urlopen(hltv_url, timeout=120) as resp:
                        dados = resp.read()
                    ext = ".rar"

                dbmod.atualizar_fila_pro(conn, fila_id, "processando")
                # Um .rar do HLTV pode trazer vários mapas de uma série Bo3/Bo5 — um
                # .dem por mapa. Cada .dem processa (e falha) de forma isolada: um mapa
                # com erro não deve derrubar os outros mapas da MESMA série. Upload
                # manual de um .dem avulso pula a extração — já é o arquivo final.
                if ext == ".dem":
                    dem_path = tmp / "demo.dem"
                    dem_path.write_bytes(dados)
                    dem_paths = [dem_path]
                else:
                    rar_path = tmp / "demo.rar"
                    rar_path.write_bytes(dados)
                    dem_paths = rar_extract.extrair_dems_de_rar(rar_path, tmp / "extraido")

                match_ids = []
                erros_mapas = []
                for dem_path in dem_paths:
                    try:
                        mid = ingest_demo(config, conn, dem_path, source="pro", upload=True)
                        match_ids.append(mid)
                    except Exception as e:  # noqa: BLE001
                        conn.rollback()
                        erros_mapas.append(str(e))
                        print(f"  {fila_id}: mapa {dem_path.name} FALHOU ({e})")

                if not match_ids:
                    # Nenhum mapa processou — mesmo fluxo de erro que já existia.
                    raise RuntimeError(erros_mapas[0] if erros_mapas else "nenhum mapa processado")

                erro_nota = None
                if erros_mapas:
                    erro_nota = (
                        f"{len(match_ids)}/{len(dem_paths)} mapas processados; "
                        f"falhou: {erros_mapas[0]}"
                    )[:500]

                dbmod.atualizar_fila_pro(
                    conn, fila_id, "concluida", match_id=match_ids[0], match_ids=match_ids, erro=erro_nota
                )
                print(f"  {fila_id}: concluida ({len(match_ids)}/{len(dem_paths)} mapa(s))")
                total += 1

                # Apaga o staging só em sucesso — numa falha o arquivo continua no R2
                # pro botão de retry reaproveitar sem o admin subir de novo.
                if arquivo_r2_key:
                    storage_r2.delete_object(client, config.r2_bucket, arquivo_r2_key)
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            dbmod.atualizar_fila_pro(conn, fila_id, "falhou", erro=str(e)[:500])
            print(f"  {fila_id}: FALHOU ({e})")

    print(f"processar-fila-pro: {total} partida(s) processada(s)")
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
    for chave, tipo in TIPO_POR_CHAVE.items():
        for g in rdata.get(chave, []):
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
            })
    return lineups


def cmd_reprocess(config, conn, match_id=None):
    """Reprocessa Partida(s) já gravadas cujo .dem ainda está no R2 (janela de 90 dias
    do cleanup) — baixa de novo, roda o parser ATUAL (com fixes já aplicados) e regrava
    stats + replay.json no MESMO match_id (store_parsed é idempotente por fingerprint,
    e aqui nem precisa disso: já sabemos o id). Não usa ingest_demo: aquele resolve a
    key do R2 por share_code/hash de path, que pra upload manual sem share_code muda a
    cada chamada — aqui reaproveita a key já gravada em demo_url/replay_url, garantindo
    que sobrescreve o objeto certo em vez de deixar um novo órfão.

    `match_id` (opcional, uuid): reprocessa só essa Partida; sem isso, todas que ainda
    têm demo_url (pending/failed não têm o que reprocessar).
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
        else:
            cur.execute(
                "select id, share_code, source, demo_url, replay_url, played_at from matches "
                "where status = 'parsed' and demo_url is not null"
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
                dem.write_bytes(storage_r2.download_bytes(client, config.r2_bucket, demo_key))

                parsed = parsemod.parse_demo(dem)
                parsed["players"] = transform.fill_kd_from_kills(parsed["players"], parsed["kills"])
                parsed = transform.enrich(parsed)
                parsed["played_at"] = played_at.isoformat() if played_at else parsed.get("played_at")

                rdata = parsemod.extract_replay(dem)
                replay_json = replaymod.build_replay(
                    parsed["map"], rdata["ticks"], kills=rdata["kills"], extras=rdata
                )
                parsed["highlights"] = transform.attach_replay_frames(parsed["highlights"], replay_json["rounds"])
                parsed["lineups"] = _montar_lineups(rdata, replay_json, parsed["map"], source or "valve_mm")

                # Sobrescreve o MESMO objeto (key extraída do replay_url já gravado) —
                # não recalcula um novo, senão o antigo fica órfão e o link salvo quebra.
                replay_key = storage_r2.key_from_url(replay_url, config.r2_bucket) if replay_url else None
                if replay_key:
                    storage_r2.upload_bytes(
                        client, config.r2_bucket, replay_key,
                        json.dumps(replay_json).encode("utf-8"), content_type="application/json",
                    )

                dbmod.store_parsed(
                    conn, parsed, share_code=share_code, source=source or "valve_mm",
                    demo_url=demo_url, replay_url=replay_url, prefer_new_played_at=False,
                )
                print(f"  {mid}: reprocessada")
                total += 1
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            print(f"  {mid}: FALHOU ({e})")
    print(f"reprocess: {total} Partida(s) reprocessada(s)")
    return total


def ingest_demo(config, conn, path, share_code=None, source="upload", upload=True, played_at=None):
    """Parseia um .dem, arquiva no R2 (se configurado) e grava no banco. Devolve match_id.

    `played_at` (ISO 8601, opcional): quando o operador sabe a hora real da Partida,
    essa informação é mais confiável que a mtime do arquivo (que só reflete quando o
    .dem foi baixado/copiado — pode ser dias depois) e vence mesmo sobre um played_at
    já gravado por descoberta automática (prefer_new_played_at=True em store_parsed).
    """
    parsed = parsemod.parse_demo(path)
    parsed["players"] = transform.fill_kd_from_kills(parsed["players"], parsed["kills"])
    parsed = transform.enrich(parsed)
    if played_at:
        parsed["played_at"] = played_at

    # Replay 2D + clutch (sempre computados; só ARQUIVADOS no R2 se configurado).
    # Falha aqui não derruba o ingest dos stats.
    replay_json = None
    try:
        rdata = parsemod.extract_replay(path)
        replay_json = replaymod.build_replay(
            parsed["map"], rdata["ticks"], kills=rdata["kills"], extras=rdata
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
        print(f"aviso: replay 2D / clutch não gerado ({e})")

    demo_url = replay_url = None
    if upload and config.r2_endpoint:
        client = storage_r2.make_client(config)
        ids = sharecode.decode(share_code) if share_code else {"match_id": path.__hash__() & 0xFFFFFFFF}

        key = storage_r2.demo_key(ids["match_id"])
        with open(path, "rb") as fh:
            storage_r2.upload_bytes(client, config.r2_bucket, key, fh.read())
        demo_url = f"{config.r2_endpoint}/{config.r2_bucket}/{key}"

        if replay_json is not None:
            rkey = storage_r2.replay_key(ids["match_id"])
            storage_r2.upload_bytes(
                client, config.r2_bucket, rkey,
                json.dumps(replay_json).encode("utf-8"), content_type="application/json",
            )
            replay_url = f"{config.r2_endpoint}/{config.r2_bucket}/{rkey}"

    return dbmod.store_parsed(
        conn, parsed, share_code=share_code, source=source,
        demo_url=demo_url, replay_url=replay_url,
        prefer_new_played_at=bool(played_at),
    )


def main(argv=None):
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
    p_cleanup.add_argument("--days", type=int, default=90, help="Idade mínima em dias (default: 90).")
    p_reproc = sub.add_parser(
        "reprocess",
        help="Re-roda o parser atual em cima do .dem já arquivado no R2 (bug corrigido depois do ingest original) e regrava stats/replay.json.",
    )
    p_reproc.add_argument("--match-id", default=None, help="Reprocessa só essa Partida (uuid); sem isso, todas com demo ainda no R2.")
    sub.add_parser(
        "processar-fila-pro",
        help="Processa a fila de partidas profissionais: baixa .rar do HLTV, extrai o .dem e ingere (source='pro').",
    )

    args = ap.parse_args(argv)
    config = Config()
    config.require("database_url")
    conn = dbmod.connect(config.database_url)
    try:
        if args.cmd == "discover":
            cmd_discover(config, conn)
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
            cmd_reprocess(config, conn, match_id=args.match_id)
        elif args.cmd == "processar-fila-pro":
            cmd_processar_fila_pro(config, conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
