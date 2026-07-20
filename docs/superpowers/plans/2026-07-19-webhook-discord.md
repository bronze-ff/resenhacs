# Webhook do Discord Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o Coletor processa uma Partida nova, postar automaticamente um resumo (embed) no canal do Discord de cada grupo com membro na partida — placar e MVP do ponto de vista daquele grupo, com link pra abrir a Partida no Resenha.

**Architecture:** Nova coluna `groups.discord_webhook_url` (config por grupo, editada pelo admin na UI) + tabela `discord_notifications` (idempotência). Disparo no Coletor Python, dentro de `cmd_fetch`, logo após cada `ingest_demo` bem-sucedido — best-effort, nunca derruba o fetch. Módulo novo `discord_notify.py` (embed + POST HTTP, injetável pra teste) + funções novas em `db.py`.

**Tech Stack:** Python (Coletor, stdlib `urllib.request`), Postgres (Supabase), Express (server), React (client).

## Global Constraints

- Placar e MVP calculados **do ponto de vista de cada grupo** (time majoritário dos membros do grupo na partida; empate no critério de contagem resolvido pelo membro de menor `steam_id64`), não o placar/MVP genérico da partida.
- Um aviso por `(match_id, group_id)` — nunca duplica em reprocessamento (`discord_notifications` como trava).
- Falha ao notificar o Discord (link inválido, timeout, rate limit) **nunca** deve marcar a Partida como `failed` nem interromper o loop de `cmd_fetch` — loga e segue.
- Grupo sem `discord_webhook_url` configurado: pulado silenciosamente, sem log de erro.
- Escopo v1: só o fluxo `cmd_fetch` (Partidas Pro e uploads manuais ficam de fora).
- Sem dependência nova no Coletor (usar `urllib.request`, mesmo padrão de `faceit.py`).

---

### Task 1: Migration — coluna e tabela novas

**Files:**
- Create: `supabase/migrations/0033_discord_webhook.sql`

**Interfaces:**
- Produces: coluna `groups.discord_webhook_url` (text, nullable); tabela `discord_notifications (match_id uuid, group_id uuid, sent_at timestamptz, primary key (match_id, group_id))`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Webhook do Discord por grupo (item 6 do ROADMAP): quando o Coletor processa uma
-- Partida nova, posta um resumo automático no canal configurado pelo admin do grupo.
alter table groups add column discord_webhook_url text;

-- Idempotência: uma linha por (partida, grupo) já notificado, pra não duplicar aviso
-- em reprocessamento. Sem coluna própria em `matches` porque agora uma partida pode
-- notificar vários grupos (visibilidade por participação).
create table discord_notifications (
  match_id uuid not null references matches(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (match_id, group_id)
);
```

- [ ] **Step 2: Aplicar a migration no Supabase**

Abra o SQL Editor do projeto Supabase (`hrpgbrfqxqjxpsjeymec`) e rode o conteúdo do
arquivo. Confirme com:
```sql
select column_name from information_schema.columns where table_name = 'groups' and column_name = 'discord_webhook_url';
select count(*) from discord_notifications;
```
Esperado: a coluna aparece; a segunda query devolve `0`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0033_discord_webhook.sql
git commit -m "feat: migration do webhook do Discord (coluna + tabela de idempotencia)"
```

---

### Task 2: Coletor — funções de banco (`db.py`)

**Files:**
- Modify: `coletor/src/coletor/db.py` (adicionar ao final do arquivo)
- Test: `coletor/tests/test_storage_db.py` (adicionar ao final do arquivo)

**Interfaces:**
- Consumes: tabelas `groups`, `discord_notifications`, `group_members`, `match_players`, `matches` (Task 1).
- Produces: `grupos_da_partida(conn, match_id) -> list[str]`, `webhook_do_grupo(conn, group_id) -> str | None`, `ja_notificado_discord(conn, match_id, group_id) -> bool`, `marcar_notificado_discord(conn, match_id, group_id) -> None`, `resumo_da_partida_para_grupo(conn, match_id, group_id) -> dict | None` (chaves: `map`, `score_grupo`, `score_rival`, `mvp_nick`, `mvp_rating`).

- [ ] **Step 1: Escrever os testes (FakeConn/FakeCursor já existem em `test_storage_db.py`)**

Adicione ao final de `coletor/tests/test_storage_db.py` — primeiro, estenda `FakeCursor`
pra rotear os `SELECT`s novos (edite o método `fetchall`/`fetchone` existentes, ver
Step 2), depois os testes:

```python
# ---- discord ----

def test_grupos_da_partida():
    conn = FakeConn()
    conn.grupos_da_partida_rows = [("g1",), ("g2",)]
    resultado = db.grupos_da_partida(conn, "m1")
    assert resultado == ["g1", "g2"]
    assert any("group_members gm" in c[0] and "match_players mp" in c[0] for c in conn.calls)


def test_webhook_do_grupo_configurado():
    conn = FakeConn()
    conn.webhook_do_grupo_row = ("https://discord.com/api/webhooks/x/y",)
    resultado = db.webhook_do_grupo(conn, "g1")
    assert resultado == "https://discord.com/api/webhooks/x/y"


def test_webhook_do_grupo_nao_configurado():
    conn = FakeConn()
    conn.webhook_do_grupo_row = None
    resultado = db.webhook_do_grupo(conn, "g1")
    assert resultado is None


def test_ja_notificado_discord_true():
    conn = FakeConn()
    conn.ja_notificado_discord_row = (1,)
    assert db.ja_notificado_discord(conn, "m1", "g1") is True


def test_ja_notificado_discord_false():
    conn = FakeConn()
    conn.ja_notificado_discord_row = None
    assert db.ja_notificado_discord(conn, "m1", "g1") is False


def test_marcar_notificado_discord():
    conn = FakeConn()
    db.marcar_notificado_discord(conn, "m1", "g1")
    insert = next(c for c in conn.calls if c[0].startswith("insert into discord_notifications"))
    assert insert[1] == ("m1", "g1")
    assert conn.commits == 1


def test_resumo_da_partida_para_grupo_sem_membros_devolve_none():
    conn = FakeConn()
    conn.resumo_membros_rows = []
    resultado = db.resumo_da_partida_para_grupo(conn, "m1", "g1")
    assert resultado is None


def test_resumo_da_partida_para_grupo_vitoria_time_a():
    conn = FakeConn()
    conn.resumo_membros_rows = [
        ("111", "fulano", "A", 1.45),
        ("222", "ciclano", "A", 0.90),
    ]
    conn.resumo_match_row = ("de_mirage", 13, 9)
    resultado = db.resumo_da_partida_para_grupo(conn, "m1", "g1")
    assert resultado == {
        "map": "de_mirage",
        "score_grupo": 13,
        "score_rival": 9,
        "mvp_nick": "fulano",
        "mvp_rating": 1.45,
    }


def test_resumo_da_partida_para_grupo_derrota_time_b():
    conn = FakeConn()
    conn.resumo_membros_rows = [("111", "fulano", "B", 0.80)]
    conn.resumo_match_row = ("de_dust2", 13, 4)
    resultado = db.resumo_da_partida_para_grupo(conn, "m1", "g1")
    assert resultado["score_grupo"] == 4
    assert resultado["score_rival"] == 13


def test_resumo_da_partida_para_grupo_empate_de_time_usa_menor_steam_id():
    conn = FakeConn()
    # "222" tá no time B mas tem o menor steam_id64 entre os dois — desempate escolhe o time dele (B).
    conn.resumo_membros_rows = [("333", "fulano", "A", 1.0), ("222", "ciclano", "B", 1.0)]
    conn.resumo_match_row = ("de_inferno", 10, 16)
    resultado = db.resumo_da_partida_para_grupo(conn, "m1", "g1")
    assert resultado["score_grupo"] == 16  # time B


def test_resumo_da_partida_para_grupo_sem_rating_mvp_none():
    conn = FakeConn()
    conn.resumo_membros_rows = [("111", "fulano", "A", None)]
    conn.resumo_match_row = ("de_mirage", 13, 9)
    resultado = db.resumo_da_partida_para_grupo(conn, "m1", "g1")
    assert resultado["mvp_nick"] is None
    assert resultado["mvp_rating"] is None
```

- [ ] **Step 2: Estender `FakeCursor`/`FakeConn` pra rotear as queries novas**

Edite o método `fetchall` da classe `FakeCursor` em `test_storage_db.py`, adicionando
ANTES do `return []` final:

```python
        if "group_members gm" in self._last and "match_players mp" in self._last:
            return self.conn.grupos_da_partida_rows
        if self._last.startswith("select mp.steam_id64, mp.nick, mp.team, mp.rating"):
            return self.conn.resumo_membros_rows
```

Edite o método `fetchone`, adicionando ANTES do `return ["00000000-0000-0000-0000-000000000001"]` final:

```python
        if self._last.startswith("select discord_webhook_url from groups"):
            return self.conn.webhook_do_grupo_row
        if self._last.startswith("select 1 from discord_notifications"):
            return self.conn.ja_notificado_discord_row
        if self._last.startswith("select map, score_a, score_b from matches"):
            return self.conn.resumo_match_row
```

Edite `__init__` de `FakeConn`, adicionando estes atributos novos:

```python
        self.grupos_da_partida_rows = []
        self.webhook_do_grupo_row = None
        self.ja_notificado_discord_row = None
        self.resumo_membros_rows = []
        self.resumo_match_row = (None, None, None)
```

- [ ] **Step 3: Rodar os testes pra confirmar que falham**

```bash
cd coletor && python -m pytest tests/test_storage_db.py -k discord -v
```
Expected: `AttributeError: module 'coletor.db' has no attribute 'grupos_da_partida'` (ou similar, função não existe ainda).

- [ ] **Step 4: Implementar as funções em `db.py`**

Adicione ao final de `coletor/src/coletor/db.py`:

```python
def grupos_da_partida(conn, match_id):
    """Grupos com pelo menos 1 membro presente numa Partida — mesma regra de
    visibilidade por participação usada no servidor (site/server/src/matchVisibility.js):
    group_id = G é visível se algum steam_id64 de group_members(G) está em
    match_players da partida."""
    with conn.cursor() as cur:
        cur.execute(
            "select distinct gm.group_id from group_members gm "
            "join match_players mp on mp.steam_id64 = gm.steam_id64 "
            "where mp.match_id = %s",
            (match_id,),
        )
        return [row[0] for row in cur.fetchall()]


def webhook_do_grupo(conn, group_id):
    """URL do webhook do Discord configurada pelo admin do grupo, ou None se o grupo
    nunca configurou (caso normal — não é erro)."""
    with conn.cursor() as cur:
        cur.execute("select discord_webhook_url from groups where id = %s", (group_id,))
        row = cur.fetchone()
        return row[0] if row else None


def ja_notificado_discord(conn, match_id, group_id):
    """True se esse par (partida, grupo) já recebeu aviso no Discord — evita duplicar
    em reprocessamento."""
    with conn.cursor() as cur:
        cur.execute(
            "select 1 from discord_notifications where match_id = %s and group_id = %s",
            (match_id, group_id),
        )
        return cur.fetchone() is not None


def marcar_notificado_discord(conn, match_id, group_id):
    with conn.cursor() as cur:
        cur.execute(
            "insert into discord_notifications (match_id, group_id) values (%s, %s)",
            (match_id, group_id),
        )
    conn.commit()


def resumo_da_partida_para_grupo(conn, match_id, group_id):
    """Placar e MVP de uma Partida do ponto de vista de UM grupo específico.

    Time do grupo = time majoritário entre os membros do grupo presentes na partida;
    empate na contagem é resolvido pelo time do membro de MENOR steam_id64 (critério
    determinístico, documentado no design). MVP = maior `rating` entre os membros do
    grupo nessa partida; None se nenhum tiver rating (ex.: fonte stats-only sem parse
    completo). Devolve None se nenhum membro do grupo está na partida (não deveria
    acontecer — quem chama já filtrou por grupos_da_partida — mas fica seguro).
    """
    with conn.cursor() as cur:
        cur.execute(
            "select mp.steam_id64, mp.nick, mp.team, mp.rating "
            "from match_players mp "
            "join group_members gm on gm.steam_id64 = mp.steam_id64 and gm.group_id = %s "
            "where mp.match_id = %s",
            (group_id, match_id),
        )
        membros = cur.fetchall()
        if not membros:
            return None
        cur.execute(
            "select map, score_a, score_b from matches where id = %s", (match_id,)
        )
        mapa, score_a, score_b = cur.fetchone()

    contagem = {}
    for _, _, team, _ in membros:
        contagem[team] = contagem.get(team, 0) + 1
    maior = max(contagem.values())
    empatados = [t for t, n in contagem.items() if n == maior]
    if len(empatados) == 1:
        time_grupo = empatados[0]
    else:
        time_grupo = sorted(membros, key=lambda m: m[0])[0][2]

    score_grupo = score_a if time_grupo == "A" else score_b
    score_rival = score_b if time_grupo == "A" else score_a

    candidatos_mvp = [(nick, rating) for _, nick, _, rating in membros if rating is not None]
    mvp_nick, mvp_rating = (
        max(candidatos_mvp, key=lambda p: p[1]) if candidatos_mvp else (None, None)
    )

    return {
        "map": mapa,
        "score_grupo": score_grupo,
        "score_rival": score_rival,
        "mvp_nick": mvp_nick,
        "mvp_rating": mvp_rating,
    }
```

- [ ] **Step 5: Rodar os testes pra confirmar que passam**

```bash
cd coletor && python -m pytest tests/test_storage_db.py -k discord -v
```
Expected: `10 passed`.

- [ ] **Step 6: Rodar a suíte inteira do Coletor (garantir que não quebrou nada)**

```bash
cd coletor && python -m pytest -q
```
Expected: todos os testes existentes + os 10 novos passando, `0 failed`.

- [ ] **Step 7: Commit**

```bash
git add coletor/src/coletor/db.py coletor/tests/test_storage_db.py
git commit -m "feat: db.py - funcoes de grupo/webhook/resumo pro aviso do Discord"
```

---

### Task 3: Coletor — módulo `discord_notify.py`

**Files:**
- Create: `coletor/src/coletor/discord_notify.py`
- Test: `coletor/tests/test_discord_notify.py`

**Interfaces:**
- Consumes: dict `resumo` no formato devolvido por `db.resumo_da_partida_para_grupo` (Task 2).
- Produces: `montar_embed(resumo, match_id, app_url) -> dict` (payload JSON pro Discord Webhook API); `enviar_webhook(webhook_url, payload, http_post=...) -> None` (levanta exceção em falha; `http_post` injetável pra teste, mesmo padrão de `faceit.py`).

- [ ] **Step 1: Escrever os testes**

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import discord_notify


def _resumo(**overrides):
    base = {
        "map": "de_mirage", "score_grupo": 13, "score_rival": 9,
        "mvp_nick": "fulano", "mvp_rating": 1.45,
    }
    base.update(overrides)
    return base


def test_montar_embed_vitoria_e_verde():
    payload = discord_notify.montar_embed(_resumo(), "m1", "https://resenha-phi.vercel.app")
    embed = payload["embeds"][0]
    assert embed["title"] == "Vitória 13×9 no de_mirage"
    assert embed["color"] == discord_notify.COR_VITORIA
    assert embed["url"] == "https://resenha-phi.vercel.app/partidas/m1"
    assert "fulano" in embed["description"]
    assert "1.45" in embed["description"]
    assert embed["footer"] == {"text": "Resenha"}


def test_montar_embed_derrota_e_vermelho():
    payload = discord_notify.montar_embed(
        _resumo(score_grupo=5, score_rival=13), "m1", "https://x.com",
    )
    embed = payload["embeds"][0]
    assert embed["title"] == "Derrota 5×13 no de_mirage"
    assert embed["color"] == discord_notify.COR_DERROTA


def test_montar_embed_empate_e_cinza():
    payload = discord_notify.montar_embed(
        _resumo(score_grupo=12, score_rival=12), "m1", "https://x.com",
    )
    embed = payload["embeds"][0]
    assert embed["title"] == "Empate 12×12 no de_mirage"
    assert embed["color"] == discord_notify.COR_EMPATE


def test_montar_embed_sem_mvp_omite_descricao():
    payload = discord_notify.montar_embed(
        _resumo(mvp_nick=None, mvp_rating=None), "m1", "https://x.com",
    )
    embed = payload["embeds"][0]
    assert "description" not in embed


def test_enviar_webhook_chama_http_post_com_url_e_payload():
    chamadas = []
    discord_notify.enviar_webhook(
        "https://discord.com/api/webhooks/x/y",
        {"embeds": []},
        http_post=lambda url, payload: chamadas.append((url, payload)),
    )
    assert chamadas == [("https://discord.com/api/webhooks/x/y", {"embeds": []})]


def test_enviar_webhook_propaga_excecao_do_http_post():
    def _explode(url, payload):
        raise RuntimeError("Discord respondeu 404")

    import pytest
    with pytest.raises(RuntimeError, match="404"):
        discord_notify.enviar_webhook("https://x", {}, http_post=_explode)
```

- [ ] **Step 2: Rodar pra confirmar que falham**

```bash
cd coletor && python -m pytest tests/test_discord_notify.py -v
```
Expected: `ModuleNotFoundError: No module named 'coletor.discord_notify'`.

- [ ] **Step 3: Implementar `discord_notify.py`**

```python
"""Aviso automático no Discord quando o Coletor processa uma Partida nova (item 6 do
ROADMAP.md). Um embed por grupo com membro na partida, placar/MVP do ponto de vista
daquele grupo (dados vindos de db.resumo_da_partida_para_grupo). HTTP sempre injetável
(http_post=...) pra teste, mesmo padrão de faceit.py.
"""

import json
import urllib.request

COR_VITORIA = 5763719   # verde (Discord embed color, decimal RGB)
COR_DERROTA = 15548997  # vermelho
COR_EMPATE = 9807270    # cinza


def montar_embed(resumo, match_id, app_url):
    """resumo: dict de db.resumo_da_partida_para_grupo. app_url: base do site, sem
    barra final (ex.: "https://resenha-phi.vercel.app")."""
    score_grupo = resumo["score_grupo"]
    score_rival = resumo["score_rival"]

    if score_grupo > score_rival:
        resultado, cor = "Vitória", COR_VITORIA
    elif score_grupo < score_rival:
        resultado, cor = "Derrota", COR_DERROTA
    else:
        resultado, cor = "Empate", COR_EMPATE

    embed = {
        "title": f"{resultado} {score_grupo}×{score_rival} no {resumo['map']}",
        "color": cor,
        "url": f"{app_url}/partidas/{match_id}",
        "footer": {"text": "Resenha"},
    }
    if resumo["mvp_nick"] is not None:
        embed["description"] = (
            f"MVP do grupo: **{resumo['mvp_nick']}** ({resumo['mvp_rating']:.2f} rating)"
        )
    return {"embeds": [embed]}


def _http_post_json(url, payload, timeout=15):
    dados = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=dados, headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status


def enviar_webhook(webhook_url, payload, http_post=_http_post_json):
    """Manda o embed pro Discord. Propaga qualquer exceção de rede/HTTP (inclusive
    HTTPError da urllib pra status != 2xx) — quem chama decide se ignora (main.py:
    loga e segue, nunca derruba o fetch)."""
    http_post(webhook_url, payload)
```

- [ ] **Step 4: Rodar pra confirmar que passam**

```bash
cd coletor && python -m pytest tests/test_discord_notify.py -v
```
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add coletor/src/coletor/discord_notify.py coletor/tests/test_discord_notify.py
git commit -m "feat: discord_notify.py - monta embed e envia webhook do Discord"
```

---

### Task 4: Coletor — integrar no `cmd_fetch`

**Files:**
- Modify: `coletor/src/coletor/main.py`
- Modify: `coletor/src/coletor/config.py`
- Test: `coletor/tests/test_main.py`

**Interfaces:**
- Consumes: `dbmod.grupos_da_partida`, `dbmod.webhook_do_grupo`, `dbmod.ja_notificado_discord`, `dbmod.resumo_da_partida_para_grupo`, `dbmod.marcar_notificado_discord` (Task 2); `discord_notify.montar_embed`, `discord_notify.enviar_webhook` (Task 3).
- Produces: `Config.app_url` (novo atributo); `_notificar_discord_grupos(config, conn, match_id)` (função privada de `main.py`, chamada dentro de `cmd_fetch` após cada ingest bem-sucedido).

- [ ] **Step 1: Adicionar `app_url` ao `Config`**

Em `coletor/src/coletor/config.py`, dentro de `__init__`, logo após `self.faceit_api_key`:

```python
        self.faceit_api_key = env.get("FACEIT_API_KEY")
        self.app_url = env.get("APP_URL")
```

- [ ] **Step 2: Escrever os testes de `_notificar_discord_grupos`**

Adicione a `coletor/tests/test_main.py` (siga o padrão `monkeypatch` já usado no
arquivo, ex.: `test_cmd_avatares_nao_derruba_em_erro_da_steam_api`):

```python
def test_notificar_discord_sem_app_url_nao_faz_nada(monkeypatch):
    config = main.Config(env={})
    chamado = []
    monkeypatch.setattr(main.dbmod, "grupos_da_partida", lambda *a, **k: chamado.append(1))
    main._notificar_discord_grupos(config, conn=None, match_id="m1")
    assert chamado == []


def test_notificar_discord_pula_grupo_sem_webhook(monkeypatch):
    config = main.Config(env={"APP_URL": "https://x.com"})
    monkeypatch.setattr(main.dbmod, "grupos_da_partida", lambda conn, mid: ["g1"])
    monkeypatch.setattr(main.dbmod, "ja_notificado_discord", lambda conn, mid, gid: False)
    monkeypatch.setattr(main.dbmod, "webhook_do_grupo", lambda conn, gid: None)
    enviados = []
    monkeypatch.setattr(main.discord_notify, "enviar_webhook", lambda *a, **k: enviados.append(1))
    main._notificar_discord_grupos(config, conn=object(), match_id="m1")
    assert enviados == []


def test_notificar_discord_pula_grupo_ja_notificado(monkeypatch):
    config = main.Config(env={"APP_URL": "https://x.com"})
    monkeypatch.setattr(main.dbmod, "grupos_da_partida", lambda conn, mid: ["g1"])
    monkeypatch.setattr(main.dbmod, "ja_notificado_discord", lambda conn, mid, gid: True)
    enviados = []
    monkeypatch.setattr(main.discord_notify, "enviar_webhook", lambda *a, **k: enviados.append(1))
    main._notificar_discord_grupos(config, conn=object(), match_id="m1")
    assert enviados == []


def test_notificar_discord_envia_e_marca_notificado(monkeypatch):
    config = main.Config(env={"APP_URL": "https://x.com"})
    monkeypatch.setattr(main.dbmod, "grupos_da_partida", lambda conn, mid: ["g1"])
    monkeypatch.setattr(main.dbmod, "ja_notificado_discord", lambda conn, mid, gid: False)
    monkeypatch.setattr(main.dbmod, "webhook_do_grupo", lambda conn, gid: "https://discord.com/wh")
    resumo = {"map": "de_mirage", "score_grupo": 13, "score_rival": 9, "mvp_nick": "f", "mvp_rating": 1.0}
    monkeypatch.setattr(main.dbmod, "resumo_da_partida_para_grupo", lambda conn, mid, gid: resumo)
    enviados = []
    monkeypatch.setattr(main.discord_notify, "montar_embed", lambda r, mid, url: {"payload": True})
    monkeypatch.setattr(main.discord_notify, "enviar_webhook", lambda url, payload: enviados.append((url, payload)))
    marcados = []
    monkeypatch.setattr(main.dbmod, "marcar_notificado_discord", lambda conn, mid, gid: marcados.append((mid, gid)))
    main._notificar_discord_grupos(config, conn=object(), match_id="m1")
    assert enviados == [("https://discord.com/wh", {"payload": True})]
    assert marcados == [("m1", "g1")]


def test_notificar_discord_nao_derruba_em_erro_de_envio(monkeypatch, capsys):
    config = main.Config(env={"APP_URL": "https://x.com"})
    monkeypatch.setattr(main.dbmod, "grupos_da_partida", lambda conn, mid: ["g1"])
    monkeypatch.setattr(main.dbmod, "ja_notificado_discord", lambda conn, mid, gid: False)
    monkeypatch.setattr(main.dbmod, "webhook_do_grupo", lambda conn, gid: "https://discord.com/wh")
    resumo = {"map": "de_mirage", "score_grupo": 13, "score_rival": 9, "mvp_nick": None, "mvp_rating": None}
    monkeypatch.setattr(main.dbmod, "resumo_da_partida_para_grupo", lambda conn, mid, gid: resumo)
    monkeypatch.setattr(main.discord_notify, "montar_embed", lambda r, mid, url: {})

    def _explode(url, payload):
        raise RuntimeError("timeout")

    monkeypatch.setattr(main.discord_notify, "enviar_webhook", _explode)
    marcados = []
    monkeypatch.setattr(main.dbmod, "marcar_notificado_discord", lambda conn, mid, gid: marcados.append(1))
    main._notificar_discord_grupos(config, conn=object(), match_id="m1")  # não deve lançar
    assert marcados == []
    assert "timeout" in capsys.readouterr().out


def test_notificar_discord_pula_grupo_sem_resumo(monkeypatch):
    config = main.Config(env={"APP_URL": "https://x.com"})
    monkeypatch.setattr(main.dbmod, "grupos_da_partida", lambda conn, mid: ["g1"])
    monkeypatch.setattr(main.dbmod, "ja_notificado_discord", lambda conn, mid, gid: False)
    monkeypatch.setattr(main.dbmod, "webhook_do_grupo", lambda conn, gid: "https://discord.com/wh")
    monkeypatch.setattr(main.dbmod, "resumo_da_partida_para_grupo", lambda conn, mid, gid: None)
    enviados = []
    monkeypatch.setattr(main.discord_notify, "enviar_webhook", lambda *a, **k: enviados.append(1))
    main._notificar_discord_grupos(config, conn=object(), match_id="m1")
    assert enviados == []
```

- [ ] **Step 3: Rodar pra confirmar que falham**

```bash
cd coletor && python -m pytest tests/test_main.py -k notificar_discord -v
```
Expected: `AttributeError: module 'coletor.main' has no attribute '_notificar_discord_grupos'`.

- [ ] **Step 4: Importar `discord_notify` e implementar `_notificar_discord_grupos` em `main.py`**

Em `coletor/src/coletor/main.py`, adicione ao bloco de imports (perto de `from . import faceit`):

```python
from . import discord_notify
```

Adicione a função nova, logo antes de `def cmd_fetch(...)`:

```python
def _notificar_discord_grupos(config, conn, match_id):
    """Avisa no Discord cada grupo com membro na Partida recém-ingerida. Best-effort:
    grupo sem webhook configurado é pulado em silêncio; falha ao enviar é logada e
    NUNCA derruba o fetch (a Partida já foi ingerida com sucesso, isso é só um aviso)."""
    if not config.app_url:
        return
    for group_id in dbmod.grupos_da_partida(conn, match_id):
        if dbmod.ja_notificado_discord(conn, match_id, group_id):
            continue
        webhook_url = dbmod.webhook_do_grupo(conn, group_id)
        if not webhook_url:
            continue
        try:
            resumo = dbmod.resumo_da_partida_para_grupo(conn, match_id, group_id)
            if resumo is None:
                continue
            payload = discord_notify.montar_embed(resumo, match_id, config.app_url)
            discord_notify.enviar_webhook(webhook_url, payload)
            dbmod.marcar_notificado_discord(conn, match_id, group_id)
        except Exception as e:  # noqa: BLE001
            print(f"  discord: falha ao notificar grupo {group_id} da partida {match_id}: {e}")
```

- [ ] **Step 5: Chamar a função dentro de `cmd_fetch`**

Em `cmd_fetch`, localize (já existente, dentro do `try` do loop principal):

```python
                print(f"  {code}: ingerida {mid} (played_at={played_at})")
                total += 1
```

Substitua por:

```python
                print(f"  {code}: ingerida {mid} (played_at={played_at})")
                total += 1
                _notificar_discord_grupos(config, conn, mid)
```

- [ ] **Step 6: Rodar os testes novos**

```bash
cd coletor && python -m pytest tests/test_main.py -k notificar_discord -v
```
Expected: `6 passed`.

- [ ] **Step 7: Rodar a suíte inteira do Coletor**

```bash
cd coletor && python -m pytest -q
```
Expected: `0 failed`.

- [ ] **Step 8: Commit**

```bash
git add coletor/src/coletor/main.py coletor/src/coletor/config.py coletor/tests/test_main.py
git commit -m "feat: integra aviso do Discord no cmd_fetch (best-effort, por grupo)"
```

---

### Task 5: GitHub Actions — Secret `APP_URL` no step de fetch

**Files:**
- Modify: `.github/workflows/coletor.yml`

**Interfaces:**
- Consumes: `Config.app_url` (Task 4) — lido de `os.environ["APP_URL"]`.

- [ ] **Step 1: Adicionar a env var ao step "Baixar e ingerir Partidas pendentes"**

Em `.github/workflows/coletor.yml`, localize o step (linha ~74-86):

```yaml
      - name: Baixar e ingerir Partidas pendentes
        working-directory: coletor
        env:
          PYTHONPATH: src
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          STEAM_API_KEY: ${{ secrets.STEAM_API_KEY }}
          STEAM_BOT_USER: ${{ secrets.STEAM_BOT_USER }}
          STEAM_BOT_PASS: ${{ secrets.STEAM_BOT_PASS }}
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
        run: python -m coletor.main fetch
```

Adicione `APP_URL: ${{ secrets.APP_URL }}` na lista de `env`, junto dos demais:

```yaml
      - name: Baixar e ingerir Partidas pendentes
        working-directory: coletor
        env:
          PYTHONPATH: src
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          STEAM_API_KEY: ${{ secrets.STEAM_API_KEY }}
          STEAM_BOT_USER: ${{ secrets.STEAM_BOT_USER }}
          STEAM_BOT_PASS: ${{ secrets.STEAM_BOT_PASS }}
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
          APP_URL: ${{ secrets.APP_URL }}
        run: python -m coletor.main fetch
```

- [ ] **Step 2: Confirmar que o Secret `APP_URL` já existe no repositório**

```bash
gh secret list --repo bronze-ff/resenhacs | grep APP_URL
```
Se não aparecer nada, criar (valor = domínio do client na Vercel, ex.
`https://resenha-phi.vercel.app`, **sem barra final**):
```bash
gh secret set APP_URL --repo bronze-ff/resenhacs --body "https://resenha-phi.vercel.app"
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/coletor.yml
git commit -m "chore: adiciona APP_URL ao step de fetch (link do aviso do Discord)"
```

---

### Task 6: Servidor — endpoint de configuração do webhook

**Files:**
- Modify: `site/server/src/routes/groups.js`
- Test: `site/server/test/groups.test.js`

**Interfaces:**
- Consumes: `group_members` (checagem de `role = 'admin'`, mesmo padrão de `POST /:id/convites`).
- Produces: `PUT /api/groups/:id/discord-webhook` — body `{ url: string | null }`, resposta `{ ok: true }`.

- [ ] **Step 1: Escrever os testes**

Adicione a `site/server/test/groups.test.js`, dentro de um novo `describe`:

```js
describe('PUT /api/groups/:id/discord-webhook', () => {
  it('não-admin: 403', async () => {
    const { app } = appWith([
      ['select role from group_members', [{ role: 'membro' }]],
    ])
    const res = await request(app)
      .put('/api/groups/g1/discord-webhook')
      .set('Cookie', cookieA)
      .send({ url: 'https://discord.com/api/webhooks/1/abc' })
    expect(res.status).toBe(403)
  })

  it('URL inválida: 400', async () => {
    const { app } = appWith([
      ['select role from group_members', [{ role: 'admin' }]],
    ])
    const res = await request(app)
      .put('/api/groups/g1/discord-webhook')
      .set('Cookie', cookieA)
      .send({ url: 'https://evil.com/not-discord' })
    expect(res.status).toBe(400)
  })

  it('admin com URL válida: salva e devolve ok', async () => {
    const { app, db } = appWith([
      ['select role from group_members', [{ role: 'admin' }]],
      ['update groups set discord_webhook_url', []],
    ])
    const res = await request(app)
      .put('/api/groups/g1/discord-webhook')
      .set('Cookie', cookieA)
      .send({ url: 'https://discord.com/api/webhooks/123/abcDEF' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    const update = db.query.mock.calls.find((c) => c[0].includes('update groups set discord_webhook_url'))
    expect(update[1]).toEqual(['https://discord.com/api/webhooks/123/abcDEF', 'g1'])
  })

  it('admin com url null: remove o webhook', async () => {
    const { app, db } = appWith([
      ['select role from group_members', [{ role: 'admin' }]],
      ['update groups set discord_webhook_url', []],
    ])
    const res = await request(app)
      .put('/api/groups/g1/discord-webhook')
      .set('Cookie', cookieA)
      .send({ url: null })
    expect(res.status).toBe(200)
    const update = db.query.mock.calls.find((c) => c[0].includes('update groups set discord_webhook_url'))
    expect(update[1]).toEqual([null, 'g1'])
  })
})
```

- [ ] **Step 2: Rodar pra confirmar que falham**

```bash
cd site/server && npx vitest run test/groups.test.js -t "discord-webhook"
```
Expected: 4 failures (`404` em vez de 403/400/200 — rota não existe ainda).

- [ ] **Step 3: Implementar a rota**

Em `site/server/src/routes/groups.js`, adicione dentro de `createGroupsRouter`, logo
após o `router.post('/:id/convites', ...)` existente (antes do `return router`):

```js
  router.put('/:id/discord-webhook', async (req, res) => {
    const { rows: membro } = await db.query(
      'select role from group_members where group_id = $1 and steam_id64 = $2',
      [req.params.id, req.player.steamId],
    )
    if (membro.length === 0 || membro[0].role !== 'admin') {
      return res.status(403).json({ erro: 'Só o admin do grupo pode configurar o webhook' })
    }
    const url = req.body?.url
    if (url !== null && url !== undefined) {
      if (typeof url !== 'string' || !/^https:\/\/discord\.com\/api\/webhooks\//.test(url)) {
        return res.status(400).json({ erro: 'URL de webhook do Discord inválida' })
      }
    }
    await db.query('update groups set discord_webhook_url = $1 where id = $2', [
      url ?? null,
      req.params.id,
    ])
    res.json({ ok: true })
  })
```

- [ ] **Step 4: Rodar os testes**

```bash
cd site/server && npx vitest run test/groups.test.js -t "discord-webhook"
```
Expected: `4 passed`.

- [ ] **Step 5: Rodar a suíte inteira do servidor**

```bash
cd site/server && npx vitest run
```
Expected: `0 failed`.

- [ ] **Step 6: Commit**

```bash
git add site/server/src/routes/groups.js site/server/test/groups.test.js
git commit -m "feat: endpoint PUT /api/groups/:id/discord-webhook (config por admin)"
```

---

### Task 7: Client — configurar o webhook em "Minha conta"

**Files:**
- Modify: `site/client/src/pages/Perfil.jsx`

**Interfaces:**
- Consumes: `PUT /api/groups/:id/discord-webhook` (Task 6); `jogador.grupoAtivoId`, `jogador.souAdminDoGrupo` (já existentes, usados na seção de convite).

Sem teste automatizado dedicado — a página `Perfil.jsx` não tem suíte de testes hoje
(nenhum `Perfil.test.jsx` no repositório); verificação é manual, via preview do
navegador (Step 4).

- [ ] **Step 1: Adicionar estado novo**

Em `site/client/src/pages/Perfil.jsx`, no topo do componente `Perfil`, logo após os
estados existentes de convite (`linkConvite`, `erroConvite`, `gerandoConvite`,
`conviteCopiado`):

```jsx
  const [discordWebhook, setDiscordWebhook] = useState('')
  const [salvandoDiscord, setSalvandoDiscord] = useState(false)
  const [discordSalvo, setDiscordSalvo] = useState(false)
  const [erroDiscord, setErroDiscord] = useState(null)
```

- [ ] **Step 2: Adicionar a função de salvar**

Logo após a função `copiarConvite` existente:

```jsx
  async function salvarWebhookDiscord() {
    setSalvandoDiscord(true)
    setErroDiscord(null)
    setDiscordSalvo(false)
    const res = await fetch(`/api/groups/${jogador.grupoAtivoId}/discord-webhook`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: discordWebhook.trim() || null }),
    })
    const body = await res.json().catch(() => ({}))
    setSalvandoDiscord(false)
    if (!res.ok) return setErroDiscord(body.erro ?? 'Erro ao salvar webhook')
    setDiscordSalvo(true)
    setTimeout(() => setDiscordSalvo(false), 2000)
  }
```

- [ ] **Step 3: Adicionar a seção na UI**

Dentro do bloco `{jogador?.souAdminDoGrupo && (...)}`, logo após a `</section>` que
fecha a seção "Convidar amigos" existente (antes do `)}` que fecha o bloco condicional):

```jsx
      <section className="space-y-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">
          Aviso no Discord
        </h3>
        <Card className="p-4 sm:p-5">
          <p className="font-mono text-xs text-texto-fraco">
            Cole o link do webhook do canal do grupo — toda partida nova processada
            posta um resumo automático lá (placar, MVP, link pra abrir no site).
          </p>
          <input
            value={discordWebhook}
            onChange={(e) => setDiscordWebhook(e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            className="panel-cut-sm mt-3 min-h-10 w-full border border-borda bg-superficie px-3 py-2 font-mono text-xs lg:min-h-0"
          />
          <button
            type="button"
            onClick={salvarWebhookDiscord}
            disabled={salvandoDiscord}
            className="panel-cut-sm mt-3 min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo disabled:opacity-40 lg:min-h-0 lg:w-auto"
          >
            {salvandoDiscord ? 'Salvando…' : discordSalvo ? 'Salvo!' : 'Salvar'}
          </button>
          {erroDiscord && <p className="mt-3 font-mono text-sm text-perigo">{erroDiscord}</p>}
        </Card>
      </section>
```

- [ ] **Step 4: Verificar no preview do navegador**

Suba o dev server (`npm run dev` em `site/server` e `site/client`, ou use o preview do
Claude Code), logue como admin de um grupo, vá em "Minha conta", confirme que a nova
seção "Aviso no Discord" aparece abaixo de "Convidar amigos", cole um link de teste
(`https://discord.com/api/webhooks/1/teste`), clique "Salvar" e confirme que aparece
"Salvo!" e não há erro no console do navegador. Recarregue a página — o campo fica
vazio de novo (não busca o valor salvo ao carregar, é aceitável no escopo — só grava,
não faz GET; ver "Possível melhoria futura" abaixo).

- [ ] **Step 5: Rodar a suíte do client (garantir que não quebrou nada)**

```bash
cd site/client && npm test
```
Expected: `0 failed`.

- [ ] **Step 6: Commit**

```bash
git add site/client/src/pages/Perfil.jsx
git commit -m "feat: campo de webhook do Discord na aba Minha conta (admin)"
```

---

### Task 8: Deploy

**Files:** nenhum (só execução de comandos e verificação em produção).

- [ ] **Step 1: Confirmar que a Task 1 já foi aplicada em produção**

Se a migration `0033_discord_webhook.sql` ainda não foi rodada no Supabase de
produção (Task 1, Step 2), rode agora antes de fazer deploy do código — o server e o
Coletor em produção vão referenciar `groups.discord_webhook_url` e
`discord_notifications` assim que o deploy terminar.

- [ ] **Step 2: Confirmar o Secret `APP_URL` no GitHub (Task 5, Step 2)**

```bash
gh secret list --repo bronze-ff/resenhacs | grep APP_URL
```

- [ ] **Step 3: Push pro `main`**

Todos os commits das Tasks 1-7 já devem estar no `main` (cada task termina com commit
+ push, seguindo o padrão do resto do projeto). Confirme:

```bash
git status
git log --oneline -10
```

- [ ] **Step 4: Verificar o deploy da Vercel**

Confirme nos dashboards da Vercel (`resenha` e `resenhacs`) que o deploy do commit
mais recente terminou com sucesso, sem erro de build.

- [ ] **Step 5: Configurar o webhook de um grupo de teste e validar ponta a ponta**

1. No Discord, crie um canal de teste e gere um webhook (Configurações do Canal →
   Integrações → Webhooks → Novo Webhook → Copiar URL).
2. No Resenha, como admin de um grupo, cole essa URL em "Minha conta" → "Aviso no
   Discord" → Salvar.
3. Dispare o Coletor manualmente:
   ```bash
   gh workflow run coletor.yml --repo bronze-ff/resenhacs
   ```
4. Se houver alguma partida pendente pra esse grupo, aguarde o run terminar (~5-25min
   dependendo do tamanho da fila) e confirme que a mensagem chegou no canal do
   Discord — embed com placar, MVP e link clicável que abre a Partida no Resenha.
5. Se não houver partida pendente, force uma reprocessando uma partida existente do
   grupo de teste (`python -m coletor.main reprocess --match-id <id>` local, ou aguarde
   a próxima partida real ser jogada).

**Possível melhoria futura (fora de escopo aqui):** o campo de webhook em "Minha
conta" não busca o valor já salvo ao carregar a página (só grava) — se algum dia isso
incomodar, adicionar um `GET /api/groups/:id` que devolva `discordWebhookUrl` e
popular o campo no `useEffect` de carregamento do Perfil.

---

## Self-Review

**Cobertura da spec:** todos os pontos de `docs/superpowers/specs/2026-07-19-webhook-discord-design.md`
estão cobertos — coluna `discord_webhook_url` e tabela `discord_notifications` (Task 1),
descoberta de grupos por participação + placar/MVP por grupo (Task 2), formato do
embed com cores por resultado (Task 3), disparo em `cmd_fetch` best-effort com
idempotência (Task 4), Secret `APP_URL` (Task 5), endpoint admin-only com validação de
URL (Task 6), UI de configuração (Task 7), verificação ponta a ponta (Task 8).

**Placeholders:** nenhum encontrado — todo código de todo step é completo e executável.

**Consistência de tipos:** `db.resumo_da_partida_para_grupo` devolve as chaves
`map`/`score_grupo`/`score_rival`/`mvp_nick`/`mvp_rating` (Task 2) e
`discord_notify.montar_embed` (Task 3) e os testes de `main.py` (Task 4) usam
exatamente essas mesmas chaves — conferido.

**Escopo:** cada task produz uma entrega testável isoladamente (Tasks 1-7 têm
teste automatizado próprio, exceto Task 7 que é só UI sem suíte de página no
projeto — verificação manual documentada no Step 4). Task 8 é só operação de deploy,
sem código novo.

## Execução

**Plano completo e salvo em `docs/superpowers/plans/2026-07-19-webhook-discord.md`.**
Duas opções de execução:

**1. Subagent-Driven (recomendado)** — dispatch de um subagent por task, review entre
tasks, iteração rápida.

**2. Execução Inline** — executo as tasks nesta sessão, em lote, com checkpoints de
revisão.

Qual prefere?
