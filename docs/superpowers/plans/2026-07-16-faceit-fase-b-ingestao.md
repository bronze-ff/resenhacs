# FACEIT Fase B — Ingestão automática + ELO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda partida 5v5 de CS2 na FACEIT de um membro vinculado entra sozinha no Resenha
(pipeline completo quando a demo existe, stats básicos quando não), com ELO FACEIT no perfil e
no placar — espelhando o que o Premier já faz.

**Architecture:** Fila `faceit_pendentes` (mesmo padrão da fila Pro/uploads): um step novo do
cron de 30 min descobre partidas novas via Data API v4 (`/players/{id}/history`), enfileira, e
processa até 10 por rodada — baixa a demo (`.dem.gz` via Downloads API), roda `ingest_demo`
com `source='faceit'`, com fallback stats-only da API quando a demo não existe mais. ELO por
snapshot: a cada rodada grava o ELO atual de cada vinculado e carimba before/after na partida
nova mais recente.

**Tech Stack:** Python stdlib (`urllib`, `gzip` — o Coletor NÃO usa requests), psycopg,
Postgres/Supabase, Express, React. HTTP sempre injetável (`http_get_json=...`) igual
`steam_api.py`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-16-faceit-fase-b-ingestao-design.md`.
- Toda query nova em `db.py` mantém `sql.count("%s") == len(params)` — o teste genérico
  `test_todas_as_queries_de_store_parsed_tem_placeholders_e_params_alinhados` cobre as de
  `store_parsed`; as novas (fila/elo) ganham testes próprios com FakeConn.
- Só entra partida **5v5** (`teams_size == 5` no item do histórico).
- Processa no máximo **10 itens por rodada**; até **3 tentativas** por item (depois `failed`).
- Partida nunca "some" por demo indisponível — fallback stats-only.
- Dedupe primário por `matches.faceit_match_id` (unique); fingerprint do `store_parsed` continua
  como segunda linha de defesa.
- ELO: snapshot — `faceit_elo_before/after` só na partida nova mais recente do membro desde o
  snapshot anterior; backfill (histórico) fica nulo.
- UI: Regra do Sinal Duplo (delta = seta + cor); elemento não aparece quando o dado não existe;
  `panel-cut-sm`, nunca border-radius.
- Endpoints REAIS (confirmados no swagger oficial `open.faceit.com/data/v4/docs/swagger.json`):
  - `GET https://open.faceit.com/data/v4/players/{player_id}/history?game=cs2&offset=N&limit=100`
    → `{items: [{match_id, teams_size, finished_at (epoch s), status, ...}], ...}`
  - `GET https://open.faceit.com/data/v4/matches/{match_id}` → `{teams: {faction1: {name, roster:
    [{game_player_id (steam_id64), player_id (faceit), nickname, game_skill_level}]}, faction2:
    {...}}, results: {winner: 'faction1'|'faction2', score: {faction1: int, faction2: int}},
    demo_url: [string], finished_at, voting, status}`
  - `GET https://open.faceit.com/data/v4/matches/{match_id}/stats` → `{rounds: [{round_stats:
    {'Map': 'de_mirage', 'Score': '13 / 7', 'Rounds': '20', 'Winner': team_id}, teams: [{team_id,
    players: [{player_id, nickname, player_stats: {'Kills': '20', 'Deaths': '15', 'Assists': '4',
    'Headshots': '9', 'MVPs': '3', ...}}]}]}]}` — valores de player_stats vêm como STRING.
  - `GET https://open.faceit.com/data/v4/players/{player_id}` → `{games: {cs2: {faceit_elo,
    skill_level}}, ...}`
  - Downloads API: `POST https://open.faceit.com/download/v2/demos/download` com JSON
    `{"resource_url": <demo_url[0]>}` (mesmo header Bearer) → resposta com a URL assinada em
    `payload.download_url` (aceitar também `download_url` na raiz — parsing tolerante; se
    nenhum dos dois existir, levantar exceção com as chaves recebidas → cai no fallback
    stats-only). GET simples (sem auth) na URL assinada baixa o `.dem.gz`.
- Auth das chamadas Data/Download: header `Authorization: Bearer {FACEIT_API_KEY}`.

## File Structure

- Create: `supabase/migrations/0029_faceit_fase_b.sql` — colunas + tabela da fila.
- Create: `coletor/src/coletor/faceit.py` — cliente da API + funções puras (histórico 5v5,
  parsed stats-only, escolha da partida pro ELO, download/gunzip).
- Modify: `coletor/src/coletor/config.py` — `faceit_api_key`.
- Modify: `coletor/src/coletor/db.py` — helpers da fila + ELO (funções novas no fim do arquivo).
- Modify: `coletor/src/coletor/main.py` — `cmd_sincronizar_faceit` + registro do subcomando.
- Modify: `.github/workflows/coletor.yml` — step novo.
- Create: `coletor/tests/test_faceit.py` — funções puras do cliente.
- Modify: `coletor/tests/test_storage_db.py` — helpers novos de db.
- Modify: `coletor/tests/test_main.py` — orquestração do cmd.
- Modify: `site/server/src/routes/profile.js` + `site/server/src/routes/matches.js` + testes.
- Create: `site/client/src/components/ui/FaceitEloBadge.jsx`; Modify: `index.js`,
  `JogadorPerfil.jsx`, `Partida.jsx`, `src/test/ui.test.jsx`.

---

### Task 1: Migration — fila + colunas de ELO

**Files:**
- Create: `supabase/migrations/0029_faceit_fase_b.sql`

**Interfaces:**
- Produces: tabela `faceit_pendentes`; `matches.faceit_match_id` (unique);
  `players.faceit_elo/faceit_skill_level/faceit_elo_atualizado_em`;
  `match_players.faceit_elo_before/faceit_elo_after`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Fila de partidas FACEIT descobertas e ainda não processadas (mesmo papel da
-- uploads_pendentes pros uploads manuais). Linhas 'done' ficam pra sempre: são o
-- marcador de "esse membro já teve a primeira sincronização" e a defesa contra
-- re-enfileirar.
create table faceit_pendentes (
  faceit_match_id text primary key,
  steam_id64 text not null,
  group_id uuid not null,
  status text not null default 'pending', -- pending | done | failed
  tentativas integer not null default 0,
  erro text,
  created_at timestamptz not null default now()
);
create index idx_faceit_pendentes_status on faceit_pendentes(status);

alter table matches add column faceit_match_id text;
create unique index idx_matches_faceit_match_id on matches(faceit_match_id)
  where faceit_match_id is not null;

alter table players add column faceit_elo integer;
alter table players add column faceit_skill_level integer;
alter table players add column faceit_elo_atualizado_em timestamptz;

alter table match_players add column faceit_elo_before integer;
alter table match_players add column faceit_elo_after integer;
```

- [ ] **Step 2: Aplicar no Supabase de produção**

Confirmação explícita do usuário nomeando `0029_faceit_fase_b` antes de `apply_migration` no
projeto `hrpgbrfqxqjxpsjeymec` (padrão do projeto). Depois conferir com `execute_sql`
(`information_schema.columns`) que as colunas existem.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0029_faceit_fase_b.sql
git commit -m "feat: migration da fase B FACEIT (fila, faceit_match_id, colunas de ELO)"
```

---

### Task 2: `faceit.py` — cliente da API + funções puras

**Files:**
- Create: `coletor/src/coletor/faceit.py`
- Modify: `coletor/src/coletor/config.py` (uma linha)
- Test: `coletor/tests/test_faceit.py`

**Interfaces:**
- Consumes: nada do projeto (módulo folha; HTTP injetável).
- Produces (usadas pela Task 4):
  - `listar_historico_5v5(api_key, faceit_player_id, ja_vistas, andar_tudo=False, http_get_json=...) -> list[dict]`
    — dicts `{"faceit_match_id": str, "finished_at": int}` das 5v5 novas, mais antiga primeiro.
  - `detalhes_partida(api_key, faceit_match_id, http_get_json=...) -> dict` (raw da API)
  - `stats_partida(api_key, faceit_match_id, http_get_json=...) -> dict` (raw da API)
  - `elo_atual(api_key, faceit_player_id, http_get_json=...) -> tuple[int|None, int|None]` (elo, level)
  - `baixar_demo(api_key, demo_resource_url, http_post_json=..., http_get_bytes=...) -> bytes`
    — bytes do `.dem` JÁ descomprimido.
  - `montar_parsed_stats_only(detalhes, stats) -> dict` — dict aceito por `db.store_parsed`.
  - `escolher_partida_para_elo(novas, snapshot_anterior_em) -> str|None` — `novas` é
    `list[tuple[match_id_uuid, played_at_datetime]]`; devolve o match_id da mais recente com
    `played_at > snapshot_anterior_em` (ou todas, se `snapshot_anterior_em is None` → devolve a
    mais recente mesmo assim? NÃO: se nunca houve snapshot, devolve None — sem "before" não há
    delta honesto).

- [ ] **Step 1: Escrever os testes das funções puras (falham primeiro)**

Criar `coletor/tests/test_faceit.py`:

```python
from datetime import datetime, timezone

from coletor import faceit


def _pagina(items):
    return {"items": items}


def _item(mid, teams_size=5, finished_at=1000):
    return {"match_id": mid, "teams_size": teams_size, "finished_at": finished_at, "status": "FINISHED"}


def test_listar_historico_5v5_filtra_teams_size_e_ja_vistas_e_para_na_pagina_toda_conhecida():
    paginas = [
        _pagina([_item("m3", finished_at=300), _item("w1", teams_size=2, finished_at=250), _item("m2", finished_at=200)]),
        _pagina([_item("m1", finished_at=100)]),  # toda conhecida -> para aqui sem pedir a próxima
        _pagina([_item("m0", finished_at=50)]),
    ]
    chamadas = []

    def fake_get(url, api_key):
        chamadas.append(url)
        return paginas[len(chamadas) - 1]

    novas = faceit.listar_historico_5v5("k", "fid", ja_vistas={"m1"}, http_get_json=fake_get)
    assert [n["faceit_match_id"] for n in novas] == ["m2", "m3"]  # mais antiga primeiro
    assert len(chamadas) == 2  # não pediu a 3ª página
    assert "offset=0" in chamadas[0] and "limit=100" in chamadas[0] and "game=cs2" in chamadas[0]


def test_listar_historico_5v5_andar_tudo_vai_ate_pagina_vazia():
    paginas = [
        _pagina([_item("m2", finished_at=200)]),
        _pagina([_item("m1", finished_at=100)]),
        _pagina([]),
    ]
    chamadas = []

    def fake_get(url, api_key):
        chamadas.append(url)
        return paginas[len(chamadas) - 1]

    novas = faceit.listar_historico_5v5("k", "fid", ja_vistas={"m1"}, andar_tudo=True, http_get_json=fake_get)
    assert [n["faceit_match_id"] for n in novas] == ["m2"]
    assert len(chamadas) == 3  # andou até a página vazia mesmo com tudo conhecido no meio


def test_elo_atual_extrai_games_cs2_e_tolera_ausencia():
    payload = {"games": {"cs2": {"faceit_elo": 1420, "skill_level": 7}}}
    assert faceit.elo_atual("k", "fid", http_get_json=lambda u, k: payload) == (1420, 7)
    assert faceit.elo_atual("k", "fid", http_get_json=lambda u, k: {"games": {}}) == (None, None)


DETALHES = {
    "teams": {
        "faction1": {"name": "time_alpha", "roster": [
            {"game_player_id": "111", "player_id": "f-111", "nickname": "alpha1"},
        ]},
        "faction2": {"name": "time_beta", "roster": [
            {"game_player_id": "222", "player_id": "f-222", "nickname": "beta1"},
        ]},
    },
    "results": {"winner": "faction2", "score": {"faction1": 7, "faction2": 13}},
    "finished_at": 1752690000,
    "demo_url": ["https://demos.faceit.com/x.dem.gz"],
}

STATS = {"rounds": [{
    "round_stats": {"Map": "de_mirage", "Rounds": "20"},
    "teams": [
        {"team_id": "t1", "players": [
            {"player_id": "f-111", "nickname": "alpha1",
             "player_stats": {"Kills": "20", "Deaths": "15", "Assists": "4", "Headshots": "9", "MVPs": "3"}},
        ]},
        {"team_id": "t2", "players": [
            {"player_id": "f-222", "nickname": "beta1",
             "player_stats": {"Kills": "25", "Deaths": "12", "Assists": "6", "Headshots": "13", "MVPs": "5"}},
        ]},
    ],
}]}


def test_montar_parsed_stats_only_mapeia_times_placar_e_stats():
    parsed = faceit.montar_parsed_stats_only(DETALHES, STATS)
    assert parsed["map"] == "de_mirage"
    assert parsed["score_a"] == 7 and parsed["score_b"] == 13
    assert parsed["team_a_name"] == "time_alpha" and parsed["team_b_name"] == "time_beta"
    assert parsed["played_at"].startswith("2025") or parsed["played_at"].startswith("2026")
    alpha = next(p for p in parsed["players"] if p["steam_id64"] == "111")
    beta = next(p for p in parsed["players"] if p["steam_id64"] == "222")
    assert alpha["team"] == "A" and alpha["kills"] == 20 and alpha["deaths"] == 15
    assert alpha["assists"] == 4 and alpha["headshot_kills"] == 9
    assert alpha["won"] is False and beta["won"] is True
    assert alpha["rounds_played"] == 20
    # listas que só o parser produz ficam vazias, mas PRESENTES (store_parsed itera nelas)
    for chave in ("rounds", "kills", "highlights", "round_econ", "player_round_econ",
                  "purchases", "player_damage", "player_flashes", "kill_positions", "lineups"):
        assert parsed[chave] == []


def test_escolher_partida_para_elo_pega_a_mais_recente_depois_do_snapshot():
    dt = lambda s: datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
    novas = [("m1", dt("2026-07-16T10:00:00")), ("m2", dt("2026-07-16T12:00:00")), ("m3", dt("2026-07-15T09:00:00"))]
    assert faceit.escolher_partida_para_elo(novas, dt("2026-07-16T09:00:00")) == "m2"
    assert faceit.escolher_partida_para_elo(novas, dt("2026-07-16T13:00:00")) is None
    assert faceit.escolher_partida_para_elo(novas, None) is None  # sem snapshot anterior, sem delta honesto
    assert faceit.escolher_partida_para_elo([], dt("2026-07-16T09:00:00")) is None


def test_baixar_demo_troca_por_url_assinada_e_descomprime_gzip():
    import gzip
    dem = b"HL2DEMO fake bytes"
    chamados = {}

    def fake_post(url, api_key, body):
        chamados["post"] = (url, body)
        return {"payload": {"download_url": "https://signed/x.dem.gz"}}

    def fake_get_bytes(url):
        chamados["get"] = url
        return gzip.compress(dem)

    out = faceit.baixar_demo("k", "https://demos.faceit.com/x.dem.gz",
                             http_post_json=fake_post, http_get_bytes=fake_get_bytes)
    assert out == dem
    assert chamados["post"][1] == {"resource_url": "https://demos.faceit.com/x.dem.gz"}
    assert chamados["get"] == "https://signed/x.dem.gz"


def test_baixar_demo_aceita_download_url_na_raiz_e_bytes_nao_gzipados():
    out = faceit.baixar_demo(
        "k", "u",
        http_post_json=lambda url, api_key, body: {"download_url": "https://signed/x.dem"},
        http_get_bytes=lambda url: b"raw dem sem gzip",
    )
    assert out == b"raw dem sem gzip"
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `cd coletor && ./.venv/Scripts/python.exe -m pytest tests/test_faceit.py -v`
Expected: FAIL com `ModuleNotFoundError`/`AttributeError` (módulo não existe)

- [ ] **Step 3: Implementar `faceit.py`**

```python
"""Cliente da FACEIT Data API v4 + Downloads API (Fase B — ingestão automática).

HTTP sempre injetável (http_get_json=...) pra teste, igual steam_api.py. Auth por
header Bearer com a FACEIT_API_KEY (chave server-side criada no App Studio).
Formatos confirmados no swagger oficial (open.faceit.com/data/v4/docs/swagger.json).
"""

import gzip
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE_DATA = "https://open.faceit.com/data/v4"
URL_DOWNLOAD = "https://open.faceit.com/download/v2/demos/download"
PAGINA = 100


def _req_json(url, api_key, body=None, timeout=30):
    dados = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=dados, headers={
        "Authorization": f"Bearer {api_key}",
        **({"Content-Type": "application/json"} if body is not None else {}),
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _http_get_json(url, api_key):
    return _req_json(url, api_key)


def _http_post_json(url, api_key, body):
    return _req_json(url, api_key, body=body)


def _http_get_bytes(url, timeout=120):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def listar_historico_5v5(api_key, faceit_player_id, ja_vistas, andar_tudo=False,
                         http_get_json=_http_get_json):
    """Anda /players/{id}/history?game=cs2 paginando. Devolve as partidas 5v5 ainda não
    vistas, MAIS ANTIGA PRIMEIRO (o histórico entra em ordem). Para na primeira página
    onde todos os itens já são conhecidos — exceto com andar_tudo=True (primeira
    sincronização do membro), quando anda até a página vazia (histórico inteiro)."""
    novas = []
    offset = 0
    while True:
        qs = urllib.parse.urlencode({"game": "cs2", "offset": offset, "limit": PAGINA})
        payload = http_get_json(f"{BASE_DATA}/players/{faceit_player_id}/history?{qs}", api_key)
        items = payload.get("items") or []
        if not items:
            break
        ineditas = [i for i in items
                    if i.get("teams_size") == 5 and i.get("match_id")
                    and i["match_id"] not in ja_vistas]
        novas.extend({"faceit_match_id": i["match_id"], "finished_at": i.get("finished_at")}
                     for i in ineditas)
        # página inteira conhecida = já alcançamos o que tínhamos (5v5 ou não, o critério
        # é match_id conhecido) — só continua se for a primeira sincronização
        if not andar_tudo and all(i.get("match_id") in ja_vistas for i in items):
            break
        offset += PAGINA
    novas.sort(key=lambda n: n.get("finished_at") or 0)
    return novas


def detalhes_partida(api_key, faceit_match_id, http_get_json=_http_get_json):
    return http_get_json(f"{BASE_DATA}/matches/{faceit_match_id}", api_key)


def stats_partida(api_key, faceit_match_id, http_get_json=_http_get_json):
    return http_get_json(f"{BASE_DATA}/matches/{faceit_match_id}/stats", api_key)


def elo_atual(api_key, faceit_player_id, http_get_json=_http_get_json):
    payload = http_get_json(f"{BASE_DATA}/players/{faceit_player_id}", api_key)
    cs2 = (payload.get("games") or {}).get("cs2") or {}
    return cs2.get("faceit_elo"), cs2.get("skill_level")


def baixar_demo(api_key, demo_resource_url, http_post_json=_http_post_json,
                http_get_bytes=_http_get_bytes):
    """Troca a demo_url por uma URL assinada (Downloads API) e baixa. Devolve os bytes
    do .dem já descomprimidos (FACEIT serve .dem.gz; tolera bytes crus sem gzip)."""
    resp = http_post_json(URL_DOWNLOAD, api_key, {"resource_url": demo_resource_url})
    assinada = (resp.get("payload") or {}).get("download_url") or resp.get("download_url")
    if not assinada:
        raise RuntimeError(f"Downloads API sem download_url (chaves: {sorted(resp.keys())})")
    dados = http_get_bytes(assinada)
    if dados[:2] == b"\x1f\x8b":  # magic do gzip
        return gzip.decompress(dados)
    return dados


def _epoch_para_iso(epoch):
    if not epoch:
        return None
    return datetime.fromtimestamp(int(epoch), tz=timezone.utc).isoformat()


def montar_parsed_stats_only(detalhes, stats):
    """Monta o dict `parsed` mínimo aceito por db.store_parsed a partir só da API
    (fallback quando a demo não está mais disponível): placar, mapa, data e stats
    básicas por jogador. Campos que só o parser produz (KAST, rating, economia,
    replay, granadas) ficam nulos/vazios — a UI já esconde o que é nulo."""
    times = detalhes.get("teams") or {}
    resultados = detalhes.get("results") or {}
    placar = resultados.get("score") or {}
    vencedor = resultados.get("winner")

    rodada = (stats.get("rounds") or [{}])[0]
    round_stats = rodada.get("round_stats") or {}
    stats_por_faceit_id = {}
    for time_stats in rodada.get("teams") or []:
        for p in time_stats.get("players") or []:
            stats_por_faceit_id[p.get("player_id")] = p.get("player_stats") or {}

    def _int(v):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0

    rounds_total = _int(round_stats.get("Rounds")) or (_int(placar.get("faction1")) + _int(placar.get("faction2")))
    players = []
    for faccao, letra in (("faction1", "A"), ("faction2", "B")):
        for r in (times.get(faccao) or {}).get("roster") or []:
            ps = stats_por_faceit_id.get(r.get("player_id"), {})
            players.append({
                "steam_id64": r.get("game_player_id"),
                "nick": r.get("nickname") or "",
                "team": letra,
                "kills": _int(ps.get("Kills")),
                "deaths": _int(ps.get("Deaths")),
                "assists": _int(ps.get("Assists")),
                "headshot_kills": _int(ps.get("Headshots")),
                "damage": 0,
                "rounds_played": rounds_total,
                "won": (vencedor == faccao) if vencedor in ("faction1", "faction2") else None,
                "weapons": {},
            })

    return {
        "map": round_stats.get("Map") or "",
        "score_a": _int(placar.get("faction1")),
        "score_b": _int(placar.get("faction2")),
        "team_a_name": (times.get("faction1") or {}).get("name"),
        "team_b_name": (times.get("faction2") or {}).get("name"),
        "played_at": _epoch_para_iso(detalhes.get("finished_at")),
        "players": players,
        "rounds": [], "kills": [], "highlights": [], "round_econ": [],
        "player_round_econ": [], "purchases": [], "player_damage": [],
        "player_flashes": [], "kill_positions": [], "lineups": [],
    }


def escolher_partida_para_elo(novas, snapshot_anterior_em):
    """Das partidas recém-ingeridas de um membro (`novas` = [(match_id, played_at_dt)]),
    escolhe a que ganha o carimbo de ELO before/after: a MAIS RECENTE jogada DEPOIS do
    snapshot anterior. Sem snapshot anterior (None) não há "before" honesto → None
    (é o caso do backfill: histórico fica sem delta, decisão da spec)."""
    if snapshot_anterior_em is None:
        return None
    candidatas = [(m, dt) for m, dt in novas if dt is not None and dt > snapshot_anterior_em]
    if not candidatas:
        return None
    return max(candidatas, key=lambda par: par[1])[0]
```

E em `coletor/src/coletor/config.py`, dentro de `__init__`, logo após `self.steam_api_key`:

```python
        self.faceit_api_key = env.get("FACEIT_API_KEY")
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `cd coletor && ./.venv/Scripts/python.exe -m pytest tests/test_faceit.py -v`
Expected: PASS (8 passed)

- [ ] **Step 5: Rodar a suíte inteira do Coletor**

Run: `cd coletor && ./.venv/Scripts/python.exe -m pytest -q`
Expected: todos passam (127 + 8 novos)

- [ ] **Step 6: Commit**

```bash
git add coletor/src/coletor/faceit.py coletor/src/coletor/config.py coletor/tests/test_faceit.py
git commit -m "feat: cliente da FACEIT Data API (historico 5v5, stats-only, elo, download de demo)"
```

---

### Task 3: `db.py` — helpers da fila e do ELO

**Files:**
- Modify: `coletor/src/coletor/db.py` (adicionar no FIM do arquivo)
- Test: `coletor/tests/test_storage_db.py`

**Interfaces:**
- Consumes: tabelas da Task 1.
- Produces (usadas pela Task 4):
  - `listar_vinculados_faceit(conn) -> list[tuple[steam_id64, faceit_id, grupo_ativo_id]]`
  - `faceit_match_ids_conhecidos(conn) -> set[str]`
  - `membro_ja_sincronizou_faceit(conn, steam_id64) -> bool`
  - `enfileirar_faceit(conn, faceit_match_id, steam_id64, group_id) -> None` (idempotente)
  - `listar_faceit_pendentes(conn, limite=10) -> list[tuple[faceit_match_id, steam_id64, group_id]]`
  - `concluir_faceit_pendente(conn, faceit_match_id) -> None`
  - `falhar_faceit_pendente(conn, faceit_match_id, erro, max_tentativas=3) -> None`
  - `marcar_faceit_match(conn, match_id, faceit_match_id) -> None`
  - `elo_snapshot(conn, steam_id64) -> tuple[int|None, datetime|None]`
  - `atualizar_elo(conn, steam_id64, elo, level) -> None`
  - `gravar_elo_partida(conn, match_id, steam_id64, before, after) -> None`

- [ ] **Step 1: Escrever os testes (padrão FakeConn/FakeCursor já usado no arquivo — seguir os fixtures existentes)**

Adicionar em `coletor/tests/test_storage_db.py` (adaptar `FakeConn`/`FakeCursor` ao que o
arquivo já tem — os asserts abaixo são sobre o SQL/params gravados pelo fake):

```python
def test_enfileirar_faceit_e_idempotente_e_alinha_placeholders():
    conn = FakeConn()
    db.enfileirar_faceit(conn, "fm1", "111", "g1")
    sql, params = conn.cursor_obj.queries[-1]
    assert "on conflict (faceit_match_id) do nothing" in sql
    assert sql.count("%s") == len(params) == 3


def test_falhar_faceit_pendente_incrementa_e_marca_failed_no_limite():
    conn = FakeConn()
    db.falhar_faceit_pendente(conn, "fm1", "boom", max_tentativas=3)
    sql, params = conn.cursor_obj.queries[-1]
    # uma query só: incrementa tentativas, guarda erro, e o status vira 'failed'
    # quando tentativas+1 >= max — senão volta pra 'pending' (retry na próxima rodada)
    assert "tentativas = tentativas + 1" in sql
    assert "case when tentativas + 1 >= %s then 'failed' else 'pending' end" in sql
    assert sql.count("%s") == len(params)


def test_gravar_elo_partida_atualiza_match_players():
    conn = FakeConn()
    db.gravar_elo_partida(conn, "m1", "111", 1400, 1425)
    sql, params = conn.cursor_obj.queries[-1]
    assert "update match_players set faceit_elo_before = %s, faceit_elo_after = %s" in sql
    assert params == (1400, 1425, "m1", "111")
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `cd coletor && ./.venv/Scripts/python.exe -m pytest tests/test_storage_db.py -k "faceit or elo_partida" -v`
Expected: FAIL com AttributeError (helpers não existem)

- [ ] **Step 3: Implementar no fim de `db.py`**

```python
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
            "select faceit_match_id, steam_id64, group_id from faceit_pendentes "
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
```

- [ ] **Step 4: Rodar e confirmar que passam + suíte inteira**

Run: `cd coletor && ./.venv/Scripts/python.exe -m pytest -q`
Expected: todos passam

- [ ] **Step 5: Commit**

```bash
git add coletor/src/coletor/db.py coletor/tests/test_storage_db.py
git commit -m "feat: helpers de fila FACEIT e ELO em db.py"
```

---

### Task 4: `cmd_sincronizar_faceit` + workflow

**Files:**
- Modify: `coletor/src/coletor/main.py` (função nova + registro do subcomando)
- Modify: `.github/workflows/coletor.yml` (step novo)
- Test: `coletor/tests/test_main.py`

**Interfaces:**
- Consumes: Task 2 (`faceit.*`), Task 3 (`dbmod.*`), `ingest_demo(config, conn, path,
  share_code=None, source, upload, played_at, group_id)` e
  `dbmod.store_parsed(conn, parsed, source=..., group_id=..., prefer_new_played_at=...)`
  (já existentes).
- Produces: subcomando `python -m coletor.main sincronizar-faceit`.

- [ ] **Step 1: Escrever os testes (padrão monkeypatch do test_main.py — seguir os fixtures FakeConn existentes do arquivo)**

Adicionar em `coletor/tests/test_main.py`:

```python
def test_sincronizar_faceit_sem_api_key_pula_sem_tocar_no_banco(monkeypatch, capsys):
    config = Config(env={})  # sem FACEIT_API_KEY
    conn = FakeConn()
    total = main.cmd_sincronizar_faceit(config, conn)
    assert total == 0
    assert "FACEIT_API_KEY" in capsys.readouterr().out


def test_sincronizar_faceit_descobre_processa_demo_e_carimba_elo(monkeypatch):
    config = Config(env={"FACEIT_API_KEY": "k"})
    conn = FakeConn()
    from datetime import datetime, timezone
    antes_dt = datetime(2026, 7, 16, 9, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(main.dbmod, "listar_vinculados_faceit", lambda c: [("111", "f-111", "g1")])
    monkeypatch.setattr(main.dbmod, "faceit_match_ids_conhecidos", lambda c: set())
    monkeypatch.setattr(main.dbmod, "membro_ja_sincronizou_faceit", lambda c, s: True)
    enfileiradas = []
    monkeypatch.setattr(main.dbmod, "enfileirar_faceit", lambda c, m, s, g: enfileiradas.append(m))
    monkeypatch.setattr(main.faceit, "listar_historico_5v5",
                        lambda key, fid, ja_vistas, andar_tudo=False, **kw: [
                            {"faceit_match_id": "fm1", "finished_at": 1752660000}])
    monkeypatch.setattr(main.dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", "g1")])
    monkeypatch.setattr(main.faceit, "detalhes_partida",
                        lambda key, mid, **kw: {"demo_url": ["https://d/x.dem.gz"],
                                                "finished_at": 1752660000, "teams": {}, "results": {}})
    monkeypatch.setattr(main.faceit, "stats_partida", lambda key, mid, **kw: {"rounds": []})
    monkeypatch.setattr(main.faceit, "baixar_demo", lambda key, url, **kw: b"dem bytes")
    monkeypatch.setattr(main, "ingest_demo",
                        lambda config, conn, path, **kw: "uuid-m1")
    marcadas, concluidas, elo_gravado = [], [], []
    monkeypatch.setattr(main.dbmod, "marcar_faceit_match", lambda c, mid, fmid: marcadas.append((mid, fmid)))
    monkeypatch.setattr(main.dbmod, "concluir_faceit_pendente", lambda c, fmid: concluidas.append(fmid))
    monkeypatch.setattr(main.faceit, "elo_atual", lambda key, fid, **kw: (1425, 7))
    monkeypatch.setattr(main.dbmod, "elo_snapshot", lambda c, s: (1400, antes_dt))
    monkeypatch.setattr(main.dbmod, "atualizar_elo", lambda c, s, e, l: None)
    monkeypatch.setattr(main.dbmod, "gravar_elo_partida",
                        lambda c, mid, s, b, a: elo_gravado.append((mid, s, b, a)))

    total = main.cmd_sincronizar_faceit(config, conn)

    assert total == 1
    assert enfileiradas == ["fm1"]
    assert marcadas == [("uuid-m1", "fm1")]
    assert concluidas == ["fm1"]
    assert elo_gravado == [("uuid-m1", "111", 1400, 1425)]


def test_sincronizar_faceit_cai_no_stats_only_quando_demo_falha(monkeypatch):
    config = Config(env={"FACEIT_API_KEY": "k"})
    conn = FakeConn()
    monkeypatch.setattr(main.dbmod, "listar_vinculados_faceit", lambda c: [("111", "f-111", "g1")])
    monkeypatch.setattr(main.dbmod, "faceit_match_ids_conhecidos", lambda c: {"fm1"})
    monkeypatch.setattr(main.dbmod, "membro_ja_sincronizou_faceit", lambda c, s: True)
    monkeypatch.setattr(main.faceit, "listar_historico_5v5", lambda *a, **kw: [])
    monkeypatch.setattr(main.dbmod, "listar_faceit_pendentes", lambda c, limite=10: [("fm1", "111", "g1")])
    monkeypatch.setattr(main.faceit, "detalhes_partida",
                        lambda key, mid, **kw: {"demo_url": [], "finished_at": 1752660000,
                                                "teams": {}, "results": {}})
    monkeypatch.setattr(main.faceit, "stats_partida", lambda key, mid, **kw: {"rounds": []})
    monkeypatch.setattr(main.faceit, "montar_parsed_stats_only",
                        lambda d, s: {"players": [], "map": "de_mirage", "played_at": None})
    gravados = []
    monkeypatch.setattr(main.dbmod, "store_parsed",
                        lambda conn, parsed, **kw: gravados.append(kw) or "uuid-m2")
    monkeypatch.setattr(main.dbmod, "marcar_faceit_match", lambda c, mid, fmid: None)
    monkeypatch.setattr(main.dbmod, "concluir_faceit_pendente", lambda c, fmid: None)
    monkeypatch.setattr(main.faceit, "elo_atual", lambda key, fid, **kw: (None, None))
    monkeypatch.setattr(main.dbmod, "elo_snapshot", lambda c, s: (None, None))
    monkeypatch.setattr(main.dbmod, "atualizar_elo", lambda c, s, e, l: None)

    total = main.cmd_sincronizar_faceit(config, conn)
    assert total == 1
    assert gravados[0]["source"] == "faceit"


def test_sincronizar_faceit_falha_de_item_nao_derruba_o_lote(monkeypatch):
    config = Config(env={"FACEIT_API_KEY": "k"})
    conn = FakeConn()
    monkeypatch.setattr(main.dbmod, "listar_vinculados_faceit", lambda c: [("111", "f-111", "g1")])
    monkeypatch.setattr(main.dbmod, "faceit_match_ids_conhecidos", lambda c: set())
    monkeypatch.setattr(main.dbmod, "membro_ja_sincronizou_faceit", lambda c, s: True)
    monkeypatch.setattr(main.faceit, "listar_historico_5v5", lambda *a, **kw: [])
    monkeypatch.setattr(main.dbmod, "listar_faceit_pendentes",
                        lambda c, limite=10: [("fm-ruim", "111", "g1"), ("fm-bom", "111", "g1")])

    def detalhes(key, mid, **kw):
        if mid == "fm-ruim":
            raise RuntimeError("api 500")
        return {"demo_url": [], "finished_at": 1752660000, "teams": {}, "results": {}}

    monkeypatch.setattr(main.faceit, "detalhes_partida", detalhes)
    monkeypatch.setattr(main.faceit, "stats_partida", lambda key, mid, **kw: {"rounds": []})
    monkeypatch.setattr(main.faceit, "montar_parsed_stats_only", lambda d, s: {"players": [], "played_at": None})
    monkeypatch.setattr(main.dbmod, "store_parsed", lambda conn, parsed, **kw: "uuid-ok")
    monkeypatch.setattr(main.dbmod, "marcar_faceit_match", lambda c, mid, fmid: None)
    monkeypatch.setattr(main.dbmod, "concluir_faceit_pendente", lambda c, fmid: None)
    falhas = []
    monkeypatch.setattr(main.dbmod, "falhar_faceit_pendente", lambda c, fmid, erro, **kw: falhas.append(fmid))
    monkeypatch.setattr(main.faceit, "elo_atual", lambda key, fid, **kw: (None, None))
    monkeypatch.setattr(main.dbmod, "elo_snapshot", lambda c, s: (None, None))
    monkeypatch.setattr(main.dbmod, "atualizar_elo", lambda c, s, e, l: None)

    total = main.cmd_sincronizar_faceit(config, conn)
    assert total == 1
    assert falhas == ["fm-ruim"]
```

Nota pro implementador: `Config`/`FakeConn` já existem em `test_main.py` — usar os do arquivo
(se `Config` for importado de outro jeito, seguir o import existente). Se `FakeConn` do arquivo
não aceitar construção vazia, usar o fixture/factory que os testes vizinhos usam.

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `cd coletor && ./.venv/Scripts/python.exe -m pytest tests/test_main.py -k sincronizar_faceit -v`
Expected: AttributeError (cmd não existe)

- [ ] **Step 3: Implementar em `main.py`**

Confirmado em `main.py:19-31`: o arquivo importa módulos como `from . import db as dbmod`,
`from . import parse as parsemod` etc. Adicionar, no mesmo bloco (depois de `from . import
steam_api`):

```python
from . import faceit
```

(sem alias — os testes monkeypatcham `main.faceit.*` diretamente, igual já fazem com
`main.steam_api.*`.)

Adicionar a função (depois de `cmd_avatares`):

```python
def cmd_sincronizar_faceit(config, conn, limite=10):
    """FACEIT Fase B: descobre partidas 5v5 novas de cada membro vinculado (Fase A) e
    processa até `limite` da fila por rodada — demo no pipeline completo quando existe,
    stats-only da API quando não (partida nunca some). No fim, snapshot de ELO por
    membro + carimbo before/after na partida nova mais recente (ver spec 2026-07-16)."""
    import tempfile
    from datetime import datetime, timezone
    from pathlib import Path

    if not config.faceit_api_key:
        print("sincronizar-faceit: FACEIT_API_KEY ausente — pulando")
        return 0
    vinculados = dbmod.listar_vinculados_faceit(conn)
    if not vinculados:
        print("sincronizar-faceit: nenhum membro com FACEIT vinculada")
        return 0

    # 1. Descoberta — enfileira o que ainda não foi visto (histórico inteiro na 1ª vez)
    conhecidas = dbmod.faceit_match_ids_conhecidos(conn)
    for steam_id64, faceit_id, group_id in vinculados:
        try:
            primeira = not dbmod.membro_ja_sincronizou_faceit(conn, steam_id64)
            novas = faceit.listar_historico_5v5(
                config.faceit_api_key, faceit_id, conhecidas, andar_tudo=primeira,
            )
            for item in novas:
                dbmod.enfileirar_faceit(conn, item["faceit_match_id"], steam_id64, group_id)
                conhecidas.add(item["faceit_match_id"])
            if novas:
                print(f"  descoberta {steam_id64}: {len(novas)} partida(s) nova(s)")
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            print(f"  descoberta {steam_id64}: FALHOU ({e})")

    # 2. Processamento — lote limitado; falha de um item não derruba os outros
    vinculados_por_steam = {s: (f, g) for s, f, g in vinculados}
    ingeridas_por_membro = {}
    total = 0
    for faceit_match_id, steam_id64, group_id in dbmod.listar_faceit_pendentes(conn, limite):
        try:
            detalhes = faceit.detalhes_partida(config.faceit_api_key, faceit_match_id)
            stats = faceit.stats_partida(config.faceit_api_key, faceit_match_id)
            played_at = None
            if detalhes.get("finished_at"):
                played_at = datetime.fromtimestamp(
                    int(detalhes["finished_at"]), tz=timezone.utc,
                ).isoformat()

            match_id = None
            demo_urls = detalhes.get("demo_url") or []
            if demo_urls:
                try:
                    dem_bytes = faceit.baixar_demo(config.faceit_api_key, demo_urls[0])
                    with tempfile.TemporaryDirectory() as tmp:
                        dem_path = Path(tmp) / "faceit.dem"
                        dem_path.write_bytes(dem_bytes)
                        match_id = ingest_demo(
                            config, conn, dem_path,
                            share_code=None, source="faceit", upload=True,
                            played_at=played_at, group_id=group_id,
                        )
                except Exception as e:  # noqa: BLE001
                    conn.rollback()
                    print(f"  {faceit_match_id}: demo falhou ({e}) — caindo pro stats-only")

            if match_id is None:
                parsed = faceit.montar_parsed_stats_only(detalhes, stats)
                match_id = dbmod.store_parsed(
                    conn, parsed, source="faceit",
                    prefer_new_played_at=bool(parsed.get("played_at")),
                    group_id=group_id,
                )

            dbmod.marcar_faceit_match(conn, match_id, faceit_match_id)
            dbmod.concluir_faceit_pendente(conn, faceit_match_id)
            dt = datetime.fromisoformat(played_at) if played_at else None
            ingeridas_por_membro.setdefault(steam_id64, []).append((match_id, dt))
            print(f"  {faceit_match_id}: ok ({match_id})")
            total += 1
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            dbmod.falhar_faceit_pendente(conn, faceit_match_id, e)
            print(f"  {faceit_match_id}: FALHOU ({e})")

    # 3. ELO — snapshot por membro + carimbo na partida nova mais recente
    for steam_id64, faceit_id, _ in vinculados:
        try:
            elo, level = faceit.elo_atual(config.faceit_api_key, faceit_id)
            if elo is None:
                continue
            antes, snapshot_em = dbmod.elo_snapshot(conn, steam_id64)
            alvo = faceit.escolher_partida_para_elo(
                ingeridas_por_membro.get(steam_id64, []), snapshot_em,
            )
            if alvo and antes is not None:
                dbmod.gravar_elo_partida(conn, alvo, steam_id64, antes, elo)
            dbmod.atualizar_elo(conn, steam_id64, elo, level)
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            print(f"  elo {steam_id64}: FALHOU ({e})")

    print(f"sincronizar-faceit: {total} partida(s) processada(s)")
    return total
```

Registro do subcomando: no bloco de `add_parser` do fim do arquivo (linhas ~663-710), adicionar
junto dos outros:

```python
    sub.add_parser(
        "sincronizar-faceit",
        help="FACEIT Fase B: descobre e ingere partidas 5v5 de membros vinculados + ELO.",
    )
```

E no dispatch (o if/elif que mapeia `args.cmd` → função, logo abaixo — seguir o formato exato
dos vizinhos como `avatares`):

```python
    elif args.cmd == "sincronizar-faceit":
        cmd_sincronizar_faceit(config, conn)
```

- [ ] **Step 4: Rodar e confirmar que passam + suíte inteira**

Run: `cd coletor && ./.venv/Scripts/python.exe -m pytest -q`
Expected: todos passam

- [ ] **Step 5: Step novo no workflow**

Em `.github/workflows/coletor.yml`, adicionar DEPOIS do step "Processar uploads manuais de demo
pendentes" e ANTES de "Reprocessar todas as Partidas (sob demanda)":

```yaml
      - name: Sincronizar partidas FACEIT (membros vinculados)
        working-directory: coletor
        env:
          PYTHONPATH: src
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          STEAM_API_KEY: ${{ secrets.STEAM_API_KEY }}
          FACEIT_API_KEY: ${{ secrets.FACEIT_API_KEY }}
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
        run: python -m coletor.main sincronizar-faceit
```

(`STEAM_API_KEY` entra porque `ingest_demo` chama `_atualizar_avatares` — os adversários da
FACEIT também ganham foto. Validar o YAML:
`python -c "import yaml; yaml.safe_load(open('.github/workflows/coletor.yml', encoding='utf-8'))"`)

- [ ] **Step 6: Commit**

```bash
git add coletor/src/coletor/main.py coletor/tests/test_main.py .github/workflows/coletor.yml
git commit -m "feat: comando sincronizar-faceit (descoberta+fila+ingest+elo) e step no workflow"
```

---

### Task 5: Server — ELO nas rotas de perfil e partida

**Files:**
- Modify: `site/server/src/routes/profile.js` (rota `GET /:steamId` — SELECT do jogador e resposta)
- Modify: `site/server/src/routes/matches.js` (rota `GET /:id` — SELECT dos players e mapeamento)
- Test: `site/server/test/profile.test.js`, `site/server/test/matches.test.js`

**Interfaces:**
- Consumes: colunas da Task 1.
- Produces: `GET /api/profile/:steamId` → `jogador.faceitElo: number|null`,
  `jogador.faceitSkillLevel: number|null` (junto do `faceitNick` já existente).
  `GET /api/matches/:id` → cada jogador de `players[]` ganha `faceitEloBefore`/`faceitEloAfter`
  (`number|null`).

- [ ] **Step 1: TDD no profile — atualizar fixture/asserts**

Em `site/server/test/profile.test.js`: no fixture do jogador
(`['where p.steam_id64 = $1', [{ steam_id64: '765', nick: 'fih', ... faceit_nick: 'bronzeadoo' }]]`),
adicionar `faceit_elo: 1425, faceit_skill_level: 7`; no assert
`expect(res.body.jogador).toMatchObject({ nick: 'fih', faceitNick: 'bronzeadoo' })` adicionar
`faceitElo: 1425, faceitSkillLevel: 7`. No teste de fallback (adversário sem onboarding), o
`toEqual` do jogador ganha `faceitElo: null, faceitSkillLevel: null`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/server && npx vitest run test/profile.test.js`
Expected: FAIL (campos ausentes)

- [ ] **Step 3: Implementar no `profile.js`**

No SELECT do jogador (`playerQ`), trocar:

```js
      `select p.steam_id64, p.nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url, p.faceit_nick
```

por:

```js
      `select p.steam_id64, p.nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url,
              p.faceit_nick, p.faceit_elo, p.faceit_skill_level
```

E no `res.json`, trocar o objeto `jogador` por:

```js
      jogador: {
        steamId: jogador.steam_id64, nick: jogador.nick, avatarUrl: jogador.avatar_url,
        faceitNick: jogador.faceit_nick ?? null,
        faceitElo: jogador.faceit_elo ?? null,
        faceitSkillLevel: jogador.faceit_skill_level ?? null,
      },
```

- [ ] **Step 4: TDD no matches — fixture/asserts**

Em `site/server/test/matches.test.js`, no teste que já cobre `premierBefore`/`premierAfter`
(fixture dos players da rota `/:id`): adicionar `faceit_elo_before: 1400, faceit_elo_after: 1425`
na linha do jogador e asserts `faceitEloBefore: 1400, faceitEloAfter: 1425`; no caso nulo,
asserts `faceitEloBefore: null, faceitEloAfter: null`.

- [ ] **Step 5: Implementar no `matches.js`**

Na query dos players da rota `GET /:id` (a mesma que tem `mp.premier_rating_before`), adicionar
ao SELECT: `mp.faceit_elo_before, mp.faceit_elo_after`. No mapeamento (junto de
`premierBefore`/`premierAfter`):

```js
        faceitEloBefore: p.faceit_elo_before == null ? null : Number(p.faceit_elo_before),
        faceitEloAfter: p.faceit_elo_after == null ? null : Number(p.faceit_elo_after),
```

- [ ] **Step 6: Suíte inteira do server**

Run: `cd site/server && npm test`
Expected: todos passam (204 + ajustados)

- [ ] **Step 7: Commit**

```bash
git add site/server/src/routes/profile.js site/server/src/routes/matches.js site/server/test/profile.test.js site/server/test/matches.test.js
git commit -m "feat: expoe ELO FACEIT no perfil e no scoreboard da partida"
```

---

### Task 6: Client — badge de ELO no perfil + coluna de pontos unificada

**Files:**
- Create: `site/client/src/components/ui/FaceitEloBadge.jsx`
- Modify: `site/client/src/components/ui/index.js`
- Modify: `site/client/src/pages/JogadorPerfil.jsx` (header)
- Modify: `site/client/src/pages/Partida.jsx` (coluna do Scoreboard)
- Test: `site/client/src/test/ui.test.jsx`

**Interfaces:**
- Consumes: `jogador.faceitElo`/`faceitSkillLevel` (perfil) e `faceitEloBefore/After` por
  jogador (partida), da Task 5. `FaceitIcon` já existe em `components/ui/icones.jsx`.
- Produces: `FaceitEloBadge({ elo, level })` — `return null` quando `elo == null`.

- [ ] **Step 1: Teste de fumaça (falha primeiro)**

Em `site/client/src/test/ui.test.jsx` (adicionar `FaceitEloBadge` ao import de
`../components/ui/index.js`):

```jsx
  it('FaceitEloBadge mostra elo+level e não renderiza nada quando null', () => {
    const { getByText, container } = render(<FaceitEloBadge elo={1425} level={7} />)
    expect(getByText('1425')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
    const { container: vazio } = render(<FaceitEloBadge elo={null} level={null} />)
    expect(vazio.firstChild).toBeNull()
  })
```

Run: `cd site/client && npm test` → FAIL (componente não existe)

- [ ] **Step 2: `FaceitEloBadge.jsx`**

```jsx
import { FaceitIcon } from './icones.jsx'

// Badge de ELO FACEIT — cores dos níveis oficiais (1 cinza, 2-3 verde, 4-7 amarelo,
// 8-9 laranja, 10 vermelho). `level` vem da API; se faltar, deriva do elo pelos
// thresholds oficiais. Não renderiza nada sem elo (mesma regra do PremierBadge).
const CORES_POR_NIVEL = {
  1: 'text-texto-fraco border-borda bg-superficie-alta',
  2: 'text-sucesso border-sucesso/40 bg-sucesso/10',
  3: 'text-sucesso border-sucesso/40 bg-sucesso/10',
  4: 'text-[#facc15] border-[#facc15]/40 bg-[#facc15]/10',
  5: 'text-[#facc15] border-[#facc15]/40 bg-[#facc15]/10',
  6: 'text-[#facc15] border-[#facc15]/40 bg-[#facc15]/10',
  7: 'text-[#facc15] border-[#facc15]/40 bg-[#facc15]/10',
  8: 'text-[#fb923c] border-[#fb923c]/40 bg-[#fb923c]/10',
  9: 'text-[#fb923c] border-[#fb923c]/40 bg-[#fb923c]/10',
  10: 'text-perigo border-perigo/40 bg-perigo/10',
}
const THRESHOLDS = [500, 750, 900, 1050, 1200, 1350, 1530, 1750, 2000]

function nivelDoElo(elo) {
  const idx = THRESHOLDS.findIndex((t) => elo <= t)
  return idx === -1 ? 10 : idx + 1
}

export default function FaceitEloBadge({ elo, level }) {
  if (elo == null) return null
  const nivel = level ?? nivelDoElo(elo)
  const cor = CORES_POR_NIVEL[nivel] ?? CORES_POR_NIVEL[1]
  return (
    <span
      title={`FACEIT nível ${nivel} — ${elo} de ELO`}
      className={`panel-cut-sm inline-flex items-center gap-1 border px-2 py-1 font-mono text-sm font-bold tabular-nums ${cor}`}
    >
      <FaceitIcon className="h-3.5 w-3.5 shrink-0" />
      {Math.round(elo)}
    </span>
  )
}
```

Export em `site/client/src/components/ui/index.js`:

```js
export { default as FaceitEloBadge } from './FaceitEloBadge.jsx'
```

Run: `cd site/client && npm test` → PASS

- [ ] **Step 3: `JogadorPerfil.jsx` — badge no header**

Adicionar `FaceitEloBadge` ao import de `../components/ui`. No header (linha com
`<PremierBadge valor={premierAtual} />`), adicionar logo depois:

```jsx
              <FaceitEloBadge elo={jogador.faceitElo} level={jogador.faceitSkillLevel} />
```

(o objeto `jogador` da resposta já carrega os campos novos da Task 5.)

- [ ] **Step 4: `Partida.jsx` — coluna de pontos unificada no Scoreboard**

No componente `Scoreboard`, trocar a linha:

```jsx
  const temPremier = jogadores.some((p) => p.premierBefore != null)
```

por:

```jsx
  // Coluna de pontos por partida: Premier (valve_mm) OU ELO FACEIT (faceit) — o dado
  // certo pro tipo da partida; nunca os dois ao mesmo tempo.
  const temPontos = jogadores.some((p) => p.premierBefore != null || p.faceitEloBefore != null)
```

No `<thead>`, trocar o `<th>` condicional de Premier por:

```jsx
            {temPontos && (
              <th className="hidden cursor-help px-2 py-2 text-right underline decoration-dotted underline-offset-2 sm:table-cell" title="Pontuação (Premier ou ELO FACEIT) antes dessa partida, e quanto ganhou/perdeu">Pontos</th>
            )}
```

No `<tbody>`, trocar o `<td>` condicional de Premier por:

```jsx
                  {temPontos && (
                    <td className="hidden px-2 py-2 text-right sm:table-cell">
                      {(() => {
                        const antes = p.premierBefore ?? p.faceitEloBefore
                        const depois = p.premierAfter ?? p.faceitEloAfter
                        if (antes == null) return null
                        return (
                          <>
                            <span className="font-mono text-xs tabular-nums text-texto-fraco">{Math.round(antes)}</span>
                            {depois != null && (
                              <span className={`ml-1 font-mono text-xs font-semibold tabular-nums ${depois >= antes ? 'text-sucesso' : 'text-perigo'}`}>
                                {depois >= antes ? '▲' : '▼'}{Math.abs(Math.round(depois - antes))}
                              </span>
                            )}
                          </>
                        )
                      })()}
                    </td>
                  )}
```

E o `colSpan` da linha de expansão de armas: trocar `colSpan={temPremier ? 10 : 9}` por
`colSpan={temPontos ? 10 : 9}`.

- [ ] **Step 5: Build + testes + commit**

Run: `cd site/client && npm run build && npm test`
Expected: build limpo, todos passam

```bash
git add site/client/src/components/ui/FaceitEloBadge.jsx site/client/src/components/ui/index.js site/client/src/pages/JogadorPerfil.jsx site/client/src/pages/Partida.jsx site/client/src/test/ui.test.jsx
git commit -m "feat: badge de ELO FACEIT no perfil e coluna de pontos unificada no placar"
```

---

### Task 7: Deploy + primeira sincronização (operação)

**Files:** nenhum (ações do usuário + verificação)

- [ ] **Step 1: Usuário adiciona `FACEIT_API_KEY` aos secrets do GitHub Actions**
  (repo `bronze-ff/resenhacs` → Settings → Secrets and variables → Actions). Mesma chave
  server-side já usada na Vercel.
- [ ] **Step 2: Usuário confirma "Downloads access" na chave** (developers.faceit.com → App
  Studio → API Keys). Sem isso, demos não baixam e tudo entra stats-only.
- [ ] **Step 3: Push pra produção** (confirmação explícita do usuário, padrão do projeto).
- [ ] **Step 4: Acompanhar a primeira rodada** do workflow (backfill começa: até 10
  partidas/rodada). Conferir no banco: `select status, count(*) from faceit_pendentes group by
  status;` e partidas com `source='faceit'` aparecendo no Feed com o badge FACEIT.
