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
