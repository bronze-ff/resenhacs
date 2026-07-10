"""Escrita do demo parseado no Postgres (contrato = schema da Fase 1).

store_parsed() é idempotente: reprocessar a mesma Partida atualiza as linhas em vez
de duplicar (match_players/rounds via upsert; highlights são recriados). A conexão
psycopg é injetada, então a lógica é testável com um fake que grava os executes.
"""


def _insert_match(cur, share_code, source, parsed, demo_url, replay_url, status, prefer_new_played_at=False):
    # Por padrão preserva o played_at já gravado (normalmente a hora de descoberta,
    # mais precisa que a mtime do arquivo num re-ingest posterior). Quando o operador
    # passa --played-at explicitamente no ingest manual, prefer_new_played_at=True
    # deixa o valor informado vencer mesmo sobre um played_at já existente.
    played_at_expr = (
        "coalesce(excluded.played_at, matches.played_at)"
        if prefer_new_played_at
        else "coalesce(matches.played_at, excluded.played_at)"
    )
    cur.execute(
        f"""
        insert into matches (share_code, source, map, score_a, score_b, played_at, demo_url, replay_url, status)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (share_code) do update set
          source = excluded.source, map = excluded.map,
          score_a = excluded.score_a, score_b = excluded.score_b,
          played_at = {played_at_expr},
          demo_url = coalesce(excluded.demo_url, matches.demo_url),
          replay_url = coalesce(excluded.replay_url, matches.replay_url),
          status = excluded.status
        returning id
        """,
        (
            share_code,
            source,
            parsed.get("map"),
            parsed.get("score_a"),
            parsed.get("score_b"),
            parsed.get("played_at"),
            demo_url,
            replay_url,
            status,
        ),
    )
    return cur.fetchone()[0]


def _write_players(cur, match_id, players):
    for p in players:
        cur.execute(
            """
            insert into match_players
              (match_id, steam_id64, nick, team, kills, deaths, assists,
               headshot_kills, damage, rounds_played, rating, won, team_kills)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (match_id, steam_id64) do update set
              nick = excluded.nick, team = excluded.team, kills = excluded.kills,
              deaths = excluded.deaths, assists = excluded.assists,
              headshot_kills = excluded.headshot_kills, damage = excluded.damage,
              rounds_played = excluded.rounds_played, rating = excluded.rating,
              won = excluded.won, team_kills = excluded.team_kills
            """,
            (
                match_id,
                p["steam_id64"],
                p.get("nick", ""),
                p["team"],
                p.get("kills", 0),
                p.get("deaths", 0),
                p.get("assists", 0),
                p.get("headshot_kills", 0),
                p.get("damage", 0),
                p.get("rounds_played", 0),
                p.get("rating"),
                p.get("won"),
                p.get("team_kills", 0),
            ),
        )
    # is_tracked é cache de "é Jogador": liga para quem está na whitelist.
    cur.execute(
        "update match_players set is_tracked = true "
        "where match_id = %s and steam_id64 in (select steam_id64 from players)",
        (match_id,),
    )


def _write_rounds(cur, match_id, rounds):
    for r in rounds:
        cur.execute(
            """
            insert into rounds (match_id, round_number, winner_team, win_reason)
            values (%s, %s, %s, %s)
            on conflict (match_id, round_number) do update set
              winner_team = excluded.winner_team, win_reason = excluded.win_reason
            """,
            (match_id, r["round_number"], r.get("winner_team"), r.get("win_reason")),
        )


def _write_highlights(cur, match_id, highlights):
    cur.execute("delete from highlights where match_id = %s", (match_id,))
    for h in highlights:
        cur.execute(
            """
            insert into highlights (match_id, steam_id64, round_number, kind, description)
            values (%s, %s, %s, %s, %s)
            """,
            (match_id, h["steam_id64"], h["round_number"], h["kind"], h.get("description", "")),
        )


def store_parsed(conn, parsed, share_code=None, source="valve_mm", demo_url=None,
                 replay_url=None, status="parsed", prefer_new_played_at=False):
    """Grava a Partida inteira numa transação. Devolve o match_id (uuid)."""
    with conn.cursor() as cur:
        match_id = _insert_match(
            cur, share_code, source, parsed, demo_url, replay_url, status, prefer_new_played_at
        )
        _write_players(cur, match_id, parsed.get("players", []))
        _write_rounds(cur, match_id, parsed.get("rounds", []))
        _write_highlights(cur, match_id, parsed.get("highlights", []))
    conn.commit()
    return match_id


def record_pending_match(conn, share_code, source="valve_mm"):
    """Registra um share code descoberto sem demo ainda (status pending). Idempotente.

    Grava played_at = now() (hora da descoberta): é bem mais próximo da hora real
    da Partida do que a mtime do .dem, que só reflete quando o arquivo foi baixado
    (pode ser dias depois — o formato .dem não guarda data em lugar nenhum).
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into matches (share_code, source, status, played_at)
            values (%s, %s, 'pending', now())
            on conflict (share_code) do nothing
            returning id
            """,
            (share_code, source),
        )
        row = cur.fetchone()
    conn.commit()
    return row[0] if row else None


def list_tracked_players(conn):
    """[(steam_id64, match_auth_code, last_share_code)] dos Jogadores com onboarding feito."""
    with conn.cursor() as cur:
        cur.execute(
            "select steam_id64, match_auth_code, last_share_code from players "
            "where match_auth_code is not null and last_share_code is not null"
        )
        return cur.fetchall()


def set_last_share_code(conn, steam_id64, share_code):
    with conn.cursor() as cur:
        cur.execute(
            "update players set last_share_code = %s where steam_id64 = %s",
            (share_code, steam_id64),
        )
    conn.commit()


def connect(database_url):
    import psycopg

    return psycopg.connect(database_url)
