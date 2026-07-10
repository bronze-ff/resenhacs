"""Escrita do demo parseado no Postgres (contrato = schema da Fase 1).

store_parsed() é idempotente: reprocessar a mesma Partida atualiza as linhas em vez
de duplicar (match_players/rounds via upsert; highlights são recriados). A conexão
psycopg é injetada, então a lógica é testável com um fake que grava os executes.
"""


def match_fingerprint(parsed):
    """Digital de conteúdo da Partida: mapa + placar + jogadores com K/D. A MESMA partida
    parseada por dois caminhos (upload manual sem share code + download automático com)
    gera a mesma digital — é o que permite deduplicar. Colisão entre partidas distintas
    exigiria mesmo mapa, mesmo placar E os mesmos 10 jogadores com K/D idênticos."""
    import hashlib

    jogadores = sorted(
        f"{p['steam_id64']}:{p.get('kills', 0)}:{p.get('deaths', 0)}" for p in parsed.get("players", [])
    )
    base = f"{parsed.get('map')}|{parsed.get('score_a')}|{parsed.get('score_b')}|" + "|".join(jogadores)
    return hashlib.sha256(base.encode("utf-8")).hexdigest()[:32]


def _insert_match(cur, share_code, source, parsed, demo_url, replay_url, status, prefer_new_played_at=False):
    fingerprint = match_fingerprint(parsed)

    # Dedupe por conteúdo ANTES do insert: se a mesma partida já existe (chegou pelo
    # outro caminho), atualiza a linha existente em vez de criar uma duplicata — o
    # conflito de share_code sozinho não pega upload manual feito sem share code.
    cur.execute("select id from matches where fingerprint = %s", (fingerprint,))
    row = cur.fetchone()
    if row:
        match_id = row[0]
        if share_code:
            # Um placeholder 'pending' do discover pode estar segurando esse share code
            # em outra linha; absorve (é só um marcador, sem stats filhos).
            cur.execute(
                "delete from matches where share_code = %s and id <> %s and status = 'pending'",
                (share_code, match_id),
            )
        played_expr = "coalesce(%s, played_at)" if prefer_new_played_at else "coalesce(played_at, %s)"
        cur.execute(
            f"""
            update matches set
              share_code = coalesce(%s, share_code), source = %s, map = %s,
              score_a = %s, score_b = %s, played_at = {played_expr},
              demo_url = coalesce(%s, demo_url), replay_url = coalesce(%s, replay_url),
              status = %s
            where id = %s
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
                match_id,
            ),
        )
        return match_id

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
        insert into matches (share_code, source, map, score_a, score_b, played_at, demo_url, replay_url, status, fingerprint)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (share_code) do update set
          source = excluded.source, map = excluded.map,
          score_a = excluded.score_a, score_b = excluded.score_b,
          played_at = {played_at_expr},
          demo_url = coalesce(excluded.demo_url, matches.demo_url),
          replay_url = coalesce(excluded.replay_url, matches.replay_url),
          status = excluded.status,
          fingerprint = excluded.fingerprint
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
            fingerprint,
        ),
    )
    return cur.fetchone()[0]


def _write_players(cur, match_id, players):
    for p in players:
        cur.execute(
            """
            insert into match_players
              (match_id, steam_id64, nick, team, kills, deaths, assists,
               headshot_kills, damage, rounds_played, rating, won, team_kills,
               utility_damage, shots_fired, shots_hit,
               entry_kills, entry_deaths, entry_wins,
               trade_kills, traded_deaths, clutch_wins, clutch_attempts)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (match_id, steam_id64) do update set
              nick = excluded.nick, team = excluded.team, kills = excluded.kills,
              deaths = excluded.deaths, assists = excluded.assists,
              headshot_kills = excluded.headshot_kills, damage = excluded.damage,
              rounds_played = excluded.rounds_played, rating = excluded.rating,
              won = excluded.won, team_kills = excluded.team_kills,
              utility_damage = excluded.utility_damage,
              shots_fired = excluded.shots_fired, shots_hit = excluded.shots_hit,
              entry_kills = excluded.entry_kills, entry_deaths = excluded.entry_deaths,
              entry_wins = excluded.entry_wins,
              trade_kills = excluded.trade_kills, traded_deaths = excluded.traded_deaths,
              clutch_wins = excluded.clutch_wins, clutch_attempts = excluded.clutch_attempts
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
                p.get("utility_damage", 0),
                p.get("shots_fired", 0),
                p.get("shots_hit", 0),
                p.get("entry_kills", 0),
                p.get("entry_deaths", 0),
                p.get("entry_wins", 0),
                p.get("trade_kills", 0),
                p.get("traded_deaths", 0),
                p.get("clutch_wins", 0),
                p.get("clutch_attempts", 0),
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
            insert into highlights (match_id, steam_id64, round_number, kind, description, frame)
            values (%s, %s, %s, %s, %s, %s)
            """,
            (match_id, h["steam_id64"], h["round_number"], h["kind"], h.get("description", ""), h.get("frame")),
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


def list_pending_share_codes(conn):
    """Share codes de Partidas descobertas (discover) mas ainda sem demo — status pending."""
    with conn.cursor() as cur:
        cur.execute(
            "select share_code from matches "
            "where status = 'pending' and share_code is not null "
            "order by played_at nulls last"
        )
        return [r[0] for r in cur.fetchall()]


def mark_skipped(conn, share_code):
    """Marca uma Partida pendente como 'skipped' (ex.: fora da janela de data pedida),
    pra não ficar sendo re-resolvida a cada rodada do fetch."""
    with conn.cursor() as cur:
        cur.execute(
            "update matches set status = 'skipped' where share_code = %s and status = 'pending'",
            (share_code,),
        )
    conn.commit()


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
