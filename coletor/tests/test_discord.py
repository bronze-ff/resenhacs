import datetime
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import discord

WEBHOOK = "https://discord.com/api/webhooks/123/token-secreto"
STEAM = "76561198000000001"


class _Cursor:
    def __init__(self, respostas):
        self._respostas = list(respostas)
        self._atual = None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self._atual = self._respostas.pop(0)

    def fetchone(self):
        return self._atual[0] if self._atual else None

    def fetchall(self):
        return self._atual


class _Conn:
    def __init__(self, *respostas):
        self._respostas = respostas

    def cursor(self):
        return _Cursor(self._respostas)


import pytest


@pytest.fixture(autouse=True)
def _reserva_sempre_livre(monkeypatch):
    # Os testes de montagem/postagem não exercitam a reserva no banco (testada à parte).
    monkeypatch.setattr(discord, "_reservar", lambda conn, mid: True)
    monkeypatch.setattr(discord, "_liberar", lambda conn, mid: None)


def _conn_partida(grupo=None, score=(13, 7)):
    partida = [("de_nuke", score[0], score[1], datetime.datetime(2026, 10, 15, 22, 0, tzinfo=datetime.timezone.utc))]
    grupo = grupo if grupo is not None else [
        ("Toguro", "B", True, 1.31, 25, 12),
        ("zezinho", "B", True, 0.95, 14, 15),
    ]
    return _Conn(partida, grupo)


class _Resp:
    status = 204

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _capturar_urlopen(monkeypatch):
    chamadas = []

    def fake(req, timeout=None):
        chamadas.append({"url": req.full_url, "body": json.loads(req.data.decode("utf-8")), "timeout": timeout})
        return _Resp()

    monkeypatch.setattr(discord.urllib.request, "urlopen", fake)
    return chamadas


def test_sem_webhook_e_no_op(monkeypatch):
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    chamadas = _capturar_urlopen(monkeypatch)
    # conn=None: nem consulta o banco.
    assert discord.notificar_partida(None, "m1") is False
    assert chamadas == []


def test_posta_embed_com_mapa_placar_resultado_mvp_e_link(monkeypatch):
    chamadas = _capturar_urlopen(monkeypatch)
    ok = discord.notificar_partida(_conn_partida(), "abc-123", webhook_url=WEBHOOK, app_url="https://resenha.app/")
    assert ok is True
    assert len(chamadas) == 1
    assert chamadas[0]["url"] == WEBHOOK
    corpo = chamadas[0]["body"]
    embed = corpo["embeds"][0]
    assert embed["title"] == "Vitória na Nuke"
    assert embed["url"] == "https://resenha.app/partida/abc-123"
    assert embed["color"] == discord.COR_VITORIA
    campos = {c["name"]: c["value"] for c in embed["fields"]}
    # Grupo no time B: placar do ponto de vista dele.
    assert campos["Placar"] == "7 x 13"
    assert campos["MVP do grupo"] == "Toguro · rating 1.31 · 25/12"
    assert corpo["allowed_mentions"] == {"parse": []}
    assert STEAM not in json.dumps(corpo)


def test_derrota_e_sem_app_url(monkeypatch):
    chamadas = _capturar_urlopen(monkeypatch)
    conn = _conn_partida(grupo=[("Toguro", "A", False, 0.8, 10, 18)])
    assert discord.notificar_partida(conn, "m1", webhook_url=WEBHOOK, app_url="") is True
    embed = chamadas[0]["body"]["embeds"][0]
    assert embed["title"] == "Derrota na Nuke"
    assert "url" not in embed


def test_partida_sem_jogador_do_grupo_nao_posta(monkeypatch):
    chamadas = _capturar_urlopen(monkeypatch)
    assert discord.notificar_partida(_conn_partida(grupo=[]), "m1", webhook_url=WEBHOOK, app_url="") is False
    assert chamadas == []


def test_erro_de_rede_nao_lanca_nem_vaza_a_url(monkeypatch, capsys):
    def explode(req, timeout=None):
        raise OSError(f"falhou {WEBHOOK}")

    monkeypatch.setattr(discord.urllib.request, "urlopen", explode)
    assert discord.notificar_partida(_conn_partida(), "m1", webhook_url=WEBHOOK, app_url="") is False
    saida = capsys.readouterr().out
    assert "Discord não notificado" in saida
    assert "token-secreto" not in saida


def test_le_variaveis_de_ambiente(monkeypatch):
    chamadas = _capturar_urlopen(monkeypatch)
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", WEBHOOK)
    monkeypatch.setenv("APP_URL", "https://x.app")
    assert discord.notificar_partida(_conn_partida(), "m9") is True
    assert chamadas[0]["body"]["embeds"][0]["url"] == "https://x.app/partida/m9"


def test_partida_ja_notificada_nao_posta_de_novo(monkeypatch):
    chamadas = _capturar_urlopen(monkeypatch)
    monkeypatch.setattr(discord, "_reservar", lambda conn, mid: False)
    assert discord.notificar_partida(_conn_partida(), "m1", webhook_url=WEBHOOK, app_url="") is False
    assert chamadas == []


def test_falha_no_post_libera_a_reserva(monkeypatch):
    liberadas = []
    monkeypatch.setattr(discord, "_liberar", lambda conn, mid: liberadas.append(mid))

    def falha(req, timeout=None):
        raise OSError("rede")

    monkeypatch.setattr(discord.urllib.request, "urlopen", falha)
    assert discord.notificar_partida(_conn_partida(), "m1", webhook_url=WEBHOOK, app_url="") is False
    assert liberadas == ["m1"]


class _CursorReserva:
    def __init__(self, linha):
        self.linha = linha
        self.sql = None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self.sql = sql

    def fetchone(self):
        return self.linha


class _ConnReserva:
    def __init__(self, linha):
        self.cur = _CursorReserva(linha)
        self.commits = 0

    def cursor(self):
        return self.cur

    def commit(self):
        self.commits += 1


def test_reservar_usa_update_condicional(monkeypatch):
    monkeypatch.undo()
    conn = _ConnReserva(("m1",))
    assert discord._reservar(conn, "m1") is True
    assert "discord_notificado_em is null" in conn.cur.sql
    assert conn.commits == 1
    assert discord._reservar(_ConnReserva(None), "m1") is False


# ---- F3: Clipe pronto e Resenha da semana ----

RAIZ = Path(__file__).resolve().parents[2]
SP = datetime.timezone(datetime.timedelta(hours=-3))


class _CurSql:
    def __init__(self, conn):
        self.conn = conn
        self.res = None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self.conn.execs.append((sql, params))
        self.res = self.conn.responder(sql, params)

    def fetchone(self):
        return self.res[0] if self.res else None

    def fetchall(self):
        return self.res or []


class _ConnSql:
    """Responde por trecho de SQL; grava todo execute."""

    def __init__(self, responder):
        self.responder = responder
        self.execs = []
        self.commits = 0

    def cursor(self):
        return _CurSql(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass


def _conn_clipes(reais=(), allstar=(), perdidos=(), quebram=()):
    liberados = []

    def responder(sql, params):
        if "discord_notificado_em = now()" in sql and params[0] in quebram:
            raise RuntimeError("reserva falhou")
        if sql.startswith("select") and "from clipes_reais" in sql:
            return list(reais)
        if sql.startswith("select") and "from allstar_clips" in sql:
            return list(allstar)
        if "discord_notificado_em = now()" in sql:
            return [] if params[0] in perdidos else [(params[0],)]
        if "discord_notificado_em = null" in sql:
            liberados.append(params)
            return []
        raise AssertionError(sql)

    conn = _ConnSql(responder)
    conn.liberados = liberados
    return conn


@pytest.fixture
def _sem_fixture_de_reserva(monkeypatch):
    monkeypatch.undo()


def test_dois_clipes_da_mesma_partida_viram_um_post(monkeypatch, _sem_fixture_de_reserva):
    chamadas = _capturar_urlopen(monkeypatch)
    conn = _conn_clipes(
        reais=[("c1", "m1", "de_nuke", "fails", "Toguro")],
        allstar=[("a1", "m1", "de_nuke", "allstar", "zezinho")],
    )
    assert discord.avisar_clipes(conn, WEBHOOK, "https://resenha.app/") == 1
    assert len(chamadas) == 1
    corpo = chamadas[0]["body"]
    embed = corpo["embeds"][0]
    assert embed["title"] == "Clipe pronto na Nuke"
    assert embed["url"] == "https://resenha.app/partida/m1"
    assert embed["description"] == "Toguro · Fails\nzezinho · Allstar"
    assert corpo["allowed_mentions"] == {"parse": []}


def test_quatro_partidas_viram_tres_posts(monkeypatch, _sem_fixture_de_reserva):
    chamadas = _capturar_urlopen(monkeypatch)
    conn = _conn_clipes(reais=[(f"c{i}", f"m{i}", "de_inferno", "clipe", "Toguro") for i in range(4)])
    assert discord.avisar_clipes(conn, WEBHOOK, "") == 3
    assert len(chamadas) == 3
    reservados = [p[0] for s, p in conn.execs if "discord_notificado_em = now()" in s]
    assert reservados == ["c0", "c1", "c2"]


def test_reserva_perdida_nao_posta(monkeypatch, _sem_fixture_de_reserva):
    chamadas = _capturar_urlopen(monkeypatch)
    conn = _conn_clipes(reais=[("c1", "m1", "de_nuke", "clipe", "Toguro")], perdidos=("c1",))
    assert discord.avisar_clipes(conn, WEBHOOK, "") == 0
    assert chamadas == []


def test_post_com_erro_libera_a_reserva(monkeypatch, _sem_fixture_de_reserva):
    def falha(req, timeout=None):
        raise OSError("rede")

    monkeypatch.setattr(discord.urllib.request, "urlopen", falha)
    conn = _conn_clipes(
        reais=[("c1", "m1", "de_nuke", "clipe", "Toguro")],
        allstar=[("a1", "m1", "de_nuke", "allstar", None)],
    )
    with pytest.raises(OSError):
        discord.avisar_clipes(conn, WEBHOOK, "")
    assert sorted(p[0] for p in conn.liberados) == ["a1", "c1"]
    liberacoes = [s for s, _ in conn.execs if "discord_notificado_em = null" in s]
    assert any("update clipes_reais" in s for s in liberacoes)
    assert any("update allstar_clips" in s for s in liberacoes)


def test_falha_na_segunda_reserva_libera_a_primeira(monkeypatch, _sem_fixture_de_reserva):
    # Codex P1 no 67cdc9b: as reservas anteriores ficavam commitadas sem post.
    chamadas = _capturar_urlopen(monkeypatch)
    conn = _conn_clipes(
        reais=[("c1", "m1", "de_nuke", "clipe", "Toguro")],
        allstar=[("a1", "m1", "de_nuke", "allstar", None)],
        quebram=("a1",),
    )
    with pytest.raises(RuntimeError):
        discord.avisar_clipes(conn, WEBHOOK, "")
    assert chamadas == []
    assert [p[0] for p in conn.liberados] == ["c1"]


def test_falha_na_primeira_reserva_nao_libera_nada(monkeypatch, _sem_fixture_de_reserva):
    chamadas = _capturar_urlopen(monkeypatch)
    conn = _conn_clipes(reais=[("c1", "m1", "de_nuke", "clipe", "Toguro")], quebram=("c1",))
    with pytest.raises(RuntimeError):
        discord.avisar_clipes(conn, WEBHOOK, "")
    assert chamadas == [] and conn.liberados == []


def test_nick_so_de_jogador_is_tracked(monkeypatch, _sem_fixture_de_reserva):
    chamadas = _capturar_urlopen(monkeypatch)
    # O select devolve nick nulo para quem não é is_tracked; a linha vira só "Clipe".
    conn = _conn_clipes(reais=[("c1", "m1", "de_nuke", "coaching", None)])
    assert discord.avisar_clipes(conn, WEBHOOK, "") == 1
    assert chamadas[0]["body"]["embeds"][0]["description"] == "Clipe"
    selects = [s for s, _ in conn.execs if s.startswith("select")]
    assert len(selects) == 2
    for s in selects:
        # is_tracked existe só em match_players (0001), não em players.
        assert "mp.is_tracked" in s
        assert "p.is_tracked" not in s.replace("mp.is_tracked", "")
        assert "discord_notificado_em is null" in s
        assert "48 hours" in s
        assert "limit 20" in s
    assert STEAM not in json.dumps(chamadas[0]["body"])


def test_embed_mostra_no_maximo_5_linhas(monkeypatch, _sem_fixture_de_reserva):
    chamadas = _capturar_urlopen(monkeypatch)
    conn = _conn_clipes(reais=[(f"c{i}", "m1", "de_nuke", "clipe", f"j{i}") for i in range(7)])
    assert discord.avisar_clipes(conn, WEBHOOK, "") == 1
    assert len(chamadas[0]["body"]["embeds"][0]["description"].split("\n")) == 5
    assert len([s for s, _ in conn.execs if "discord_notificado_em = now()" in s]) == 7


CASOS_SEMANA = json.loads((RAIZ / "shared/premios/casos-semana.json").read_text(encoding="utf-8"))["casos"]


@pytest.mark.parametrize("caso", CASOS_SEMANA, ids=[c["nome"] for c in CASOS_SEMANA])
def test_paridade_dos_premios_com_o_javascript(caso):
    resultado = discord.calcular_premios_semana(caso["linhas"])
    assert resultado["numeros"] == caso["esperado"]["numeros"]
    assert resultado["premios"] == caso["esperado"]["premios"]


@pytest.mark.parametrize("agora, semana", [
    (datetime.datetime(2026, 10, 25, 23, 59, tzinfo=SP), None),   # domingo
    (datetime.datetime(2026, 10, 26, 9, 59, tzinfo=SP), None),    # segunda antes das 10h
    (datetime.datetime(2026, 10, 26, 10, 0, tzinfo=SP), datetime.date(2026, 10, 19)),
    (datetime.datetime(2026, 10, 26, 13, 0, tzinfo=datetime.timezone.utc), datetime.date(2026, 10, 19)),
    (datetime.datetime(2026, 10, 27, 10, 0, tzinfo=SP), None),    # terça
])
def test_semana_a_postar(agora, semana):
    assert discord.semana_a_postar(agora) == semana


def _linha_semana(match_id, steam, nick, won, rating, clutch, util):
    return (match_id, "de_nuke", steam, nick, "A", won, rating, clutch, util)


def _conn_semana(reservou=True, linhas=()):
    def responder(sql, params):
        if sql.startswith("insert into discord_resenha_semanal"):
            return [(params[0],)] if reservou else []
        if sql.startswith("delete from discord_resenha_semanal"):
            return []
        if sql.startswith("select"):
            return list(linhas)
        raise AssertionError(sql)

    return _ConnSql(responder)


SEGUNDA_10H = datetime.datetime(2026, 10, 26, 10, 0, tzinfo=SP)
LINHAS_SEMANA = [
    _linha_semana("m1", "76561198000000011", "Toguro", True, 1.2, 1, 100),
    _linha_semana("m2", "76561198000000011", "Toguro", False, 1.0, 0, 50),
]


def test_resenha_posta_na_segunda_10h_com_link_da_semana(monkeypatch):
    chamadas = _capturar_urlopen(monkeypatch)
    conn = _conn_semana(linhas=LINHAS_SEMANA)
    assert discord.avisar_resenha_semanal(conn, WEBHOOK, "https://resenha.app", SEGUNDA_10H) is True
    assert len(chamadas) == 1
    embed = chamadas[0]["body"]["embeds"][0]
    assert embed["title"] == "Resenha da semana"
    assert embed["url"] == "https://resenha.app/resenha?periodo=semana&ref=2026-10-19"
    assert "2 Partidas" in embed["description"]
    campos = {c["name"]: c["value"] for c in embed["fields"]}
    assert campos["Carregou"].startswith("Toguro")
    assert "76561198000000011" not in json.dumps(chamadas[0]["body"])
    insert = next(p for s, p in conn.execs if s.startswith("insert"))
    assert insert == (datetime.date(2026, 10, 19),)
    select_sql, select_params = next((s, p) for s, p in conn.execs if s.startswith("select"))
    assert "status = 'parsed'" in select_sql and "is_tracked" in select_sql
    assert "America/Sao_Paulo" in select_sql
    assert select_params == (datetime.date(2026, 10, 19), datetime.date(2026, 10, 26))


def test_resenha_ja_postada_na_semana_nao_posta(monkeypatch):
    chamadas = _capturar_urlopen(monkeypatch)
    conn = _conn_semana(reservou=False, linhas=LINHAS_SEMANA)
    assert discord.avisar_resenha_semanal(conn, WEBHOOK, "", SEGUNDA_10H) is False
    assert chamadas == []


def test_resenha_fora_da_hora_nem_toca_o_banco(monkeypatch):
    chamadas = _capturar_urlopen(monkeypatch)
    assert discord.avisar_resenha_semanal(None, WEBHOOK, "", datetime.datetime(2026, 10, 26, 9, 59, tzinfo=SP)) is False
    assert chamadas == []


def test_resenha_sem_partida_reserva_e_nao_posta(monkeypatch):
    chamadas = _capturar_urlopen(monkeypatch)
    conn = _conn_semana(linhas=[])
    assert discord.avisar_resenha_semanal(conn, WEBHOOK, "", SEGUNDA_10H) is False
    assert chamadas == []
    assert not any(s.startswith("delete") for s, _ in conn.execs)


def test_resenha_post_com_erro_libera_a_semana(monkeypatch):
    def falha(req, timeout=None):
        raise OSError("rede")

    monkeypatch.setattr(discord.urllib.request, "urlopen", falha)
    conn = _conn_semana(linhas=LINHAS_SEMANA)
    with pytest.raises(OSError):
        discord.avisar_resenha_semanal(conn, WEBHOOK, "", SEGUNDA_10H)
    delete = next(p for s, p in conn.execs if s.startswith("delete"))
    assert delete == (datetime.date(2026, 10, 19),)


def _colunas_das_migrations():
    """{tabela: {colunas}} lido de create table e add column de supabase/migrations."""
    import re

    colunas = {}
    for arq in sorted((RAIZ / "supabase/migrations").glob("*.sql")):
        sql = re.sub(r"--[^\n]*", "", arq.read_text(encoding="utf-8")).lower()
        for m in re.finditer(r"create table (?:if not exists )?(?:public\.)?(\w+)\s*\((.*?)\n\);", sql, re.S):
            for linha in m.group(2).split("\n"):
                nome = re.match(r"\s*(\w+)\s", linha + " ")
                if nome and nome.group(1) not in ("primary", "unique", "constraint", "check", "foreign"):
                    colunas.setdefault(m.group(1), set()).add(nome.group(1))
        for m in re.finditer(r"alter table (?:if exists )?(?:only )?(?:public\.)?(\w+)((?:\s*,?\s*add column (?:if not exists )?\w+[^,;]*)+)", sql):
            for col in re.findall(r"add column (?:if not exists )?(\w+)", m.group(2)):
                colunas.setdefault(m.group(1), set()).add(col)
    return colunas


def test_sql_do_f3_so_usa_coluna_que_existe_nas_migrations():
    import re

    colunas = _colunas_das_migrations()
    assert "is_tracked" in colunas["match_players"]
    assert "is_tracked" not in colunas["players"]
    for sql in (discord._SQL_CLIPES_REAIS, discord._SQL_CLIPES_ALLSTAR, discord._SQL_SEMANA):
        aliases = dict((a, t) for t, a in re.findall(r"(?:from|join) (\w+) (\w+)", sql))
        usados = re.findall(r"\b([a-z]{1,2})\.(\w+)", sql)
        assert usados
        for alias, col in usados:
            assert col in colunas[aliases[alias]], f"{aliases[alias]}.{col} não existe"


class _ConnSemanaFalha(_ConnSql):
    """Falha na consulta da semana (execute) ou no fetchall, depois da reserva."""

    def __init__(self, onde):
        super().__init__(_conn_semana(linhas=LINHAS_SEMANA).responder)
        self.onde = onde
        self.ordem = []

    def cursor(self):
        conn = self
        cur = _CurSql(self)
        execute, fetchall = cur.execute, cur.fetchall

        def _execute(sql, params=None):
            conn.ordem.append(sql.split()[0])
            if conn.onde == "execute" and sql.startswith("select"):
                raise RuntimeError("consulta falhou")
            execute(sql, params)

        def _fetchall():
            if conn.onde == "fetchall" and conn.ordem[-1] == "select":
                raise RuntimeError("fetchall falhou")
            return fetchall()

        cur.execute, cur.fetchall = _execute, _fetchall
        return cur

    def rollback(self):
        self.ordem.append("rollback")


@pytest.mark.parametrize("onde", ["execute", "fetchall"])
def test_resenha_falha_na_consulta_libera_a_semana(monkeypatch, onde):
    # Codex P2 no dd66c56: a reserva ficava e a semana se perdia para sempre.
    chamadas = _capturar_urlopen(monkeypatch)
    conn = _ConnSemanaFalha(onde)
    with pytest.raises(RuntimeError):
        discord.avisar_resenha_semanal(conn, WEBHOOK, "", SEGUNDA_10H)
    assert chamadas == []
    assert conn.ordem[-2:] == ["rollback", "delete"]
    delete = next(p for s, p in conn.execs if s.startswith("delete"))
    assert delete == (datetime.date(2026, 10, 19),)
    assert conn.commits == 2  # reserva e liberação


def test_backfill_da_0063_so_marca_clipe_pronto():
    # Codex P2 no bdfec22: Clipe em processamento ficava marcado e nunca era avisado.
    sql = " ".join((RAIZ / "supabase/migrations/0063_discord_avisos.sql").read_text(encoding="utf-8").split())
    assert ("update clipes_reais set discord_notificado_em = now() "
            "where status = 'pronto' and discord_notificado_em is null;") in sql
    assert ("update allstar_clips set discord_notificado_em = now() "
            "where status = 'Processed' and discord_notificado_em is null;") in sql
    assert sql.count("update ") == 2

