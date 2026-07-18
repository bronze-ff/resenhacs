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


def _insert_match(cur, share_code, source, parsed, demo_url, replay_url, status, prefer_new_played_at=False, group_id=None):
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
              status = %s, team_a_name = coalesce(%s, team_a_name),
              team_b_name = coalesce(%s, team_b_name)
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
                parsed.get("team_a_name"),
                parsed.get("team_b_name"),
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
        insert into matches (share_code, source, map, score_a, score_b, played_at, demo_url, replay_url, status, fingerprint, team_a_name, team_b_name, group_id)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (share_code) do update set
          source = excluded.source, map = excluded.map,
          score_a = excluded.score_a, score_b = excluded.score_b,
          played_at = {played_at_expr},
          demo_url = coalesce(excluded.demo_url, matches.demo_url),
          replay_url = coalesce(excluded.replay_url, matches.replay_url),
          status = excluded.status,
          fingerprint = excluded.fingerprint,
          team_a_name = coalesce(excluded.team_a_name, matches.team_a_name),
          team_b_name = coalesce(excluded.team_b_name, matches.team_b_name)
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
            parsed.get("team_a_name"),
            parsed.get("team_b_name"),
            group_id,
        ),
    )
    return cur.fetchone()[0]


def _write_players(cur, match_id, players):
    for p in players:
        cur.execute(
            """
            insert into match_players
              (match_id, steam_id64, nick, team, kills, deaths, assists,
               headshot_kills, damage, rounds_played, rating, kast_pct, won, team_kills,
               utility_damage, shots_fired, shots_hit,
               entry_kills, entry_deaths, entry_wins,
               trade_kills, traded_deaths, clutch_wins, clutch_attempts,
               he_damage, molotov_damage, smokes_thrown, flashes_thrown,
               he_thrown, molotovs_thrown, enemies_flashed, teammates_flashed,
               enemy_flash_duration, teammate_flash_duration, clutch_saves,
               he_team_damage, molotov_team_damage, flash_assists,
               enemy_flash_landed_count, enemy_flash_landed_duration_sum,
               premier_rating_before, premier_rating_after)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s)
            on conflict (match_id, steam_id64) do update set
              nick = excluded.nick, team = excluded.team, kills = excluded.kills,
              deaths = excluded.deaths, assists = excluded.assists,
              headshot_kills = excluded.headshot_kills, damage = excluded.damage,
              rounds_played = excluded.rounds_played, rating = excluded.rating,
              kast_pct = excluded.kast_pct,
              won = excluded.won, team_kills = excluded.team_kills,
              utility_damage = excluded.utility_damage,
              shots_fired = excluded.shots_fired, shots_hit = excluded.shots_hit,
              entry_kills = excluded.entry_kills, entry_deaths = excluded.entry_deaths,
              entry_wins = excluded.entry_wins,
              trade_kills = excluded.trade_kills, traded_deaths = excluded.traded_deaths,
              clutch_wins = excluded.clutch_wins, clutch_attempts = excluded.clutch_attempts,
              he_damage = excluded.he_damage, molotov_damage = excluded.molotov_damage,
              smokes_thrown = excluded.smokes_thrown, flashes_thrown = excluded.flashes_thrown,
              he_thrown = excluded.he_thrown, molotovs_thrown = excluded.molotovs_thrown,
              enemies_flashed = excluded.enemies_flashed,
              teammates_flashed = excluded.teammates_flashed,
              enemy_flash_duration = excluded.enemy_flash_duration,
              teammate_flash_duration = excluded.teammate_flash_duration,
              clutch_saves = excluded.clutch_saves,
              he_team_damage = excluded.he_team_damage,
              molotov_team_damage = excluded.molotov_team_damage,
              flash_assists = excluded.flash_assists,
              enemy_flash_landed_count = excluded.enemy_flash_landed_count,
              enemy_flash_landed_duration_sum = excluded.enemy_flash_landed_duration_sum,
              premier_rating_before = excluded.premier_rating_before,
              premier_rating_after = excluded.premier_rating_after
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
                p.get("kast_pct"),
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
                p.get("he_damage", 0),
                p.get("molotov_damage", 0),
                p.get("smokes_thrown", 0),
                p.get("flashes_thrown", 0),
                p.get("he_thrown", 0),
                p.get("molotovs_thrown", 0),
                p.get("enemies_flashed", 0),
                p.get("teammates_flashed", 0),
                p.get("enemy_flash_duration", 0),
                p.get("teammate_flash_duration", 0),
                p.get("clutch_saves", 0),
                p.get("he_team_damage", 0),
                p.get("molotov_team_damage", 0),
                p.get("flash_assists", 0),
                p.get("enemy_flash_landed_count", 0),
                p.get("enemy_flash_landed_duration_sum", 0),
                p.get("premier_rating_before"),
                p.get("premier_rating_after"),
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


def _write_player_weapons(cur, match_id, players):
    # delete-antes-de-insert (mesmo padrão de _write_highlights): reprocesso/re-ingest
    # não pode duplicar nem deixar arma "presa" de uma versão antiga do parser.
    cur.execute("delete from match_player_weapons where match_id = %s", (match_id,))
    for p in players:
        for arma, stats in p.get("weapons", {}).items():
            if not arma:
                continue
            cur.execute(
                """
                insert into match_player_weapons
                  (match_id, steam_id64, weapon, kills, hs_kills, shots_fired, shots_hit, damage)
                values (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    match_id, p["steam_id64"], arma,
                    stats.get("kills", 0), stats.get("hs_kills", 0),
                    stats.get("shots_fired", 0), stats.get("shots_hit", 0), stats.get("damage", 0),
                ),
            )


def _write_round_econ(cur, match_id, round_econ):
    cur.execute("delete from match_round_econ where match_id = %s", (match_id,))
    for e in round_econ:
        cur.execute(
            """
            insert into match_round_econ (match_id, round_number, team, equip_value, buy_type)
            values (%s, %s, %s, %s, %s)
            """,
            (match_id, e["round_number"], e["team"], e["equip_value"], e["buy_type"]),
        )


def _write_player_round_econ(cur, match_id, player_round_econ):
    # ON CONFLICT DO UPDATE (não só o delete por match_id acima): uma partida com
    # reinício técnico no meio do round 1 gera 2 leituras de current_equip_value pro
    # mesmo (round_number, steam_id64) — sem isso, a segunda linha duplicada estoura
    # a PK e derruba o ingest inteiro (achado real: upload manual que travava com
    # "duplicate key value... match_player_round_econ_pkey"). Fica o valor mais
    # recente (excluded.*), que reflete o estado após o reinício.
    cur.execute("delete from match_player_round_econ where match_id = %s", (match_id,))
    for e in player_round_econ:
        cur.execute(
            """
            insert into match_player_round_econ
              (match_id, round_number, steam_id64, team, equip_value, buy_type)
            values (%s, %s, %s, %s, %s, %s)
            on conflict (match_id, round_number, steam_id64) do update set
              team = excluded.team, equip_value = excluded.equip_value, buy_type = excluded.buy_type
            """,
            (match_id, e["round_number"], e["steam_id64"], e.get("team"), e["equip_value"], e["buy_type"]),
        )


def _write_purchases(cur, match_id, purchases):
    cur.execute("delete from match_player_purchases where match_id = %s", (match_id,))
    for c in purchases:
        cur.execute(
            """
            insert into match_player_purchases (match_id, round_number, steam_id64, item, cost, tick)
            values (%s, %s, %s, %s, %s, %s)
            """,
            (match_id, c["round_number"], c["steam_id64"], c["item"], c.get("cost"), c.get("tick")),
        )


def _write_player_damage(cur, match_id, player_damage):
    cur.execute("delete from match_player_damage where match_id = %s", (match_id,))
    for d in player_damage:
        cur.execute(
            """
            insert into match_player_damage (match_id, attacker, victim, weapon, damage, hits)
            values (%s, %s, %s, %s, %s, %s)
            """,
            (match_id, d["attacker"], d["victim"], d["weapon"], d["damage"], d["hits"]),
        )


def _write_player_flashes(cur, match_id, player_flashes):
    cur.execute("delete from match_player_flashes where match_id = %s", (match_id,))
    for f in player_flashes:
        cur.execute(
            """
            insert into match_player_flashes (match_id, attacker, victim, count, duration_sum)
            values (%s, %s, %s, %s, %s)
            """,
            (match_id, f["attacker"], f["victim"], f["count"], f["duration_sum"]),
        )


def _write_kill_positions(cur, match_id, kill_positions):
    cur.execute("delete from kill_positions where match_id = %s", (match_id,))
    for k in kill_positions:
        cur.execute(
            """
            insert into kill_positions
              (match_id, round_number, tick, killer, victim, weapon, victim_weapon, headshot,
               killer_x, killer_y, victim_x, victim_y)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                match_id, k["round_number"], k["tick"], k.get("killer"), k["victim"],
                k.get("weapon", ""), k.get("victim_weapon"), k.get("headshot", False),
                k.get("killer_x"), k.get("killer_y"), k["victim_x"], k["victim_y"],
            ),
        )


def _write_lineups(cur, match_id, lineups):
    cur.execute("delete from lineups where match_id = %s", (match_id,))
    for l in lineups:
        cur.execute(
            """
            insert into lineups
              (match_id, round_number, map, tipo, thrower_steam_id, thrower_nick,
               thrower_x, thrower_y, thrower_yaw, thrower_pitch, target_x, target_y,
               tick, origem, lado)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                match_id, l["round_number"], l["map"], l["tipo"],
                l["thrower_steam_id"], l.get("thrower_nick", ""),
                l["thrower_x"], l["thrower_y"], l.get("thrower_yaw", 0), l.get("thrower_pitch", 0),
                l["target_x"], l["target_y"], l["tick"], l["origem"], l.get("lado"),
            ),
        )


def store_parsed(conn, parsed, share_code=None, source="valve_mm", demo_url=None,
                 replay_url=None, status="parsed", prefer_new_played_at=False, group_id=None):
    """Grava a Partida inteira numa transação. Devolve o match_id (uuid).

    group_id só é usado quando a Partida ainda não existe (nem por fingerprint nem por
    share_code) — se já existe (reprocess, ou union com um 'pending' do discover), o
    group_id já gravado antes é preservado, nunca sobrescrito aqui.
    """
    with conn.cursor() as cur:
        match_id = _insert_match(
            cur, share_code, source, parsed, demo_url, replay_url, status, prefer_new_played_at,
            group_id=group_id,
        )
        _write_players(cur, match_id, parsed.get("players", []))
        _write_rounds(cur, match_id, parsed.get("rounds", []))
        _write_highlights(cur, match_id, parsed.get("highlights", []))
        _write_player_weapons(cur, match_id, parsed.get("players", []))
        _write_round_econ(cur, match_id, parsed.get("round_econ", []))
        _write_player_round_econ(cur, match_id, parsed.get("player_round_econ", []))
        _write_purchases(cur, match_id, parsed.get("purchases", []))
        _write_player_damage(cur, match_id, parsed.get("player_damage", []))
        _write_player_flashes(cur, match_id, parsed.get("player_flashes", []))
        _write_kill_positions(cur, match_id, parsed.get("kill_positions", []))
        _write_lineups(cur, match_id, parsed.get("lineups", []))
    conn.commit()
    return match_id


def record_pending_match(conn, share_code, group_id, source="valve_mm"):
    """Registra um share code descoberto sem demo ainda (status pending). Idempotente.

    Grava played_at = now() (hora da descoberta): é bem mais próximo da hora real
    da Partida do que a mtime do .dem, que só reflete quando o arquivo foi baixado
    (pode ser dias depois — o formato .dem não guarda data em lugar nenhum).

    group_id é obrigatório (matches.group_id é not null) — o chamador (cmd_discover)
    já sabe de qual Jogador veio esse share code, então usa o grupo_ativo_id dele.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into matches (share_code, source, status, played_at, group_id)
            values (%s, %s, 'pending', now(), %s)
            on conflict (share_code) do nothing
            returning id
            """,
            (share_code, source, group_id),
        )
        row = cur.fetchone()
    conn.commit()
    return row[0] if row else None


def list_pending_share_codes(conn, limit=None):
    """Share codes de Partidas descobertas (discover) mas ainda sem demo — status pending.

    `limit` (opcional) processa só as N mais antigas por vez — o fetch baixa+parseia em série
    e cada run tem janela de 45 min no Actions; com a fila grande, resolver/baixar tudo de uma
    vez estoura o timeout e o run é cancelado sem commitar. Em lotes, cada run termina e commita,
    e os runs de 30 em 30 min drenam o backlog (FIFO por played_at)."""
    with conn.cursor() as cur:
        cur.execute(
            "select share_code from matches "
            "where status = 'pending' and share_code is not null "
            "order by played_at nulls last"
            + (" limit %s" if limit else ""),
            (limit,) if limit else None,
        )
        return [r[0] for r in cur.fetchall()]


def contar_pendentes(conn):
    """Quantas Partidas estão em status pending (com share_code) — pra logar o backlog."""
    with conn.cursor() as cur:
        cur.execute(
            "select count(*) from matches where status = 'pending' and share_code is not null"
        )
        return cur.fetchone()[0]


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
    """[(steam_id64, match_auth_code, last_share_code, grupo_ativo_id)] dos Jogadores com
    onboarding feito. grupo_ativo_id pode vir None se o Jogador nunca escolheu/criou um
    grupo (o chamador decide o que fazer nesse caso — hoje: pula e avisa)."""
    with conn.cursor() as cur:
        cur.execute(
            "select steam_id64, match_auth_code, last_share_code, grupo_ativo_id from players "
            "where match_auth_code is not null and last_share_code is not null"
        )
        return cur.fetchall()


def grupo_para_ingest(conn, steam_ids):
    """Escolhe o grupo pra atribuir uma Partida ingerida sem contexto explícito de "quem
    importou" (upload manual, fila de Partidas Pro, reprocess de fingerprint novo): usa o
    grupo ativo de qualquer Jogador conhecido presente na Partida; se nenhum (ex.: demo pro
    sem ninguém do sistema), cai no grupo mais antigo. Stopgap enquanto o Coletor não tem um
    conceito explícito de "grupo de quem fez o upload" — ver spec de multi-tenancy (fora de
    escopo lá, mas sem isso a inserção falha com not-null violation em matches.group_id)."""
    with conn.cursor() as cur:
        cur.execute(
            "select grupo_ativo_id from players "
            "where steam_id64 = any(%s) and grupo_ativo_id is not null limit 1",
            (list(steam_ids),),
        )
        row = cur.fetchone()
        if row:
            return row[0]
        cur.execute("select id from groups order by criado_em limit 1")
        row = cur.fetchone()
        return row[0] if row else None


def set_last_share_code(conn, steam_id64, share_code):
    with conn.cursor() as cur:
        cur.execute(
            "update players set last_share_code = %s where steam_id64 = %s",
            (share_code, steam_id64),
        )
    conn.commit()


def listar_fila_pro_pendente(conn):
    with conn.cursor() as cur:
        cur.execute(
            "select id, hltv_url, arquivo_r2_key from partidas_pro_fila "
            "where status = 'pendente' order by adicionado_em"
        )
        return cur.fetchall()


def atualizar_fila_pro(conn, fila_id, status, match_id=None, erro=None, match_ids=None):
    with conn.cursor() as cur:
        cur.execute(
            "update partidas_pro_fila set status = %s, match_id = %s, erro = %s, match_ids = %s where id = %s",
            (status, match_id, erro, match_ids if match_ids is not None else [], fila_id),
        )
    conn.commit()


def listar_uploads_pendentes(conn):
    """Fila de uploads manuais (qualquer membro do grupo, via 'Enviar Demo' no site) —
    par simplificado de listar_fila_pro_pendente: um .dem só por item, sem .rar/multi-mapa,
    e já sabendo o group_id de quem enviou (não precisa de grupo_para_ingest)."""
    with conn.cursor() as cur:
        cur.execute(
            "select id, group_id, adicionado_por, arquivo_r2_key, share_code, played_at "
            "from uploads_pendentes where status = 'pendente' order by adicionado_em"
        )
        return cur.fetchall()


def atualizar_upload_pendente(conn, upload_id, status, match_id=None, erro=None):
    with conn.cursor() as cur:
        cur.execute(
            "update uploads_pendentes set status = %s, match_id = %s, erro = %s where id = %s",
            (status, match_id, erro, upload_id),
        )
    conn.commit()


def upsert_avatares(conn, mapa):
    """Grava/atualiza o cache de avatares (dict steam_id64 -> avatar_url). Idempotente:
    reprocessar o mesmo id só atualiza avatar_url e atualizado_em."""
    if not mapa:
        return
    with conn.cursor() as cur:
        for steam_id64, avatar_url in mapa.items():
            cur.execute(
                """
                insert into steam_avatares (steam_id64, avatar_url, atualizado_em)
                values (%s, %s, now())
                on conflict (steam_id64) do update set
                  avatar_url = excluded.avatar_url, atualizado_em = excluded.atualizado_em
                """,
                (steam_id64, avatar_url),
            )
    conn.commit()


def listar_steam_ids_sem_avatar_fresco(conn, steam_ids, dias=30):
    """Filtra `steam_ids` mantendo só os que NÃO têm avatar em cache recente (ausente
    ou atualizado_em mais velho que `dias`) — evita bater na Steam Web API de novo
    pra quem já foi resolvido há pouco tempo."""
    steam_ids = list(dict.fromkeys(s for s in steam_ids if s))
    if not steam_ids:
        return []
    with conn.cursor() as cur:
        cur.execute(
            "select steam_id64 from steam_avatares "
            "where steam_id64 = any(%s) and atualizado_em > now() - (%s || ' days')::interval",
            (steam_ids, dias),
        )
        frescos = {r[0] for r in cur.fetchall()}
    return [s for s in steam_ids if s not in frescos]


def listar_steam_ids_de_match_players_sem_avatar_fresco(conn, dias=30):
    """Todos os steam_id64 distintos que já apareceram em alguma Partida
    (match_players) e não têm avatar em cache recente — usado pelo backfill."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select distinct mp.steam_id64
            from match_players mp
            left join steam_avatares sa on sa.steam_id64 = mp.steam_id64
            where sa.steam_id64 is null or sa.atualizado_em <= now() - (%s || ' days')::interval
            """,
            (dias,),
        )
        return [r[0] for r in cur.fetchall()]


def connect(database_url):
    import psycopg

    return psycopg.connect(database_url)


# ---------------------------------------------------------------------------
# FACEIT Fase B: fila de partidas descobertas + ELO (ver spec 2026-07-16)


def listar_vinculados_faceit(conn):
    """Membros com conta FACEIT vinculada (Fase A) e grupo ativo — a descoberta roda
    pra cada um deles."""
    with conn.cursor() as cur:
        cur.execute(
            "select steam_id64, faceit_id, grupo_ativo_id from players "
            "where faceit_id is not null and grupo_ativo_id is not null"
        )
        return cur.fetchall()


def faceit_match_ids_conhecidos(conn):
    """Tudo que já foi visto: ingerido (matches) ou enfileirado (qualquer status)."""
    with conn.cursor() as cur:
        cur.execute(
            "select faceit_match_id from matches where faceit_match_id is not null "
            "union select faceit_match_id from faceit_pendentes"
        )
        return {r[0] for r in cur.fetchall()}


def membro_ja_sincronizou_faceit(conn, steam_id64):
    """True se a descoberta já rodou alguma vez pra esse membro (linhas na fila, em
    qualquer status, são o marcador persistente — itens 'done' nunca são apagados)."""
    with conn.cursor() as cur:
        cur.execute("select 1 from faceit_pendentes where steam_id64 = %s limit 1", (steam_id64,))
        return cur.fetchone() is not None


def enfileirar_faceit(conn, faceit_match_id, steam_id64, group_id):
    with conn.cursor() as cur:
        cur.execute(
            "insert into faceit_pendentes (faceit_match_id, steam_id64, group_id) "
            "values (%s, %s, %s) on conflict (faceit_match_id) do nothing",
            (faceit_match_id, steam_id64, group_id),
        )
    conn.commit()


def listar_faceit_pendentes(conn, limite=10):
    with conn.cursor() as cur:
        cur.execute(
            "select faceit_match_id, steam_id64, group_id, tentativas from faceit_pendentes "
            "where status = 'pending' order by created_at limit %s",
            (limite,),
        )
        return cur.fetchall()


def concluir_faceit_pendente(conn, faceit_match_id):
    with conn.cursor() as cur:
        cur.execute(
            "update faceit_pendentes set status = 'done', erro = null "
            "where faceit_match_id = %s",
            (faceit_match_id,),
        )
    conn.commit()


def falhar_faceit_pendente(conn, faceit_match_id, erro, max_tentativas=3):
    """Incrementa tentativas; volta pra 'pending' (retry na próxima rodada) até o limite,
    depois fica 'failed' pra inspeção manual — mesma semântica da fila de uploads."""
    with conn.cursor() as cur:
        cur.execute(
            "update faceit_pendentes set "
            "status = case when tentativas + 1 >= %s then 'failed' else 'pending' end, "
            "tentativas = tentativas + 1, erro = %s "
            "where faceit_match_id = %s",
            (max_tentativas, str(erro)[:500], faceit_match_id),
        )
    conn.commit()


def marcar_faceit_match(conn, match_id, faceit_match_id):
    with conn.cursor() as cur:
        cur.execute(
            "update matches set faceit_match_id = %s where id = %s",
            (faceit_match_id, match_id),
        )
    conn.commit()


def elo_snapshot(conn, steam_id64):
    with conn.cursor() as cur:
        cur.execute(
            "select faceit_elo, faceit_elo_atualizado_em from players where steam_id64 = %s",
            (steam_id64,),
        )
        row = cur.fetchone()
        return (row[0], row[1]) if row else (None, None)


def atualizar_elo(conn, steam_id64, elo, level):
    with conn.cursor() as cur:
        cur.execute(
            "update players set faceit_elo = %s, faceit_skill_level = %s, "
            "faceit_elo_atualizado_em = now() where steam_id64 = %s",
            (elo, level, steam_id64),
        )
    conn.commit()


def gravar_elo_partida(conn, match_id, steam_id64, before, after):
    with conn.cursor() as cur:
        cur.execute(
            "update match_players set faceit_elo_before = %s, faceit_elo_after = %s "
            "where match_id = %s and steam_id64 = %s",
            (before, after, match_id, steam_id64),
        )
    conn.commit()
