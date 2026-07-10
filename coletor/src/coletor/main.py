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
    finally:
        conn.close()


if __name__ == "__main__":
    main()
