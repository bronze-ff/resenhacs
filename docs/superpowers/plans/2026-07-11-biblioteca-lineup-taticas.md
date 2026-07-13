# Biblioteca de Lineup + Táticas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao Resenha uma Biblioteca de Granadas filtrável, Táticas curadas (aponta pro
Replay 2D existente) e uma fila de ingestão de partida profissional do HLTV — tudo dentro do
site, sem app externo.

**Architecture:** Estende o Coletor (Python) pra capturar posição/ângulo de arremesso de granada
e nome de time/clã, grava numa tabela nova `lineups` (indexável) por partida (do grupo ou pro).
`taticas` aponta pra um `(match_id, round_number)` real em vez de duplicar dado — a visualização
reaproveita o `ReplayViewer` que já existe. Partida de pro entra por uma fila (`partidas_pro_fila`)
processada pelo job agendado do GitHub Actions (Vercel não aguenta download+parse de demo grande
numa request HTTP).

**Tech Stack:** Python (demoparser2, psycopg) no Coletor; Node/Express no server; React/Vite no
client; Postgres (Supabase) no banco; GitHub Actions pro job agendado.

## Global Constraints

- Todo SQL novo usa `alter table`/`create table` num arquivo de migration numerado sequencial
  em `supabase/migrations/`, seguindo o padrão dos arquivos `0001`–`0012` já existentes.
- Rotas admin usam `requireAuth, requireAdmin` (import de `../auth/middleware.js`), mesmo padrão
  de `site/server/src/routes/players.js`.
- Client em português (pt-BR), mesma paleta/tokens do `index.css` (`panel-cut`, `font-display`,
  `text-destaque`, etc.) — nenhuma classe nova de design system.
- Testes do Coletor usam `pytest`, rodam de `coletor/` com `.venv/Scripts/python.exe -m pytest -q`.
- Testes do server usam `vitest`, mock de `db.query` via `vi.fn()`, mesmo padrão de
  `site/server/test/matches.test.js`.
- Nenhuma dependência nova de licença restritiva — extração de `.rar` usa `unar` (BSD), não
  `unrar` (proprietário), pra rodar sem problema no runner do GitHub Actions.

---

## Task 1: Migration — tabelas novas + nome de time

**Files:**
- Create: `supabase/migrations/0013_lineups_taticas_pro.sql`

**Interfaces:**
- Produces: tabelas `lineups`, `taticas`, `partidas_pro_fila`; colunas `matches.team_a_name`,
  `matches.team_b_name` — usadas por todas as tasks seguintes.

- [ ] **Step 1: Escrever a migration**

```sql
-- Nome do time/clã (extraído da demo) — pra partida de pro mostrar "FaZe vs Vitality" em
-- vez do rótulo genérico "Time A"/"Time B". Nullable: partida do grupo pode não ter clã.
alter table matches
  add column team_a_name text,
  add column team_b_name text;

-- Cada arremesso de granada individual, indexado e filtrável — alimenta a Biblioteca de
-- Granadas. Não duplica o replay.json (que já guarda isso por partida no R2); essa tabela
-- existe pra permitir filtro/busca eficiente ACROSS partidas, coisa que abrir N replay.json
-- não resolve bem.
create table lineups (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  round_number int not null,
  map text not null,
  tipo text not null check (tipo in ('smoke', 'flash', 'he', 'molotov')),
  thrower_steam_id text not null,
  thrower_nick text not null default '',
  thrower_x numeric not null,
  thrower_y numeric not null,
  thrower_yaw numeric not null default 0,
  thrower_pitch numeric not null default 0,
  target_x numeric not null,
  target_y numeric not null,
  tick int not null,
  origem text not null check (origem in ('grupo', 'pro')),
  created_at timestamptz not null default now()
);
create index lineups_map_tipo_idx on lineups (map, tipo);
create index lineups_match_id_idx on lineups (match_id);

-- Tática curada: aponta pra um round real (do grupo ou de pro) — a visualização reaproveita
-- o Replay 2D existente carregando esse round, não duplica posição/movimento aqui.
create table taticas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text not null default '',
  map text not null,
  match_id uuid not null references matches(id) on delete cascade,
  round_number int not null,
  status text not null default 'sugerida' check (status in ('sugerida', 'aprovada', 'rejeitada')),
  criado_por text not null references players(steam_id64),
  criado_em timestamptz not null default now()
);
create index taticas_map_status_idx on taticas (map, status);

-- Fila de curadoria de partida profissional — só controla o PROCESSO de ingestão (link do
-- HLTV, status, erro). Os dados da partida em si vão pras tabelas normais (matches,
-- match_players, lineups) via o mesmo ingest_demo() de sempre, com source='pro'.
create table partidas_pro_fila (
  id uuid primary key default gen_random_uuid(),
  hltv_url text not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'baixando', 'processando', 'concluida', 'falhou')),
  match_id uuid references matches(id) on delete set null,
  erro text,
  adicionado_por text not null references players(steam_id64),
  adicionado_em timestamptz not null default now()
);
```

- [ ] **Step 2: Aplicar a migration no banco de produção**

Usar o mesmo método já usado pras migrations anteriores nesta sessão (psycopg direto contra
`DATABASE_URL` de `site/server/.env`, já que não há CLI do Supabase configurado no projeto).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0013_lineups_taticas_pro.sql
git commit -m "feat: migration lineups/taticas/partidas_pro_fila + nome de time"
```

---

## Task 2: Coletor — capturar nome de time/clã

**Files:**
- Modify: `coletor/src/coletor/parse.py` (dentro de `parse_demo()`, perto de onde `mapa` é lido — linha 116)
- Test: `coletor/tests/test_parse.py`

**Interfaces:**
- Produces: `parsed["team_a_name"]`, `parsed["team_b_name"]` (string ou `None`) no dict devolvido
  por `parse_demo()` — consumido pela Task 4 (`_insert_match`).

- [ ] **Step 1: Escrever o teste (função pura, sem precisar de demo real)**

`demoparser2` expõe `team_clan_name` como coluna de tick igual `team_num` (mesmo padrão já
usado pro snapshot de time fixo A/B). Adicionar uma função pura `_nomes_de_time(snap0, fixed)`
que recebe o mesmo snapshot já usado pra montar `fixed` (dict steamid→"A"/"B") e devolve os
nomes, testável sem parser real:

```python
# em coletor/tests/test_parse.py, junto dos outros testes de função pura
from coletor.parse import _nomes_de_time


def test_nomes_de_time_extrai_dos_dois_lados():
    fixed = {"1": "A", "2": "A", "3": "B", "4": "B"}
    registros = [
        {"steamid": 1, "team_clan_name": "FaZe"},
        {"steamid": 2, "team_clan_name": "FaZe"},
        {"steamid": 3, "team_clan_name": "Vitality"},
        {"steamid": 4, "team_clan_name": "Vitality"},
    ]
    nome_a, nome_b = _nomes_de_time(registros, fixed)
    assert nome_a == "FaZe"
    assert nome_b == "Vitality"


def test_nomes_de_time_ausente_ou_vazio_vira_none():
    fixed = {"1": "A"}
    assert _nomes_de_time([{"steamid": 1, "team_clan_name": ""}], fixed) == (None, None)
    assert _nomes_de_time([], fixed) == (None, None)
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd coletor && .venv/Scripts/python.exe -m pytest tests/test_parse.py -k nomes_de_time -v
```
Esperado: FAIL, `ImportError: cannot import name '_nomes_de_time'`.

- [ ] **Step 3: Implementar `_nomes_de_time` em `parse.py`**

Adicionar perto de `_team_letter` (linha 23):

```python
def _nomes_de_time(registros, fixed):
    """(nome_time_a, nome_time_b) a partir de um snapshot de tick com team_clan_name —
    None quando a demo não traz nome de clã (comum em partida de matchmaking do grupo,
    só partida de pro/LAN costuma ter). `registros` é uma lista de dict/records (mesmo
    formato de parser.parse_ticks(...).to_dict("records"))."""
    nomes = {"A": None, "B": None}
    for r in registros:
        sid = _sid(r.get("steamid"))
        lado = fixed.get(sid)
        nome = (r.get("team_clan_name") or "").strip()
        if lado and nome and not nomes[lado]:
            nomes[lado] = nome
    return nomes["A"], nomes["B"]
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd coletor && .venv/Scripts/python.exe -m pytest tests/test_parse.py -k nomes_de_time -v
```
Esperado: PASS nos 2 testes.

- [ ] **Step 5: Ligar em `parse_demo()`**

Em `parse.py`, localizar o snapshot já feito em `parse_demo()` pra montar `fixed` (mesmo padrão
da linha ~498 de `extract_replay`, mas dentro de `parse_demo` — o snapshot de lá já existe pra
outro fim; adicionar `"team_clan_name"` na lista de colunas desse `parser.parse_ticks(...)`
existente) e, logo após montar `fixed`, chamar:

```python
nome_a, nome_b = _nomes_de_time(snap0.to_dict("records"), fixed)
```

Adicionar ao dict devolvido no final de `parse_demo()` (perto de `"map": mapa,`, linha 463):

```python
"team_a_name": nome_a,
"team_b_name": nome_b,
```

- [ ] **Step 6: Rodar toda a suite do coletor pra garantir que nada quebrou**

```bash
cd coletor && .venv/Scripts/python.exe -m pytest -q
```
Esperado: todos os testes passam (nenhum teste existente checa o dict completo de
`parse_demo()` com igualdade estrita, então um campo novo não quebra nada).

- [ ] **Step 7: Commit**

```bash
git add coletor/src/coletor/parse.py coletor/tests/test_parse.py
git commit -m "feat: captura nome de time/clã na demo (partida de pro)"
```

---

## Task 3: Coletor — posição/ângulo de arremesso de granada

**Files:**
- Modify: `coletor/src/coletor/parse.py` (dentro de `extract_replay()`, seção "Utilitárias +
  bomba", linha 606-685)
- Test: `coletor/tests/test_parse.py`

**Interfaces:**
- Produces: cada item de `smokes`/`fires`/`flashes`/`hes` (devolvidos por `extract_replay()`)
  ganha `thrower`, `throwerX`, `throwerY`, `throwerYaw`, `throwerPitch` (podem ser `None` quando
  não for possível casar o evento de arremesso com a detonação).

**Nota de investigação (fazer ANTES de escrever código de produção)**: hoje o parser só lê o
evento de DETONAÇÃO (`smokegrenade_detonate` etc.), que já traz `user_steamid` (quem jogou) mas
não a posição de ORIGEM do arremesso. Pra pegar isso, é preciso casar com o evento
`weapon_fire` (que marca o momento do arremesso) do mesmo jogador, e então consultar a posição
dele naquele tick exato — mesmo padrão já usado em `extract_replay()` pro snapshot de
`team_num` (`parser.parse_ticks([...], ticks=[...])` num tick específico). A forma de CASAR um
`weapon_fire` com o `detonate` correspondente (mesmo `entityid`? correlação por
`(thrower, tick mais próximo anterior)`?) não está documentada e precisa ser confirmada contra
uma demo real antes de escrever o código final — é o mesmo tipo de "descoberta empírica" já
feito nesta sessão pro alias de arma e pro campo `side`.

- [ ] **Step 1: Investigar contra uma demo real**

Escrever um script descartável (não faz parte do plano, é só investigação) que roda
`parser.parse_event("weapon_fire", other=["user_steamid"])` e
`parser.parse_event("smokegrenade_detonate", other=["user_steamid"])` (e os outros 3 tipos)
numa demo real já baixada nesta sessão, e imprime: os primeiros 5 pares
`(weapon_fire tick, weapon, user_steamid)` e `(detonate tick, entityid, user_steamid)`, pra
confirmar visualmente:
1. Se `weapon_fire` tem `entityid` que bate com o `entityid` do detonate correspondente.
2. Se não, qual é o delta de tick típico entre o `weapon_fire` de uma granada e seu detonate
   (pra decidir a janela de correlação por `(thrower, tick mais próximo)`).

Rodar com: `cd coletor && .venv/Scripts/python.exe investigacao.py` (apagar o script depois).

- [ ] **Step 2: Escrever o teste de `_casar_arremesso_com_detonacao` (função pura)**

Com o resultado do Step 1 confirmado, escrever a função de correlação como pura (recebe listas
de dict, devolve mapa), testável sem parser real. Exemplo assumindo que a correlação é por
`(thrower, detonate_tick - fire_tick mais próximo dentro de uma janela)` — **ajustar a lógica
exata conforme o que o Step 1 revelar**, mantendo o teste no mesmo formato:

```python
from coletor.parse import _casar_arremesso_com_detonacao


def test_casa_arremesso_mais_proximo_do_mesmo_jogador():
    fires = [
        {"tick": 1000, "thrower": "A", "weapon": "smokegrenade"},
        {"tick": 1500, "thrower": "B", "weapon": "smokegrenade"},
    ]
    detonates = [
        {"tick": 1130, "thrower": "A"},  # ~130 ticks depois do fire de A (voo da granada)
        {"tick": 1620, "thrower": "B"},
    ]
    casados = _casar_arremesso_com_detonacao(fires, detonates)
    assert casados[(1130, "A")] == 1000
    assert casados[(1620, "B")] == 1500


def test_sem_fire_correspondente_fica_de_fora():
    detonates = [{"tick": 1130, "thrower": "A"}]
    assert _casar_arremesso_com_detonacao([], detonates) == {}
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
cd coletor && .venv/Scripts/python.exe -m pytest tests/test_parse.py -k casar_arremesso -v
```
Esperado: FAIL, `ImportError`.

- [ ] **Step 4: Implementar `_casar_arremesso_com_detonacao` em `parse.py`**

Adicionar perto de `granadas_com_duracao`/`granadas_instantaneas` (linha ~616). Implementação
de referência (ajustar janela/critério exato conforme achado no Step 1):

```python
def _casar_arremesso_com_detonacao(fires, detonates, janela_ticks=200):
    """{(detonate_tick, thrower): fire_tick} — casa cada detonação com o weapon_fire mais
    próximo (e anterior) do MESMO jogador, dentro de uma janela (voo da granada não passa
    de poucos segundos). Detonação sem fire correspondente (raro, ex.: round cortado) fica
    de fora — nesse caso o lineup não tem posição de arremesso, só de aterrissagem."""
    por_thrower = {}
    for f in fires:
        por_thrower.setdefault(f["thrower"], []).append(f["tick"])
    for ticks in por_thrower.values():
        ticks.sort()

    casados = {}
    for d in detonates:
        candidatos = por_thrower.get(d["thrower"], [])
        melhor = None
        for t in candidatos:
            if t <= d["tick"] and d["tick"] - t <= janela_ticks:
                melhor = t
        if melhor is not None:
            casados[(d["tick"], d["thrower"])] = melhor
    return casados
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
cd coletor && .venv/Scripts/python.exe -m pytest tests/test_parse.py -k casar_arremesso -v
```
Esperado: PASS.

- [ ] **Step 6: Ligar a correlação em `extract_replay()`**

Modificar a seção "Utilitárias + bomba" (linha 606+) pra: (a) capturar `weapon_fire` dos 4 tipos
de granada com `user_steamid`; (b) capturar `user_steamid` também nos eventos de detonação
(hoje só `x`/`y`/tick são lidos); (c) casar via `_casar_arremesso_com_detonacao`; (d) consultar
posição/ângulo do arremessador nos ticks de fire via `parser.parse_ticks(["X","Y","yaw","pitch"], ticks=[...])`
(uma chamada só, batched, com todos os ticks de fire únicos — mesmo padrão de performance já
usado pro snapshot de `team_num`); (e) anexar `thrower`/`throwerX`/`throwerY`/`throwerYaw`/
`throwerPitch` em cada item de `smokes`/`fires`/`flashes`/`hes` (`None` quando não casou).

- [ ] **Step 7: Rodar a suite inteira**

```bash
cd coletor && .venv/Scripts/python.exe -m pytest -q
```
Esperado: todos passam (testes de `extract_replay`/`build_replay` existentes não checam
igualdade estrita do dict completo).

- [ ] **Step 8: Validar contra a demo real usada na investigação**

Rodar `extract_replay()` na mesma demo do Step 1 e conferir visualmente que pelo menos 90% das
granadas de um round específico saíram com `thrower`/`throwerX`/`throwerY` preenchidos (não
`None`) — confirma que a janela/correlação está funcionando na prática, não só no teste
sintético.

- [ ] **Step 9: Commit**

```bash
git add coletor/src/coletor/parse.py coletor/tests/test_parse.py
git commit -m "feat: captura posicao/angulo de arremesso de granada (base pra lineup)"
```

---

## Task 4: Coletor — gravar `lineups` e nome de time no Postgres

**Files:**
- Modify: `coletor/src/coletor/db.py`
- Test: `coletor/tests/test_storage_db.py`

**Interfaces:**
- Consumes: `parsed["team_a_name"]`, `parsed["team_b_name"]` (Task 2); `parsed["lineups"]`
  (lista de dict — ver formato abaixo, montado pela Task 5 dentro de `transform.py`/`main.py`
  a partir do que a Task 3 devolve).
- Produces: `_write_lineups(cur, match_id, lineups)`; `_insert_match` passa a gravar
  `team_a_name`/`team_b_name`.

Formato esperado de cada item de `parsed["lineups"]`:
```python
{
    "round_number": 5, "map": "de_mirage", "tipo": "smoke",
    "thrower_steam_id": "765...", "thrower_nick": "bronze",
    "thrower_x": 100.0, "thrower_y": 200.0, "thrower_yaw": 45.0, "thrower_pitch": -10.0,
    "target_x": 300.0, "target_y": 400.0, "tick": 5000, "origem": "grupo",
}
```

- [ ] **Step 1: Escrever o teste de `_write_lineups`**

```python
# em coletor/tests/test_storage_db.py
def test_store_parsed_grava_lineups():
    conn = FakeConn()
    parsed = _parsed()
    parsed["lineups"] = [{
        "round_number": 5, "map": "de_mirage", "tipo": "smoke",
        "thrower_steam_id": "A", "thrower_nick": "bronze",
        "thrower_x": 100.0, "thrower_y": 200.0, "thrower_yaw": 45.0, "thrower_pitch": -10.0,
        "target_x": 300.0, "target_y": 400.0, "tick": 5000, "origem": "grupo",
    }]
    db.store_parsed(conn, parsed, share_code="CSGO-x", source="upload")
    insert = next(c for c in conn.calls if c[0].startswith("insert into lineups"))
    assert insert[1] == (
        "00000000-0000-0000-0000-000000000001", 5, "de_mirage", "smoke",
        "A", "bronze", 100.0, 200.0, 45.0, -10.0, 300.0, 400.0, 5000, "grupo",
    )


def test_store_parsed_grava_nome_de_time():
    conn = FakeConn()
    parsed = _parsed()
    parsed["team_a_name"] = "FaZe"
    parsed["team_b_name"] = "Vitality"
    db.store_parsed(conn, parsed, share_code="CSGO-x", source="pro")
    match_call = next(c for c in conn.calls if c[0].startswith("insert into matches"))
    assert "FaZe" in match_call[1]
    assert "Vitality" in match_call[1]
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd coletor && .venv/Scripts/python.exe -m pytest tests/test_storage_db.py -k "lineups or nome_de_time" -v
```
Esperado: FAIL (`test_store_parsed_grava_lineups` sem insert de lineups; `nome_de_time` com
`None` no lugar de "FaZe"/"Vitality").

- [ ] **Step 3: Implementar `_write_lineups` em `db.py`**

Adicionar após `_write_kill_positions` (linha 274):

```python
def _write_lineups(cur, match_id, lineups):
    cur.execute("delete from lineups where match_id = %s", (match_id,))
    for l in lineups:
        cur.execute(
            """
            insert into lineups
              (match_id, round_number, map, tipo, thrower_steam_id, thrower_nick,
               thrower_x, thrower_y, thrower_yaw, thrower_pitch, target_x, target_y,
               tick, origem)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                match_id, l["round_number"], l["map"], l["tipo"],
                l["thrower_steam_id"], l.get("thrower_nick", ""),
                l["thrower_x"], l["thrower_y"], l.get("thrower_yaw", 0), l.get("thrower_pitch", 0),
                l["target_x"], l["target_y"], l["tick"], l["origem"],
            ),
        )
```

Ligar em `store_parsed` (linha 283, junto dos outros `_write_*`):

```python
_write_lineups(cur, match_id, parsed.get("lineups", []))
```

- [ ] **Step 4: Passar `team_a_name`/`team_b_name` no `_insert_match`**

Em `_insert_match` (`coletor/src/coletor/db.py`), no bloco `update` (linhas 42-62), trocar:

```python
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
```

por:

```python
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
```

E no bloco `insert` (linhas 74-101), trocar:

```python
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
```

por:

```python
    cur.execute(
        f"""
        insert into matches (share_code, source, map, score_a, score_b, played_at, demo_url, replay_url, status, fingerprint, team_a_name, team_b_name)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
        ),
    )
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
cd coletor && .venv/Scripts/python.exe -m pytest -q
```
Esperado: todos passam.

- [ ] **Step 6: Commit**

```bash
git add coletor/src/coletor/db.py coletor/tests/test_storage_db.py
git commit -m "feat: grava lineups e nome de time no Postgres"
```

---

## Task 5: Coletor — ligar extração de lineup no pipeline + montar `parsed["lineups"]`

**Files:**
- Modify: `coletor/src/coletor/main.py` (`ingest_demo()`, linha 210-264)

**Interfaces:**
- Consumes: `rdata["smokes"]`/`rdata["fires"]`/`rdata["flashes"]`/`rdata["hes"]` (Task 3, cada
  item agora com `thrower`/`throwerX`/`throwerY`/`throwerYaw`/`throwerPitch`); `replay.names`
  (nick por steamid, já montado em `build_replay`).
- Produces: `parsed["lineups"]` no formato esperado pela Task 4, montado dentro de
  `ingest_demo()` a partir de `rdata` (que já é extraído ali pra gerar o replay JSON — não
  precisa de nova passada no parser).

- [ ] **Step 1: Montar `parsed["lineups"]` em `ingest_demo()`**

Dentro do bloco `try` que já chama `parsemod.extract_replay(path)` (linha 227-240), depois de
`replay_json` ser montado, adicionar a montagem de `parsed["lineups"]` combinando os 4 tipos —
só inclui item com `thrower` preenchido (sem correlação = sem lineup útil, mas ainda conta no
mapa de calor via `rdata` normalmente):

```python
TIPO_POR_CHAVE = {"smokes": "smoke", "fires": "molotov", "flashes": "flash", "hes": "he"}
lineups = []
for chave, tipo in TIPO_POR_CHAVE.items():
    for g in rdata.get(chave, []):
        if not g.get("thrower"):
            continue
        lineups.append({
            "round_number": g["round"], "map": parsed["map"], "tipo": tipo,
            "thrower_steam_id": g["thrower"],
            "thrower_nick": replay_json["names"].get(g["thrower"], "") if replay_json else "",
            "thrower_x": g["throwerX"], "thrower_y": g["throwerY"],
            "thrower_yaw": g.get("throwerYaw", 0), "thrower_pitch": g.get("throwerPitch", 0),
            "target_x": g["x"], "target_y": g["y"],
            "tick": g.get("tickStart", g.get("tick")),
            "origem": "pro" if source == "pro" else "grupo",
        })
parsed["lineups"] = lineups
```

Isso entra logo antes do `except Exception as e` que já existe nesse bloco (linha 239) — se a
extração de replay falhar, `lineups` simplesmente fica ausente de `parsed` (mesmo
comportamento de fallback que já existe pro replay/clutch).

- [ ] **Step 2: Rodar a suite inteira do coletor**

```bash
cd coletor && .venv/Scripts/python.exe -m pytest -q
```
Esperado: todos passam.

- [ ] **Step 3: Commit**

```bash
git add coletor/src/coletor/main.py
git commit -m "feat: monta parsed[lineups] a partir do replay extraido"
```

---

## Task 6: Coletor — extração de `.rar` (demo do HLTV)

**Files:**
- Create: `coletor/src/coletor/rar_extract.py`
- Test: `coletor/tests/test_rar_extract.py`
- Modify: `coletor/requirements.txt` (adicionar `rarfile`)

**Interfaces:**
- Produces: `extrair_dem_de_rar(caminho_rar, destino_dir) -> Path` — caminho do `.dem` extraído.

- [ ] **Step 1: Escrever o teste**

Usa uma fixture `.rar` pequena de verdade (não dá pra fazer fixture de rar sintética como texto
puro — `.rar` é formato binário proprietário). Criar `coletor/tests/fixtures/exemplo.rar`
contendo um arquivo `partida.dem` de 20 bytes de conteúdo arbitrário (`b"conteudo de teste"`),
gerado uma vez localmente com `unar`/7-Zip e commitado no repo (arquivo pequeno, poucos KB).

```python
# coletor/tests/test_rar_extract.py
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor.rar_extract import extrair_dem_de_rar

FIXTURE = Path(__file__).parent / "fixtures" / "exemplo.rar"


def test_extrai_dem_do_rar():
    with tempfile.TemporaryDirectory() as tmp:
        caminho = extrair_dem_de_rar(FIXTURE, Path(tmp))
        assert caminho.suffix == ".dem"
        assert caminho.read_bytes() == b"conteudo de teste"


def test_rar_sem_dem_dentro_da_erro():
    import zipfile

    with tempfile.TemporaryDirectory() as tmp:
        # .rar "vazio de .dem" simulado com um arquivo qualquer não-.dem — testa só o
        # caminho de erro da função, não precisa ser um .rar real pra esse caso.
        falso = Path(tmp) / "sem_dem.rar"
        falso.write_bytes(b"nao e rar de verdade")
        try:
            extrair_dem_de_rar(falso, Path(tmp) / "saida")
            assert False, "deveria ter levantado erro"
        except Exception:
            pass
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd coletor && .venv/Scripts/python.exe -m pytest tests/test_rar_extract.py -v
```
Esperado: FAIL, `ModuleNotFoundError: No module named 'coletor.rar_extract'`.

- [ ] **Step 3: Adicionar dependência**

Em `coletor/requirements.txt`, adicionar linha `rarfile`.
Rodar: `cd coletor && .venv/Scripts/pip.exe install rarfile`.

- [ ] **Step 4: Implementar `rar_extract.py`**

```python
"""Extração de .dem de dentro do .rar que o HLTV distribui (demo de partida
profissional) — usa `unar` (licença livre, BSD) como backend, não o `unrar`
proprietário, pra rodar sem problema no runner do GitHub Actions."""


def extrair_dem_de_rar(caminho_rar, destino_dir):
    """Extrai o primeiro .dem de dentro do .rar em `caminho_rar` pra `destino_dir`.
    Devolve o Path do .dem extraído. Levanta RuntimeError se não achar nenhum .dem."""
    import rarfile
    from pathlib import Path

    destino_dir = Path(destino_dir)
    destino_dir.mkdir(parents=True, exist_ok=True)
    rarfile.UNAR_TOOL = "unar"

    with rarfile.RarFile(str(caminho_rar)) as rf:
        dem_nomes = [n for n in rf.namelist() if n.lower().endswith(".dem")]
        if not dem_nomes:
            raise RuntimeError(f"nenhum .dem encontrado dentro de {caminho_rar}")
        rf.extract(dem_nomes[0], path=str(destino_dir))
        return destino_dir / dem_nomes[0]
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
cd coletor && .venv/Scripts/python.exe -m pytest tests/test_rar_extract.py -v
```
Esperado: PASS nos 2 testes (o `unar` precisa estar instalado no ambiente local pra
`test_extrai_dem_do_rar` passar — documentar isso no README do coletor).

- [ ] **Step 6: Documentar a dependência de sistema**

Adicionar uma linha no `coletor/README.md` (ou criar a seção se não existir) explicando que
`unar` precisa estar no PATH (`apt-get install unar` no CI, `brew install unar`/similar local).

- [ ] **Step 7: Commit**

```bash
git add coletor/src/coletor/rar_extract.py coletor/tests/test_rar_extract.py coletor/tests/fixtures/exemplo.rar coletor/requirements.txt coletor/README.md
git commit -m "feat: extracao de .dem de dentro do .rar (demo do HLTV)"
```

---

## Task 7: Coletor — comando `processar-fila-pro`

**Files:**
- Modify: `coletor/src/coletor/db.py` (novas funções de fila)
- Modify: `coletor/src/coletor/main.py` (`cmd_processar_fila_pro` + wiring no `main()`)
- Test: `coletor/tests/test_storage_db.py`

**Interfaces:**
- Consumes: `rar_extract.extrair_dem_de_rar` (Task 6), `ingest_demo` (já existe).
- Produces: `dbmod.listar_fila_pro_pendente(conn) -> [(id, hltv_url)]`,
  `dbmod.atualizar_fila_pro(conn, id, status, match_id=None, erro=None)`,
  `cmd_processar_fila_pro(config, conn)`.

- [ ] **Step 1: Escrever o teste das funções de fila em `db.py`**

```python
def test_listar_fila_pro_pendente():
    conn = FakeConn()
    conn.fila_rows = [("f1", "https://hltv.org/download/demo/123")]
    resultado = db.listar_fila_pro_pendente(conn)
    assert resultado == [("f1", "https://hltv.org/download/demo/123")]
    assert any("partidas_pro_fila" in c[0] and "pendente" in c[0] for c in conn.calls)


def test_atualizar_fila_pro_concluida():
    conn = FakeConn()
    db.atualizar_fila_pro(conn, "f1", "concluida", match_id="m1")
    update = next(c for c in conn.calls if c[0].startswith("update partidas_pro_fila"))
    assert update[1] == ("concluida", "m1", None, "f1")
    assert conn.commits == 1
```

Isso exige que `FakeCursor.fetchall()` exista e que `FakeConn` aceite um atributo
`fila_rows` configurável pro cursor devolver — adicionar isso ao `FakeCursor`/`FakeConn` já
existentes em `test_storage_db.py`:

```python
# no FakeCursor, adicionar:
def fetchall(self):
    if self._last.startswith("select id, hltv_url from partidas_pro_fila"):
        return self.conn.fila_rows
    return []

# no FakeConn.__init__, adicionar:
self.fila_rows = []
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd coletor && .venv/Scripts/python.exe -m pytest tests/test_storage_db.py -k fila_pro -v
```
Esperado: FAIL, `AttributeError: module 'coletor.db' has no attribute 'listar_fila_pro_pendente'`.

- [ ] **Step 3: Implementar em `db.py`**

Adicionar após `set_last_share_code` (linha 353):

```python
def listar_fila_pro_pendente(conn):
    with conn.cursor() as cur:
        cur.execute(
            "select id, hltv_url from partidas_pro_fila where status = 'pendente' order by adicionado_em"
        )
        return cur.fetchall()


def atualizar_fila_pro(conn, fila_id, status, match_id=None, erro=None):
    with conn.cursor() as cur:
        cur.execute(
            "update partidas_pro_fila set status = %s, match_id = %s, erro = %s where id = %s",
            (status, match_id, erro, fila_id),
        )
    conn.commit()
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd coletor && .venv/Scripts/python.exe -m pytest -q
```
Esperado: todos passam.

- [ ] **Step 5: Implementar `cmd_processar_fila_pro` em `main.py`**

Adicionar após `cmd_cleanup` (linha 207):

```python
def cmd_processar_fila_pro(config, conn):
    """Processa a fila de partida profissional: baixa .rar do HLTV, extrai o .dem,
    ingere pelo mesmo pipeline de sempre (source='pro'). Roda no job agendado (não numa
    request HTTP do site — a Vercel não aguenta baixar/parsear demo grande síncrono)."""
    import tempfile
    import urllib.request
    from pathlib import Path

    from . import rar_extract

    pendentes = dbmod.listar_fila_pro_pendente(conn)
    if not pendentes:
        print("processar-fila-pro: nenhuma partida pendente")
        return 0

    total = 0
    for fila_id, hltv_url in pendentes:
        dbmod.atualizar_fila_pro(conn, fila_id, "baixando")
        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp = Path(tmp)
                rar_path = tmp / "demo.rar"
                print(f"  {fila_id}: baixando {hltv_url}")
                with urllib.request.urlopen(hltv_url, timeout=120) as resp, open(rar_path, "wb") as out:
                    out.write(resp.read())

                dbmod.atualizar_fila_pro(conn, fila_id, "processando")
                dem_path = rar_extract.extrair_dem_de_rar(rar_path, tmp / "extraido")
                mid = ingest_demo(config, conn, dem_path, source="pro", upload=True)

                dbmod.atualizar_fila_pro(conn, fila_id, "concluida", match_id=mid)
                print(f"  {fila_id}: concluida ({mid})")
                total += 1
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            dbmod.atualizar_fila_pro(conn, fila_id, "falhou", erro=str(e)[:500])
            print(f"  {fila_id}: FALHOU ({e})")

    print(f"processar-fila-pro: {total} partida(s) processada(s)")
    return total
```

Wire no `main()`: adicionar `sub.add_parser("processar-fila-pro")` (perto da linha 289) e o
`elif args.cmd == "processar-fila-pro": cmd_processar_fila_pro(config, conn)` (perto da
linha 314).

- [ ] **Step 6: Rodar a suite inteira**

```bash
cd coletor && .venv/Scripts/python.exe -m pytest -q
```
Esperado: todos passam.

- [ ] **Step 7: Commit**

```bash
git add coletor/src/coletor/db.py coletor/src/coletor/main.py coletor/tests/test_storage_db.py
git commit -m "feat: comando processar-fila-pro (baixa+extrai+ingere partida do HLTV)"
```

---

## Task 8: GitHub Actions — rodar `processar-fila-pro` no job agendado

**Files:**
- Modify: `.github/workflows/coletor.yml`

**Interfaces:**
- Consumes: comando `processar-fila-pro` (Task 7).

- [ ] **Step 1: Adicionar instalação do `unar` e o step novo**

No job `sincroniza`, adicionar um step de instalação do `unar` logo após o checkout (antes de
"Instalar dependências do Coletor"):

```yaml
      - name: Instalar unar (extração de .rar)
        run: sudo apt-get update && sudo apt-get install -y unar
```

E adicionar um step novo, depois de "Limpar demos antigas do R2 (90+ dias)" (fim do job
`sincroniza`):

```yaml
      - name: Processar fila de partidas profissionais (HLTV)
        working-directory: coletor
        env:
          PYTHONPATH: src
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
        run: python -m coletor.main processar-fila-pro
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/coletor.yml
git commit -m "feat: processa fila de partida pro no job agendado do coletor"
```

---

## Task 9: Server — rota `GET /api/lineups`

**Files:**
- Create: `site/server/src/routes/lineups.js`
- Modify: `site/server/src/app.js:6,63` (import + `app.use`)
- Test: `site/server/test/lineups.test.js`

**Interfaces:**
- Produces: `createLineupsRouter({ db, requireAuth })` — mesmo formato de factory dos routers
  existentes (`createMatchesRouter`, etc.).

- [ ] **Step 1: Escrever o teste**

```javascript
// site/server/test/lineups.test.js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos' }
const cookie = `resenha_token=${signToken({ steamId: '765', isAdmin: false }, config.jwtSecret)}`

function appWith(handlers) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      for (const [needle, rows] of handlers) {
        if (sql.includes(needle)) return Promise.resolve({ rows })
      }
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/lineups', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/lineups')).status).toBe(401)
  })

  it('lista filtrada por mapa e tipo', async () => {
    const { app, db } = appWith([
      ['from lineups', [{
        id: 'l1', map: 'de_mirage', tipo: 'smoke',
        thrower_steam_id: '765', thrower_nick: 'bronze',
        thrower_x: 1, thrower_y: 2, thrower_yaw: 3, thrower_pitch: 4,
        target_x: 5, target_y: 6, origem: 'grupo',
      }]],
    ])
    const res = await request(app).get('/api/lineups?map=de_mirage&tipo=smoke').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ map: 'de_mirage', tipo: 'smoke', throwerNick: 'bronze', origem: 'grupo' })
    const sql = db.query.mock.calls[0][0]
    expect(sql).toContain('map = $')
    expect(sql).toContain('tipo = $')
  })

  it('mapa/tipo invalido: ignora o filtro em vez de quebrar', async () => {
    const { app } = appWith([['from lineups', []]])
    const res = await request(app).get('/api/lineups?tipo=algo-invalido').set('Cookie', cookie)
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd site/server && npx vitest run test/lineups.test.js
```
Esperado: FAIL (rota 404, `createApp` não monta `/api/lineups` ainda).

- [ ] **Step 3: Implementar `routes/lineups.js`**

```javascript
import { Router } from 'express'

const TIPOS_VALIDOS = new Set(['smoke', 'flash', 'he', 'molotov'])

export function createLineupsRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const cond = []
    const params = []
    const { map, tipo, origem } = req.query
    if (map && /^[a-z0-9_]+$/.test(map)) {
      params.push(map)
      cond.push(`map = $${params.length}`)
    }
    if (tipo && TIPOS_VALIDOS.has(tipo)) {
      params.push(tipo)
      cond.push(`tipo = $${params.length}`)
    }
    if (origem === 'grupo' || origem === 'pro') {
      params.push(origem)
      cond.push(`origem = $${params.length}`)
    }
    const where = cond.length ? `where ${cond.join(' and ')}` : ''
    const { rows } = await db.query(
      `select id, match_id, round_number, map, tipo, thrower_steam_id, thrower_nick,
              thrower_x, thrower_y, thrower_yaw, thrower_pitch, target_x, target_y,
              tick, origem
       from lineups ${where} order by created_at desc limit 300`,
      params,
    )
    res.json(
      rows.map((l) => ({
        id: l.id,
        matchId: l.match_id,
        roundNumber: l.round_number,
        map: l.map,
        tipo: l.tipo,
        throwerSteamId: l.thrower_steam_id,
        throwerNick: l.thrower_nick,
        throwerX: Number(l.thrower_x),
        throwerY: Number(l.thrower_y),
        throwerYaw: Number(l.thrower_yaw),
        throwerPitch: Number(l.thrower_pitch),
        targetX: Number(l.target_x),
        targetY: Number(l.target_y),
        tick: l.tick,
        origem: l.origem,
      })),
    )
  })

  return router
}
```

- [ ] **Step 4: Montar no `app.js`**

Adicionar import (linha 6, junto dos outros): `import { createLineupsRouter } from './routes/lineups.js'`

Adicionar `app.use` (linha 63, junto dos outros): `app.use('/api/lineups', createLineupsRouter({ db, requireAuth }))`

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
cd site/server && npx vitest run test/lineups.test.js
```
Esperado: PASS nos 3 testes.

- [ ] **Step 6: Rodar a suite inteira do server**

```bash
cd site/server && npm test
```
Esperado: todos passam (nenhum teste existente toca `/api/lineups`).

- [ ] **Step 7: Commit**

```bash
git add site/server/src/routes/lineups.js site/server/src/app.js site/server/test/lineups.test.js
git commit -m "feat: rota GET /api/lineups (biblioteca de granadas filtravel)"
```

---

## Task 10: Server — rotas `/api/taticas`

**Files:**
- Create: `site/server/src/routes/taticas.js`
- Modify: `site/server/src/app.js`
- Test: `site/server/test/taticas.test.js`

**Interfaces:**
- Produces: `createTaticasRouter({ db, requireAuth })`.
- Rotas: `GET /` (lista, filtro `map`+`status`), `POST /` (sugerir — qualquer autenticado),
  `PATCH /:id` (aprovar/rejeitar — admin).

- [ ] **Step 1: Escrever o teste**

```javascript
// site/server/test/taticas.test.js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos' }
const cookieJogador = `resenha_token=${signToken({ steamId: '765', isAdmin: false }, config.jwtSecret)}`
const cookieAdmin = `resenha_token=${signToken({ steamId: '999', isAdmin: true }, config.jwtSecret)}`

function appWith(handlers) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      for (const [needle, rows] of handlers) {
        if (sql.includes(needle)) return Promise.resolve({ rows })
      }
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/taticas', () => {
  it('lista só aprovadas por padrao', async () => {
    const { app, db } = appWith([['from taticas', []]])
    await request(app).get('/api/taticas?map=de_mirage').set('Cookie', cookieJogador)
    expect(db.query.mock.calls[0][0]).toContain("status = 'aprovada'")
  })
})

describe('POST /api/taticas', () => {
  it('qualquer jogador autenticado pode sugerir, entra como sugerida', async () => {
    const { app, db } = appWith([
      ['insert into taticas', [{ id: 't1' }]],
    ])
    const res = await request(app).post('/api/taticas').set('Cookie', cookieJogador).send({
      nome: 'Execução B', descricao: 'bronze entra seco', map: 'de_mirage',
      matchId: 'm1', roundNumber: 5,
    })
    expect(res.status).toBe(201)
    const insert = db.query.mock.calls.find((c) => c[0].includes('insert into taticas'))
    expect(insert[1]).toContain('sugerida')
  })

  it('sem nome: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/taticas').set('Cookie', cookieJogador).send({ map: 'de_mirage', matchId: 'm1', roundNumber: 1 })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/taticas/:id', () => {
  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    const res = await request(app).patch('/api/taticas/t1').set('Cookie', cookieJogador).send({ status: 'aprovada' })
    expect(res.status).toBe(403)
  })

  it('admin aprova', async () => {
    const { app, db } = appWith([['update taticas', [{ id: 't1' }]]])
    const res = await request(app).patch('/api/taticas/t1').set('Cookie', cookieAdmin).send({ status: 'aprovada' })
    expect(res.status).toBe(200)
    expect(db.query.mock.calls[0][1]).toEqual(['aprovada', 't1'])
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd site/server && npx vitest run test/taticas.test.js
```
Esperado: FAIL (404 em tudo).

- [ ] **Step 3: Implementar `routes/taticas.js`**

```javascript
import { Router } from 'express'
import { requireAdmin } from '../auth/middleware.js'

export function createTaticasRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const cond = ["status = 'aprovada'"]
    const params = []
    const { map, status } = req.query
    if (map && /^[a-z0-9_]+$/.test(map)) {
      params.push(map)
      cond.push(`map = $${params.length}`)
    }
    if (status === 'sugerida' || status === 'aprovada' || status === 'rejeitada') {
      cond[0] = `status = $${params.length + 1}`
      params.push(status)
    }
    const { rows } = await db.query(
      `select t.id, t.nome, t.descricao, t.map, t.match_id, t.round_number, t.status,
              t.criado_por, t.criado_em, p.nick as criado_por_nick
       from taticas t
       left join players p on p.steam_id64 = t.criado_por
       where ${cond.join(' and ')}
       order by t.criado_em desc limit 200`,
      params,
    )
    res.json(
      rows.map((t) => ({
        id: t.id, nome: t.nome, descricao: t.descricao, map: t.map,
        matchId: t.match_id, roundNumber: t.round_number, status: t.status,
        criadoPor: t.criado_por, criadoPorNick: t.criado_por_nick, criadoEm: t.criado_em,
      })),
    )
  })

  router.post('/', requireAuth, async (req, res) => {
    const nome = String(req.body?.nome ?? '').trim()
    const map = String(req.body?.map ?? '').trim()
    const matchId = String(req.body?.matchId ?? '').trim()
    const roundNumber = Number(req.body?.roundNumber)
    if (!nome || !map || !matchId || !Number.isInteger(roundNumber)) {
      return res.status(400).json({ erro: 'nome, map, matchId e roundNumber são obrigatórios' })
    }
    const descricao = String(req.body?.descricao ?? '').trim()
    const { rows } = await db.query(
      `insert into taticas (nome, descricao, map, match_id, round_number, status, criado_por)
       values ($1, $2, $3, $4, $5, 'sugerida', $6)
       returning id`,
      [nome, descricao, map, matchId, roundNumber, req.player.steamId],
    )
    res.status(201).json({ id: rows[0].id, status: 'sugerida' })
  })

  router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
    const status = req.body?.status
    if (status !== 'aprovada' && status !== 'rejeitada') {
      return res.status(400).json({ erro: 'status deve ser aprovada ou rejeitada' })
    }
    await db.query('update taticas set status = $1 where id = $2', [status, req.params.id])
    res.json({ ok: true, status })
  })

  return router
}
```

- [ ] **Step 4: Montar no `app.js`**

Import: `import { createTaticasRouter } from './routes/taticas.js'`
Use: `app.use('/api/taticas', createTaticasRouter({ db, requireAuth }))`

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
cd site/server && npx vitest run test/taticas.test.js
```
Esperado: PASS em todos.

- [ ] **Step 6: Rodar a suite inteira**

```bash
cd site/server && npm test
```

- [ ] **Step 7: Commit**

```bash
git add site/server/src/routes/taticas.js site/server/src/app.js site/server/test/taticas.test.js
git commit -m "feat: rotas de taticas (listar, sugerir, aprovar/rejeitar)"
```

---

## Task 11: Server — rotas `/api/partidas-pro-fila`

**Files:**
- Create: `site/server/src/routes/partidasPro.js`
- Modify: `site/server/src/app.js`
- Test: `site/server/test/partidasPro.test.js`

**Interfaces:**
- Produces: `createPartidasProRouter({ db, requireAuth })`.
- Rotas: `GET /` (status da fila — admin), `POST /` (adicionar link — admin).

- [ ] **Step 1: Escrever o teste**

```javascript
// site/server/test/partidasPro.test.js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos' }
const cookieJogador = `resenha_token=${signToken({ steamId: '765', isAdmin: false }, config.jwtSecret)}`
const cookieAdmin = `resenha_token=${signToken({ steamId: '999', isAdmin: true }, config.jwtSecret)}`

function appWith(handlers) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      for (const [needle, rows] of handlers) {
        if (sql.includes(needle)) return Promise.resolve({ rows })
      }
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/partidas-pro-fila', () => {
  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/partidas-pro-fila').set('Cookie', cookieJogador)).status).toBe(403)
  })

  it('admin ve a fila', async () => {
    const { app } = appWith([
      ['from partidas_pro_fila', [{ id: 'f1', hltv_url: 'https://hltv.org/x', status: 'pendente', match_id: null, erro: null }]],
    ])
    const res = await request(app).get('/api/partidas-pro-fila').set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ id: 'f1', status: 'pendente' })
  })
})

describe('POST /api/partidas-pro-fila', () => {
  it('adiciona link novo', async () => {
    const { app, db } = appWith([['insert into partidas_pro_fila', [{ id: 'f2' }]]])
    const res = await request(app).post('/api/partidas-pro-fila').set('Cookie', cookieAdmin).send({ hltvUrl: 'https://hltv.org/download/demo/999' })
    expect(res.status).toBe(201)
    expect(db.query.mock.calls[0][1][1]).toBe('999') // steamId de quem adicionou
  })

  it('sem url: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/partidas-pro-fila').set('Cookie', cookieAdmin).send({})
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd site/server && npx vitest run test/partidasPro.test.js
```
Esperado: FAIL.

- [ ] **Step 3: Implementar `routes/partidasPro.js`**

```javascript
import { Router } from 'express'
import { requireAdmin } from '../auth/middleware.js'

export function createPartidasProRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, requireAdmin, async (req, res) => {
    const { rows } = await db.query(
      'select id, hltv_url, status, match_id, erro, adicionado_por, adicionado_em from partidas_pro_fila order by adicionado_em desc',
    )
    res.json(
      rows.map((f) => ({
        id: f.id, hltvUrl: f.hltv_url, status: f.status,
        matchId: f.match_id, erro: f.erro,
        adicionadoPor: f.adicionado_por, adicionadoEm: f.adicionado_em,
      })),
    )
  })

  router.post('/', requireAuth, requireAdmin, async (req, res) => {
    const hltvUrl = String(req.body?.hltvUrl ?? '').trim()
    if (!/^https:\/\/.+/.test(hltvUrl)) {
      return res.status(400).json({ erro: 'hltvUrl deve ser um link válido' })
    }
    const { rows } = await db.query(
      "insert into partidas_pro_fila (hltv_url, adicionado_por) values ($1, $2) returning id",
      [hltvUrl, req.player.steamId],
    )
    res.status(201).json({ id: rows[0].id, status: 'pendente' })
  })

  return router
}
```

- [ ] **Step 4: Montar no `app.js`**

Import: `import { createPartidasProRouter } from './routes/partidasPro.js'`
Use: `app.use('/api/partidas-pro-fila', createPartidasProRouter({ db, requireAuth }))`

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
cd site/server && npx vitest run test/partidasPro.test.js
```

- [ ] **Step 6: Rodar a suite inteira**

```bash
cd site/server && npm test
```

- [ ] **Step 7: Commit**

```bash
git add site/server/src/routes/partidasPro.js site/server/src/app.js site/server/test/partidasPro.test.js
git commit -m "feat: rotas da fila de partida pro (listar, adicionar)"
```

---

## Task 12: Client — página Granadas (Biblioteca)

**Files:**
- Create: `site/client/src/pages/Granadas.jsx`
- Modify: `site/client/src/App.jsx:6,36` (import + `<Route>`)
- Modify: `site/client/src/components/Shell.jsx:4-11,49-54` (item de nav)

**Interfaces:**
- Consumes: `GET /api/lineups?map=&tipo=&origem=` (Task 9).

- [ ] **Step 1: Implementar `Granadas.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { nomeMapa } from '../lib/format.js'

const MAPAS = ['de_mirage', 'de_dust2', 'de_inferno', 'de_nuke', 'de_overpass', 'de_vertigo', 'de_ancient', 'de_anubis', 'de_train']
const TIPOS = [['', 'Todas'], ['smoke', 'Smoke'], ['flash', 'Flash'], ['he', 'HE'], ['molotov', 'Molotov']]

export default function Granadas() {
  const [mapa, setMapa] = useState(MAPAS[0])
  const [tipo, setTipo] = useState('')
  const [lineups, setLineups] = useState(null)

  useEffect(() => {
    setLineups(null)
    const params = new URLSearchParams({ map: mapa })
    if (tipo) params.set('tipo', tipo)
    fetch(`/api/lineups?${params}`)
      .then((res) => res.json())
      .then(setLineups)
      .catch(() => setLineups([]))
  }, [mapa, tipo])

  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">Granadas</h2>
      <div className="flex flex-wrap gap-3">
        <select value={mapa} onChange={(e) => setMapa(e.target.value)} className="rounded border border-borda bg-superficie px-2 py-1 font-mono text-sm">
          {MAPAS.map((m) => <option key={m} value={m}>{nomeMapa(m)}</option>)}
        </select>
        <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
          {TIPOS.map(([v, label]) => (
            <button
              key={v || 'todas'}
              onClick={() => setTipo(v)}
              className={`px-3 py-1.5 transition-colors ${tipo === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {!lineups && <p className="font-mono text-sm text-texto-fraco">Carregando…</p>}
      {lineups && lineups.length === 0 && <p className="font-mono text-sm text-texto-fraco">Nenhuma granada registrada pra esse filtro ainda.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {lineups?.map((l) => (
          <div key={l.id} className="panel-cut border border-borda bg-superficie p-3">
            <p className="font-display text-sm font-semibold uppercase text-texto">{l.tipo}</p>
            <p className="font-mono text-xs text-texto-fraco">{l.throwerNick || l.throwerSteamId}</p>
            <span className={`mt-1 inline-block panel-cut-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${l.origem === 'pro' ? 'border border-destaque/40 bg-destaque/10 text-destaque' : 'border border-borda text-texto-fraco'}`}>
              {l.origem === 'pro' ? 'Pro' : 'Grupo'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Rota em `App.jsx`**

Import (linha 6, junto dos outros): `import Granadas from './pages/Granadas.jsx'`
Route (linha 36, junto dos outros): `<Route path="/granadas" element={<RotaProtegida><Granadas /></RotaProtegida>} />`

- [ ] **Step 3: Item de nav em `Shell.jsx`**

Adicionar ao array `ITENS` (linha 4-11), entre `comparar` e `perfil`:
```javascript
{ to: '/granadas', label: 'Granadas', num: '06' },
```
E renumerar os itens seguintes (`Meu perfil` vira `07`, `Admin` vira `08` na linha 51).

- [ ] **Step 4: Build do client**

```bash
cd site/client && npx vite build
```
Esperado: build sem erro.

- [ ] **Step 5: Commit**

```bash
git add site/client/src/pages/Granadas.jsx site/client/src/App.jsx site/client/src/components/Shell.jsx
git commit -m "feat: pagina Granadas (biblioteca de lineup filtravel)"
```

---

## Task 13: Client — página Táticas + botão "sugerir" na Partida

**Files:**
- Create: `site/client/src/pages/Taticas.jsx`
- Modify: `site/client/src/App.jsx`
- Modify: `site/client/src/components/Shell.jsx`
- Modify: `site/client/src/pages/Partida.jsx` (componente `LinhaDoTempoRounds`, botão de sugestão)

**Interfaces:**
- Consumes: `GET /api/taticas?map=`, `POST /api/taticas` (Task 10).

- [ ] **Step 1: Implementar `Taticas.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { nomeMapa } from '../lib/format.js'
import ReplayViewer from '../components/ReplayViewer.jsx'

const MAPAS = ['de_mirage', 'de_dust2', 'de_inferno', 'de_nuke', 'de_overpass', 'de_vertigo', 'de_ancient', 'de_anubis', 'de_train']

function TaticaCard({ t }) {
  const [aberta, setAberta] = useState(false)
  const [replay, setReplay] = useState(null)

  function abrir() {
    setAberta((v) => !v)
    if (!replay) {
      fetch(`/api/matches/${t.matchId}/replay`).then((r) => r.json()).then(setReplay).catch(() => {})
    }
  }

  return (
    <div className="panel-cut border border-borda bg-superficie p-3">
      <button onClick={abrir} className="w-full text-left">
        <p className="font-display text-sm font-semibold uppercase text-texto">{t.nome}</p>
        <p className="font-mono text-xs text-texto-fraco">{t.descricao}</p>
        <p className="mt-1 font-mono text-[10px] uppercase text-texto-fraco/70">sugerida por {t.criadoPorNick || t.criadoPor}</p>
      </button>
      {aberta && replay && (
        <div className="mt-3">
          <ReplayViewer replay={replay} seek={{ round: t.roundNumber, frame: 0, key: `${t.id}-${Date.now()}` }} />
        </div>
      )}
    </div>
  )
}

export default function Taticas() {
  const [mapa, setMapa] = useState(MAPAS[0])
  const [taticas, setTaticas] = useState(null)

  useEffect(() => {
    setTaticas(null)
    fetch(`/api/taticas?map=${mapa}`).then((r) => r.json()).then(setTaticas).catch(() => setTaticas([]))
  }, [mapa])

  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">Táticas</h2>
      <select value={mapa} onChange={(e) => setMapa(e.target.value)} className="rounded border border-borda bg-superficie px-2 py-1 font-mono text-sm">
        {MAPAS.map((m) => <option key={m} value={m}>{nomeMapa(m)}</option>)}
      </select>
      {!taticas && <p className="font-mono text-sm text-texto-fraco">Carregando…</p>}
      {taticas && taticas.length === 0 && <p className="font-mono text-sm text-texto-fraco">Nenhuma tática aprovada nesse mapa ainda.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {taticas?.map((t) => <TaticaCard key={t.id} t={t} />)}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Rota em `App.jsx`**

Import: `import Taticas from './pages/Taticas.jsx'`
Route: `<Route path="/taticas" element={<RotaProtegida><Taticas /></RotaProtegida>} />`

- [ ] **Step 3: Item de nav em `Shell.jsx`**

Adicionar `{ to: '/taticas', label: 'Táticas', num: '07' }` ao array `ITENS`, ajustar
numeração dos itens seguintes.

- [ ] **Step 4: Botão "sugerir como tática" em `Partida.jsx`**

Dentro de `LinhaDoTempoRounds` (linha 130-166), adicionar um formulário curto que aparece ao
clicar num round (reaproveitando o `<div key={r.roundNumber}>` já existente pra rounds sem
highlight, linha 156-158) — trocar esse `<div>` por um `<button>` com um pequeno popover local
de "sugerir tática" (nome + descrição), chamando `POST /api/taticas` com `matchId`/`roundNumber`
vindos das props já disponíveis no componente (`m.id` precisa ser passado como nova prop
`matchId` de `Partida()` pra `LinhaDoTempoRounds`, já que hoje o componente só recebe
`rounds`/`highlights`/`timeDoGrupo`/`onClicarHighlight`/`replayDisponivel`).

- [ ] **Step 5: Build do client**

```bash
cd site/client && npx vite build
```

- [ ] **Step 6: Commit**

```bash
git add site/client/src/pages/Taticas.jsx site/client/src/App.jsx site/client/src/components/Shell.jsx site/client/src/pages/Partida.jsx
git commit -m "feat: pagina Taticas + botao sugerir tatica na Partida"
```

---

## Task 14: Client — página admin Partidas Pro + aprovação de táticas

**Files:**
- Create: `site/client/src/pages/PartidasPro.jsx`
- Modify: `site/client/src/App.jsx`
- Modify: `site/client/src/components/Shell.jsx` (link só quando `jogador?.isAdmin`, mesmo
  padrão do link "Admin" já existente)
- Modify: `site/client/src/pages/Admin.jsx` (seção de aprovação de táticas pendentes)

**Interfaces:**
- Consumes: `GET/POST /api/partidas-pro-fila` (Task 11), `GET /api/taticas?status=sugerida`,
  `PATCH /api/taticas/:id` (Task 10).

- [ ] **Step 1: Implementar `PartidasPro.jsx`**

```jsx
import { useEffect, useState } from 'react'

const CORES_STATUS = {
  pendente: 'text-texto-fraco', baixando: 'text-destaque', processando: 'text-destaque',
  concluida: 'text-sucesso', falhou: 'text-perigo',
}

export default function PartidasPro() {
  const [fila, setFila] = useState(null)
  const [url, setUrl] = useState('')
  const [erro, setErro] = useState(null)

  function carregar() {
    fetch('/api/partidas-pro-fila').then((r) => r.json()).then(setFila).catch(() => setFila([]))
  }

  useEffect(carregar, [])

  async function adicionar(e) {
    e.preventDefault()
    setErro(null)
    const res = await fetch('/api/partidas-pro-fila', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hltvUrl: url }),
    })
    if (res.ok) {
      setUrl('')
      carregar()
    } else {
      const body = await res.json().catch(() => ({}))
      setErro(body.erro ?? 'Erro ao adicionar.')
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">Partidas pro</h2>
      <form onSubmit={adicionar} className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Link do demo no HLTV"
          className="flex-1 rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
        />
        <button type="submit" className="panel-cut-sm border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase text-fundo">
          Adicionar
        </button>
      </form>
      {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}
      <div className="space-y-2">
        {fila?.map((f) => (
          <div key={f.id} className="panel-cut-sm flex items-center justify-between border border-borda bg-superficie px-3 py-2">
            <span className="truncate font-mono text-xs text-texto-fraco">{f.hltvUrl}</span>
            <span className={`font-mono text-xs uppercase ${CORES_STATUS[f.status]}`}>{f.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Rota em `App.jsx`**

Import: `import PartidasPro from './pages/PartidasPro.jsx'`
Route: `<Route path="/partidas-pro" element={<RotaProtegida><PartidasPro /></RotaProtegida>} />`

- [ ] **Step 3: Link condicional em `Shell.jsx`**

Junto do bloco `{jogador?.isAdmin && (...)}` (linha 49-54), adicionar outro `NavLink` pra
`/partidas-pro` dentro do mesmo condicional.

- [ ] **Step 4: Seção de aprovação de táticas em `Admin.jsx`**

Adicionar um segundo bloco no componente `Admin` (depois do form de whitelist, linha 43-46),
que busca `GET /api/taticas?status=sugerida` num `useEffect`, lista cada uma com dois botões
("Aprovar"/"Rejeitar") chamando `PATCH /api/taticas/:id` com `{ status: 'aprovada' | 'rejeitada' }`,
removendo da lista local ao responder `ok`.

- [ ] **Step 5: Build do client**

```bash
cd site/client && npx vite build
```

- [ ] **Step 6: Commit**

```bash
git add site/client/src/pages/PartidasPro.jsx site/client/src/App.jsx site/client/src/components/Shell.jsx site/client/src/pages/Admin.jsx
git commit -m "feat: pagina admin Partidas Pro + aprovacao de taticas"
```

---

## Task 15: Verificação end-to-end

**Files:** nenhum (só validação manual)

- [ ] **Step 1: Rodar as 3 suites inteiras**

```bash
cd coletor && .venv/Scripts/python.exe -m pytest -q
cd ../site/server && npm test
cd ../client && npx vitest run
```
Esperado: todas passam (com a ressalva já conhecida do teste pré-existente de `Feed.jsx`, se
ainda não tiver sido corrigido em paralelo).

- [ ] **Step 2: Processar 1 partida de pro real ponta a ponta**

Rodar manualmente `coletor.main processar-fila-pro` local (após inserir uma linha de teste em
`partidas_pro_fila` apontando pra um demo real do HLTV) e conferir: status vira `concluida`,
a Partida aparece normal em `/partida/:id` com `team_a_name`/`team_b_name` corretos, e
`GET /api/lineups?origem=pro` devolve granadas com posição de arremesso preenchida.

- [ ] **Step 3: Verificar visualmente no navegador**

Abrir `/granadas`, `/taticas` e `/partidas-pro` (dev server), sugerir uma tática a partir de
uma Partida real, aprovar em `/admin`, confirmar que aparece em `/taticas` com o Replay 2D
abrindo no round certo.

- [ ] **Step 4: Commit final (se algum ajuste for feito na verificação)**
