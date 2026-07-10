"""Orquestrador do Coletor.

Dois modos:
  discover  — anda a corrente de share codes de cada Jogador (Steam Web API) e
              registra as Partidas novas como 'pending' (sem demo ainda).
  ingest    — parseia um .dem local, arquiva no R2 e grava os stats/highlights.

O download automático do .dem de matchmaking exige o Game Coordinator (conta-bot),
fora do escopo da Fase 2 — por isso 'discover' só descobre, e 'ingest' cobre o
caminho manual (o player/admin baixa o .dem e joga aqui). Ver README do coletor.
"""

import argparse
import sys

from . import db as dbmod
from . import parse as parsemod
from . import sharecode
from . import steam_api
from . import storage_r2
from . import transform
from .config import Config


def cmd_discover(config, conn):
    config.require("steam_api_key")
    total = 0
    for steam_id64, auth_code, last_code in dbmod.list_tracked_players(conn):
        novos = steam_api.walk_chain(config.steam_api_key, steam_id64, auth_code, last_code)
        for code in novos:
            if sharecode.is_valid(code):
                dbmod.record_pending_match(conn, code)
                total += 1
        if novos:
            dbmod.set_last_share_code(conn, steam_id64, novos[-1])
        print(f"{steam_id64}: {len(novos)} share codes novos")
    print(f"discover: {total} Partidas pendentes registradas")
    return total


def ingest_demo(config, conn, path, share_code=None, source="upload", upload=True):
    """Parseia um .dem, arquiva no R2 (se configurado) e grava no banco. Devolve match_id."""
    parsed = parsemod.parse_demo(path)
    parsed["players"] = transform.fill_kd_from_kills(parsed["players"], parsed["kills"])
    parsed = transform.enrich(parsed)

    demo_url = None
    if upload and config.r2_endpoint:
        client = storage_r2.make_client(config)
        ids = sharecode.decode(share_code) if share_code else {"match_id": path.__hash__() & 0xFFFFFFFF}
        key = storage_r2.demo_key(ids["match_id"])
        with open(path, "rb") as fh:
            storage_r2.upload_bytes(client, config.r2_bucket, key, fh.read())
        demo_url = f"{config.r2_endpoint}/{config.r2_bucket}/{key}"

    return dbmod.store_parsed(conn, parsed, share_code=share_code, source=source, demo_url=demo_url)


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
            )
            print(f"ingest: Partida gravada {mid}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
