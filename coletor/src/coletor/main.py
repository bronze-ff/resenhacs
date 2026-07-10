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
        for rnd in replay_json["rounds"]:
            c = rnd.get("clutch")
            if c:
                parsed["highlights"].append(
                    {
                        "steam_id64": c["steamid"],
                        "round_number": rnd["round"],
                        "kind": f"clutch_1v{c['vs']}",
                        "description": f"CLUTCH 1v{c['vs']} no round {rnd['round']}",
                        "frame": c["t"],
                    }
                )
        # Frame do Replay 2D pra cada highlight (deep link — Partida.jsx abre o replay
        # já no momento exato ao clicar). Clutch já veio com frame acima; multi-kill
        # ganha aqui, casando pela última kill do jogador no round.
        parsed["highlights"] = transform.attach_replay_frames(parsed["highlights"], replay_json["rounds"])
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
    finally:
        conn.close()


if __name__ == "__main__":
    main()
