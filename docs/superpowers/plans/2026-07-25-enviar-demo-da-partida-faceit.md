# Enviar demo de uma Partida FACEIT — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um participante de uma Partida FACEIT stats-only envia o `.dem` daquela
partida pela própria página da Partida; se a demo bater (mapa + os 10 steam ids),
o Coletor grava na MESMA linha da Partida, destravando ADR/KAST/rating, rounds,
Replay 2D e Clipes.

**Architecture:** `uploads_pendentes` ganha `match_alvo_id` (a Partida que o
envio pretende enriquecer) e um índice único parcial que garante um envio ativo
por Partida. O servidor exige participação comprovada via `match_players` antes
de emitir a URL pré-assinada do R2. O Coletor valida mapa + roster depois do
parse e antes de gravar; passando, `store_parsed` grava direto na linha alvo em
vez de deduplicar por fingerprint.

**Tech Stack:** Postgres (Supabase, migrations SQL numeradas), Node/Express
(ESM) + vitest + supertest no servidor, React + vitest/@testing-library no
cliente, Python + pytest no Coletor.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-25-enviar-demo-da-partida-faceit-design.md`.
- Vocabulário do `CONTEXT.md`: **Partida**, **Jogador**, **Participante**,
  **Demo**, **Coletor**. Nada de "match", "player", "user" em texto de UI,
  comentário ou mensagem de erro.
- Toda mensagem de UI e de erro de API em **PT-BR**.
- Validação estrita, sem tolerância: mapa igual **e**
  `set(steam_ids do parse) == set(match_players.steam_id64)`.
- Só Partida com `source = 'faceit'` e `tem_demo = false` é elegível.
- Falha de validação **apaga** o objeto do R2; falha transitória (rede, parser)
  **mantém** o objeto, como já é hoje.
- Nunca rebaixar `tem_demo` de `true` pra `false` — todo write usa
  `tem_demo or <novo>`.
- Rodar testes: `cd coletor && python -m pytest tests -q`;
  `cd site/server && npm test`; `cd site/client && npm test`.
- Trabalhar numa branch `feat/enviar-demo-da-partida` (ver `docs/WORKFLOW.md`);
  **não** commitar código de feature direto no `main`.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0051_enviar_demo_da_partida.sql` | **Criar.** `matches.tem_demo` + backfill, `uploads_pendentes.match_alvo_id`, índice único parcial |
| `coletor/src/coletor/db.py` | **Modificar.** `tem_demo` e `match_id_alvo` em `store_parsed`/`_insert_match`; `dados_da_partida_alvo`; `listar_uploads_pendentes` devolve `match_alvo_id` |
| `coletor/src/coletor/main.py` | **Modificar.** `DemoNaoConfereError`, `_validar_demo_contra_alvo`, `alvo=` em `ingest_demo`/`_finalizar_ingest`, validação e limpeza no `cmd_processar_uploads_pendentes` |
| `site/server/src/routes/upload.js` | **Modificar.** `matchId` opcional: participação (403), elegibilidade (409), envio ativo (409) |
| `site/server/src/routes/matches.js` | **Modificar.** `temDemo` na lista e no detalhe; `demoUpload` no detalhe |
| `site/client/src/lib/demoHeader.js` | **Criar.** Leitura heurística do mapa no cabeçalho do `.dem` |
| `site/client/src/lib/format.js` | **Modificar.** `origemPartida(source, temDemo)` |
| `site/client/src/components/EnviarDemoDaPartida.jsx` | **Criar.** Botão + pré-check + envio + banner de estado |
| `site/client/src/pages/Partida.jsx` | **Modificar.** Monta o componente acima; passa `temDemo` pro badge |
| `site/client/src/pages/Feed.jsx` | **Modificar.** Passa `temDemo` pro badge |

---

## Task 1: Migration

**Files:**
- Create: `supabase/migrations/0051_enviar_demo_da_partida.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `matches.tem_demo boolean not null default false`;
  `uploads_pendentes.match_alvo_id uuid null`; índice
  `uploads_pendentes_alvo_ativo_idx`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Enviar demo de uma Partida FACEIT stats-only pela própria página da Partida.
-- Ver docs/superpowers/specs/2026-07-25-enviar-demo-da-partida-faceit-design.md

-- Marca se a Partida tem os dados que só o parse da Demo produz (rounds, ADR,
-- KAST, rating, Replay 2D). Partida FACEIT stats-only (montada só com a API,
-- ver coletor/src/coletor/faceit.py:montar_parsed_stats_only) fica false.
alter table matches add column tem_demo boolean not null default false;

-- Backfill OBRIGATÓRIO: sem ele toda Partida já processada (Premier, upload
-- manual, pro) ficaria false — badge errado no histórico inteiro e, pior, o
-- botão de envio reaberto numa Partida que já tem Demo. "Tem rounds" é o teste
-- de fato de que a Demo foi parseada.
update matches m set tem_demo = true
  where exists (select 1 from rounds r where r.match_id = m.id);

-- A Partida que este envio pretende enriquecer. Distinto de uploads_pendentes.match_id,
-- que é o RESULTADO do processamento. null = envio genérico (página "Enviar Demo").
alter table uploads_pendentes
  add column match_alvo_id uuid references matches(id) on delete cascade;

-- Um envio ativo por Partida: sem isso, dois participantes subiriam 300MB cada
-- pra mesma Partida em paralelo. A trava é do banco, não do aplicativo.
create unique index uploads_pendentes_alvo_ativo_idx
  on uploads_pendentes (match_alvo_id)
  where status in ('pendente', 'processando');
```

- [ ] **Step 2: Conferir a numeração**

Run: `ls supabase/migrations | tail -3`
Expected: a última existente é `0050_confirmacao_vencedor.sql` — se já houver
uma `0051_*`, renomeie este arquivo pro próximo número livre antes de seguir.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0051_enviar_demo_da_partida.sql
git commit -m "feat: coluna tem_demo e vinculo do upload com a Partida alvo"
```

> **Passo manual antes do merge:** aplicar esta migration em produção **antes**
> de mergear as tasks seguintes — o servidor passa a ler `matches.tem_demo` e
> `uploads_pendentes.match_alvo_id`. Registrar isso na descrição da PR
> (`docs/WORKFLOW.md` §3).

---

## Task 2: Coletor — `tem_demo` em `store_parsed`

**Files:**
- Modify: `coletor/src/coletor/db.py:23-119` (`_insert_match`), `:406-426` (`store_parsed`)
- Modify: `coletor/src/coletor/main.py:668-672` (`_finalizar_ingest`), `:601-604` (`cmd_reprocess`)
- Test: `coletor/tests/test_storage_db.py`

**Interfaces:**
- Consumes: `matches.tem_demo` (Task 1).
- Produces: `db.store_parsed(conn, parsed, share_code=None, source="valve_mm",
  demo_url=None, replay_url=None, status="parsed", prefer_new_played_at=False,
  tem_demo=False)`. O parâmetro `tem_demo` é o ÚLTIMO da lista posicional de
  parâmetros do INSERT em `matches`.

- [ ] **Step 1: Escrever os testes que falham**

Em `coletor/tests/test_storage_db.py`, no fim do bloco de testes de
`store_parsed` (depois de `test_store_parsed_grava_plataforma_manual`):

```python
def test_store_parsed_grava_tem_demo_quando_veio_de_demo_parseada():
    conn = FakeConn()
    db.store_parsed(conn, _parsed(), share_code="CSGO-x", source="upload", tem_demo=True)
    match_call = next(c for c in conn.calls if c[0].startswith("insert into matches"))
    assert match_call[1][-1] is True
    assert "tem_demo" in match_call[0]


def test_store_parsed_sem_tem_demo_grava_false_por_padrao():
    # Caminho stats-only da FACEIT (main.cmd_sincronizar_faceit) não passa tem_demo.
    conn = FakeConn()
    db.store_parsed(conn, _parsed(), share_code="CSGO-x", source="faceit")
    match_call = next(c for c in conn.calls if c[0].startswith("insert into matches"))
    assert match_call[1][-1] is False


def test_store_parsed_nunca_rebaixa_tem_demo_para_false():
    # Re-sync stats-only de uma Partida que JÁ foi enriquecida por demo não pode
    # apagar tem_demo — o SQL usa 'or', nunca sobrescreve cru.
    conn = FakeConn()
    db.store_parsed(conn, _parsed(), share_code="CSGO-x", source="faceit")
    match_call = next(c for c in conn.calls if c[0].startswith("insert into matches"))
    assert "tem_demo = matches.tem_demo or excluded.tem_demo" in match_call[0]
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd coletor && python -m pytest tests/test_storage_db.py -k tem_demo -q`
Expected: FAIL — `store_parsed() got an unexpected keyword argument 'tem_demo'`.

- [ ] **Step 3: Implementar em `db.py`**

Em `_insert_match`, trocar a assinatura (linha 23):

```python
def _insert_match(cur, share_code, source, parsed, demo_url, replay_url, status,
                  prefer_new_played_at=False, tem_demo=False):
```

No caminho de UPDATE (dedupe por fingerprint), acrescentar `tem_demo` ao `set`,
logo depois de `plataforma_manual = coalesce(%s, plataforma_manual)`:

```sql
              plataforma_manual = coalesce(%s, plataforma_manual),
              tem_demo = tem_demo or %s
```

e o valor correspondente na tupla, entre `parsed.get("plataforma_manual")` e
`match_id`:

```python
                parsed.get("plataforma_manual"),
                tem_demo,
                match_id,
```

No caminho de INSERT, acrescentar a coluna no fim da lista e mais um `%s`:

```sql
        insert into matches (share_code, source, map, score_a, score_b, played_at, demo_url, replay_url, status, fingerprint, team_a_name, team_b_name, ended_early, abandoned_by_steam_id64, plataforma_manual, tem_demo)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
```

no `on conflict ... do update set`, depois da linha de `plataforma_manual`:

```sql
          plataforma_manual = coalesce(excluded.plataforma_manual, matches.plataforma_manual),
          tem_demo = matches.tem_demo or excluded.tem_demo
```

e `tem_demo` como ÚLTIMO item da tupla de valores, depois de
`parsed.get("plataforma_manual")`.

Em `store_parsed` (linha 406), acrescentar o parâmetro e repassar:

```python
def store_parsed(conn, parsed, share_code=None, source="valve_mm", demo_url=None,
                 replay_url=None, status="parsed", prefer_new_played_at=False,
                 tem_demo=False):
    """Grava a Partida inteira numa transação. Devolve o match_id (uuid).

    `tem_demo`: True só quando os dados vieram do parse de um .dem de verdade
    (ingest_demo/reprocess). O caminho stats-only da FACEIT deixa False — é o que
    o site usa pra saber que a Partida está incompleta e oferecer o envio da Demo.
    """
    with conn.cursor() as cur:
        match_id = _insert_match(
            cur, share_code, source, parsed, demo_url, replay_url, status,
            prefer_new_played_at, tem_demo,
        )
```

- [ ] **Step 4: Passar `tem_demo=True` nos dois caminhos que parseiam demo**

Em `coletor/src/coletor/main.py`, `_finalizar_ingest` (linha 668):

```python
    return dbmod.store_parsed(
        conn, parsed, share_code=share_code, source=source,
        demo_url=demo_url, replay_url=replay_url,
        prefer_new_played_at=bool(played_at),
        tem_demo=True,
    )
```

E em `cmd_reprocess` (linha 601):

```python
                dbmod.store_parsed(
                    conn, parsed, share_code=share_code, source=source or "valve_mm",
                    demo_url=demo_url, replay_url=replay_url, prefer_new_played_at=False,
                    tem_demo=True,
                )
```

O terceiro chamador (`main.py:888`, stats-only da FACEIT) fica **inalterado** —
é exatamente o caso que precisa continuar `false`.

- [ ] **Step 5: Consertar as asserções por índice negativo que a nova coluna quebra**

Quatro testes existentes conferem parâmetros por índice a partir do fim. Com
`tem_demo` no fim, os índices andam um. Em `coletor/tests/test_storage_db.py`:

- `test_store_parsed_grava_ended_early_e_abandoned_by`: `[-3:-1]` → `[-4:-2]`
- `test_store_parsed_sem_ended_early_grava_false_e_none_por_padrao`: `[-3:-1]` → `[-4:-2]`
- `test_store_parsed_grava_plataforma_manual`: `[-1]` → `[-2]`
- `test_store_parsed_dedupe_por_fingerprint_atualiza_ended_early_tambem`:
  `[-4:-2]` → `[-5:-3]` (o UPDATE ganhou `tem_demo` antes do `match_id`)

- [ ] **Step 6: Rodar a suíte inteira do Coletor**

Run: `cd coletor && python -m pytest tests -q`
Expected: PASS, sem falhas.

- [ ] **Step 7: Commit**

```bash
git add coletor/src/coletor/db.py coletor/src/coletor/main.py coletor/tests/test_storage_db.py
git commit -m "feat: marca tem_demo quando a Partida vem do parse de uma Demo"
```

---

## Task 3: Coletor — gravar na Partida alvo em vez de deduplicar

**Files:**
- Modify: `coletor/src/coletor/db.py:23-119` (`_insert_match`), `:406` (`store_parsed`)
- Test: `coletor/tests/test_storage_db.py`

**Interfaces:**
- Consumes: `store_parsed(..., tem_demo=)` (Task 2).
- Produces: `store_parsed(..., match_id_alvo=None)` — quando informado, pula a
  busca por fingerprint e atualiza a linha informada, recalculando o
  `fingerprint` com os dados novos.

- [ ] **Step 1: Escrever os testes que falham**

Em `coletor/tests/test_storage_db.py`:

```python
def test_store_parsed_com_match_id_alvo_atualiza_a_linha_informada():
    # Enriquecer uma Partida FACEIT stats-only: o K/D do parser quase nunca bate
    # exatamente com o da API, então a dedupe por fingerprint NÃO pode decidir —
    # o alvo é explícito.
    alvo = "22222222-2222-2222-2222-222222222222"
    conn = FakeConn()
    mid = db.store_parsed(conn, _parsed(), source="upload", tem_demo=True, match_id_alvo=alvo)

    assert mid == alvo
    sqls = [c[0] for c in conn.calls]
    assert not any(s.startswith("select id from matches where fingerprint") for s in sqls)
    assert not any(s.startswith("insert into matches") for s in sqls)
    update = next(c for c in conn.calls if c[0].startswith("update matches set share_code"))
    assert update[1][-1] == alvo


def test_store_parsed_com_match_id_alvo_recalcula_o_fingerprint():
    # Sem isso a Partida ficaria com a digital dos stats VELHOS (da API) e uma
    # ingestão futura da mesma partida criaria uma duplicata.
    alvo = "22222222-2222-2222-2222-222222222222"
    conn = FakeConn()
    db.store_parsed(conn, _parsed(), source="upload", tem_demo=True, match_id_alvo=alvo)
    update = next(c for c in conn.calls if c[0].startswith("update matches set share_code"))
    assert "fingerprint = %s" in update[0]
    assert db.match_fingerprint(_parsed()) in update[1]


def test_store_parsed_sem_alvo_continua_deduplicando_por_fingerprint():
    # Regressão: o envio genérico (página "Enviar Demo") não muda de comportamento.
    conn = FakeConn()
    db.store_parsed(conn, _parsed(), share_code="CSGO-x", source="upload")
    sqls = [c[0] for c in conn.calls]
    assert any(s.startswith("select id from matches where fingerprint") for s in sqls)


def test_enriquecer_partida_alvo_preserva_elo_e_faceit_match_id():
    # A Partida alvo é FACEIT: faceit_elo_before/after (match_players) e
    # faceit_match_id (matches) NÃO vêm da demo e não podem ser apagados ao
    # sobrescrever os stats. Hoje isso é garantido por omissão (nenhum dos dois
    # aparece no on-conflict/update) — este teste trava o comportamento pra que
    # incluí-los no futuro seja uma decisão consciente, não um acidente.
    alvo = "22222222-2222-2222-2222-222222222222"
    conn = FakeConn()
    db.store_parsed(conn, _parsed(), source="upload", tem_demo=True, match_id_alvo=alvo)

    update_match = next(c for c in conn.calls if c[0].startswith("update matches set share_code"))
    assert "faceit_match_id" not in update_match[0]
    insert_players = next(c for c in conn.calls if c[0].startswith("insert into match_players"))
    assert "faceit_elo_before" not in insert_players[0]
    assert "faceit_elo_after" not in insert_players[0]
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd coletor && python -m pytest tests/test_storage_db.py -k match_id_alvo -q`
Expected: FAIL — `unexpected keyword argument 'match_id_alvo'`.

- [ ] **Step 3: Implementar**

Em `db.py`, `_insert_match` — assinatura e as primeiras linhas:

```python
def _insert_match(cur, share_code, source, parsed, demo_url, replay_url, status,
                  prefer_new_played_at=False, tem_demo=False, match_id_alvo=None):
    fingerprint = match_fingerprint(parsed)

    # `match_id_alvo` vem do envio de Demo amarrado a uma Partida específica (ver
    # site/server/src/routes/upload.js e cmd_processar_uploads_pendentes): o vínculo
    # é explícito e já foi validado (mapa + os 10 steam ids), então a dedupe por
    # conteúdo não decide nada aqui — o K/D do parser quase nunca bate exatamente
    # com o da API da FACEIT, e deixar o fingerprint decidir criaria uma duplicata.
    if match_id_alvo is not None:
        match_id = match_id_alvo
    else:
        cur.execute("select id from matches where fingerprint = %s", (fingerprint,))
        row = cur.fetchone()
        match_id = row[0] if row else None

    if match_id is not None:
        if share_code:
```

(o resto do bloco de UPDATE continua igual, só perdeu o `match_id = row[0]` do
começo e o `if row:` virou `if match_id is not None:`)

No `set` do UPDATE, acrescentar o fingerprint junto do `tem_demo` da Task 2:

```sql
              plataforma_manual = coalesce(%s, plataforma_manual),
              tem_demo = tem_demo or %s, fingerprint = %s
```

e o valor na tupla, entre `tem_demo` e `match_id`:

```python
                tem_demo,
                fingerprint,
                match_id,
```

Em `store_parsed`, acrescentar o parâmetro e repassar:

```python
def store_parsed(conn, parsed, share_code=None, source="valve_mm", demo_url=None,
                 replay_url=None, status="parsed", prefer_new_played_at=False,
                 tem_demo=False, match_id_alvo=None):
    ...
        match_id = _insert_match(
            cur, share_code, source, parsed, demo_url, replay_url, status,
            prefer_new_played_at, tem_demo, match_id_alvo,
        )
```

- [ ] **Step 4: Consertar o índice do teste de dedupe (de novo)**

`test_store_parsed_dedupe_por_fingerprint_atualiza_ended_early_tambem` agora tem
mais um parâmetro no fim do UPDATE: `[-5:-3]` (ajustado na Task 2) vira `[-6:-4]`.

- [ ] **Step 5: Rodar a suíte**

Run: `cd coletor && python -m pytest tests -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add coletor/src/coletor/db.py coletor/tests/test_storage_db.py
git commit -m "feat: store_parsed grava na Partida alvo quando o envio tem vinculo"
```

---

## Task 4: Coletor — validar mapa e roster antes de gravar

**Files:**
- Modify: `coletor/src/coletor/db.py:550-558` (`listar_uploads_pendentes`), + nova `dados_da_partida_alvo`
- Modify: `coletor/src/coletor/main.py:397-448` (`cmd_processar_uploads_pendentes`), `:645` (`_finalizar_ingest`), `:692` (`ingest_demo`)
- Test: `coletor/tests/test_main.py`, `coletor/tests/test_storage_db.py`

**Interfaces:**
- Consumes: `store_parsed(..., match_id_alvo=)` (Task 3);
  `uploads_pendentes.match_alvo_id` (Task 1).
- Produces: `main.DemoNaoConfereError`;
  `main._validar_demo_contra_alvo(parsed, alvo)`;
  `db.dados_da_partida_alvo(conn, match_id) -> {"map": str, "steam_ids": set} | None`;
  `listar_uploads_pendentes` passa a devolver 7 colunas (a 7ª é `match_alvo_id`);
  `ingest_demo(..., alvo=None)` onde `alvo` é
  `{"match_id": str, "map": str, "steam_ids": set}`.

- [ ] **Step 1: Escrever os testes que falham**

Em `coletor/tests/test_main.py`, no fim do bloco
`# ---- cmd_processar_uploads_pendentes ----`:

```python
# ---- envio amarrado a uma Partida: valida mapa + roster antes de gravar ----

def _alvo(mapa="de_inferno", ids=("A", "B")):
    return {"match_id": "m-alvo", "map": mapa, "steam_ids": set(ids)}


def test_validar_demo_contra_alvo_aceita_mapa_e_roster_iguais():
    parsed = {"map": "de_inferno", "players": [{"steam_id64": "A"}, {"steam_id64": "B"}]}
    main._validar_demo_contra_alvo(parsed, _alvo())  # não levanta


def test_validar_demo_contra_alvo_recusa_mapa_diferente():
    parsed = {"map": "de_mirage", "players": [{"steam_id64": "A"}, {"steam_id64": "B"}]}
    with pytest.raises(main.DemoNaoConfereError, match="mapa"):
        main._validar_demo_contra_alvo(parsed, _alvo())


def test_validar_demo_contra_alvo_recusa_roster_diferente():
    parsed = {"map": "de_inferno", "players": [{"steam_id64": "A"}, {"steam_id64": "Z"}]}
    with pytest.raises(main.DemoNaoConfereError, match="jogadores"):
        main._validar_demo_contra_alvo(parsed, _alvo())


def test_processar_uploads_pendentes_com_alvo_passa_o_alvo_pro_ingest(monkeypatch):
    conn = _UploadsConn([("u1", "765", "uploads-pendentes/abc.dem", None, None, None, "m-alvo")])
    config = _config_com_r2()
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"dem-bytes")
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: None)
    monkeypatch.setattr(
        main.dbmod, "dados_da_partida_alvo",
        lambda c, mid: {"map": "de_inferno", "steam_ids": {"A", "B"}},
    )
    recebidos = []

    def _ingest_fake(cfg, cn, dem_path, alvo=None, **kw):
        recebidos.append(alvo)
        return "m-alvo"

    monkeypatch.setattr(main, "ingest_demo", _ingest_fake)

    total = main.cmd_processar_uploads_pendentes(config, conn)

    assert total == 1
    assert recebidos == [{"match_id": "m-alvo", "map": "de_inferno", "steam_ids": {"A", "B"}}]


def test_processar_uploads_pendentes_demo_que_nao_confere_falha_e_apaga_do_r2(monkeypatch):
    # Demo errada não fica certa na segunda tentativa — diferente da falha
    # transitória (rede/parser), que mantém o staging pro retry.
    conn = _UploadsConn([("u1", "765", "uploads-pendentes/abc.dem", None, None, None, "m-alvo")])
    config = _config_com_r2()
    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key, **kw: b"dem-bytes")
    deletes = []
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: deletes.append(key))
    monkeypatch.setattr(
        main.dbmod, "dados_da_partida_alvo",
        lambda c, mid: {"map": "de_inferno", "steam_ids": {"A", "B"}},
    )
    monkeypatch.setattr(
        main, "ingest_demo",
        lambda *a, **kw: (_ for _ in ()).throw(main.DemoNaoConfereError("o mapa da demo não confere")),
    )

    total = main.cmd_processar_uploads_pendentes(config, conn)

    assert total == 0
    assert deletes == ["uploads-pendentes/abc.dem"]
    update = next(c for c in conn.calls if c[0].startswith("update uploads_pendentes") and c[1][0] == "falhou")
    assert "mapa" in update[1][2]
```

No mesmo arquivo, ajustar o fake existente `_UploadsCursor.fetchall` pra
reconhecer a nova coluna:

```python
        if self._last.startswith(
            "select id, adicionado_por, arquivo_r2_key, share_code, played_at, "
            "plataforma_manual, match_alvo_id from uploads_pendentes"
        ):
            return self.conn.upload_rows
```

e acrescentar `None` no fim das tuplas dos quatro testes já existentes de
`_UploadsConn([...])` (`("u1", "765", "...", None, None, "gamers_club")` vira
`("u1", "765", "...", None, None, "gamers_club", None)`).

Confirmar que `import pytest` já existe no topo de `test_main.py`; se não,
acrescentar.

Em `coletor/tests/test_storage_db.py`:

```python
def test_dados_da_partida_alvo_devolve_mapa_e_steam_ids():
    conn = FakeConn()
    conn.alvo_map = "de_inferno"
    dados = db.dados_da_partida_alvo(conn, "m-alvo")
    assert dados == {"map": "de_inferno", "steam_ids": {"A", "B"}}


def test_dados_da_partida_alvo_devolve_none_quando_a_partida_sumiu():
    conn = FakeConn()
    conn.alvo_map = None
    assert db.dados_da_partida_alvo(conn, "m-sumida") is None
```

O `FakeConn` de `test_storage_db.py` precisa responder a essas duas queries.
Localize a classe (é a que já trata `fingerprint_row`) e acrescente no
`fetchone`/`fetchall` dela:

```python
        if self._last.startswith("select map from matches where id"):
            return None if getattr(self.conn, "alvo_map", None) is None else (self.conn.alvo_map,)
        if self._last.startswith("select steam_id64 from match_players where match_id"):
            return [("A",), ("B",)]
```

(o primeiro no `fetchone`, o segundo no `fetchall` — siga a estrutura da classe
existente; ela já separa os dois.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd coletor && python -m pytest tests/test_main.py -k alvo -q`
Expected: FAIL — `module 'coletor.main' has no attribute '_validar_demo_contra_alvo'`.

- [ ] **Step 3: Implementar o helper de banco**

Em `coletor/src/coletor/db.py`, logo depois de `listar_uploads_pendentes`:

```python
def dados_da_partida_alvo(conn, match_id):
    """Mapa + steam ids dos Participantes da Partida que um envio de Demo diz
    enriquecer — os dois lados da validação estrita feita antes de gravar
    (ver main._validar_demo_contra_alvo). None se a Partida não existe mais."""
    with conn.cursor() as cur:
        cur.execute("select map from matches where id = %s", (match_id,))
        row = cur.fetchone()
        if row is None:
            return None
        mapa = row[0]
        cur.execute("select steam_id64 from match_players where match_id = %s", (match_id,))
        steam_ids = {r[0] for r in cur.fetchall()}
    return {"map": mapa, "steam_ids": steam_ids}
```

E acrescentar a coluna em `listar_uploads_pendentes`:

```python
        cur.execute(
            "select id, adicionado_por, arquivo_r2_key, share_code, played_at, "
            "plataforma_manual, match_alvo_id "
            "from uploads_pendentes where status = 'pendente' order by adicionado_em"
        )
```

- [ ] **Step 4: Implementar a validação em `main.py`**

Logo antes de `cmd_processar_uploads_pendentes` (perto da linha 396):

```python
class DemoNaoConfereError(Exception):
    """A Demo enviada não corresponde à Partida que o envio diz enriquecer.

    Erro DEFINITIVO, não transitório: retry não melhora, então quem trata apaga
    o staging do R2 em vez de guardar pra próxima rodada."""


def _validar_demo_contra_alvo(parsed, alvo):
    """Validação estrita do envio amarrado a uma Partida: mapa igual E os mesmos
    Participantes. O roster da Partida FACEIT vem da API oficial, então 10 steam
    ids batendo é prova de que é a Partida certa — sem depender de K/D (que o
    parser conta diferente da API) nem de horário (o .dem não guarda data)."""
    if parsed.get("map") != alvo["map"]:
        raise DemoNaoConfereError(
            f"o mapa da demo ({parsed.get('map')}) não confere com o desta partida ({alvo['map']})"
        )
    ids_demo = {p["steam_id64"] for p in parsed.get("players", [])}
    if ids_demo != alvo["steam_ids"]:
        raise DemoNaoConfereError("os jogadores da demo não são os desta partida")
```

- [ ] **Step 5: Ligar o alvo no `ingest_demo`**

Assinatura (linha 692) e o trecho logo depois do `enrich`:

```python
def ingest_demo(config, conn, path, share_code=None, source="upload", upload=True,
                played_at=None, plataforma_manual=None, alvo=None):
```

Acrescentar ao docstring:

```
    `alvo` (opcional): {"match_id", "map", "steam_ids"} da Partida que este envio
    diz enriquecer. Quando informado, a Demo é validada contra ela ANTES de
    qualquer trabalho caro (Replay 2D) e os dados são gravados NAQUELA linha, sem
    passar pela dedupe por fingerprint.
```

Depois de `parsed = transform.enrich(parsed)` (linha 706) — antes do
`extract_replay`, que é a parte cara:

```python
    if alvo is not None:
        _validar_demo_contra_alvo(parsed, alvo)
```

E na chamada de `_finalizar_ingest` (linha 732):

```python
    match_id = _finalizar_ingest(
        config, conn, parsed, replay_json, path, share_code, source, upload, played_at,
        match_id_alvo=alvo["match_id"] if alvo else None,
    )
```

Em `_finalizar_ingest` (linha 645):

```python
def _finalizar_ingest(config, conn, parsed, replay_json, dem_path_upload, share_code,
                      source, upload, played_at, match_id_alvo=None):
```

e no `store_parsed` do fim dela, acrescentar `match_id_alvo=match_id_alvo,`.

- [ ] **Step 6: Ligar na fila**

Em `cmd_processar_uploads_pendentes`, o loop passa a desempacotar 7 valores e a
montar o alvo:

```python
    for (upload_id, adicionado_por, arquivo_r2_key, share_code, played_at,
         plataforma_manual, match_alvo_id) in pendentes:
        dbmod.atualizar_upload_pendente(conn, upload_id, "processando")
        try:
            alvo = None
            if match_alvo_id:
                dados = dbmod.dados_da_partida_alvo(conn, match_alvo_id)
                if dados is None:
                    raise DemoNaoConfereError("a partida deste envio não existe mais")
                alvo = {"match_id": match_alvo_id, **dados}

            with tempfile.TemporaryDirectory() as tmp:
                tmp = Path(tmp)
                print(f"  {upload_id}: baixando do R2 ({arquivo_r2_key})")
                dados_dem = storage_r2.download_bytes(
                    client, config.r2_bucket, arquivo_r2_key, max_bytes=_MAX_UPLOAD_BYTES,
                )
                dem_path = tmp / "demo.dem"
                dem_path.write_bytes(dados_dem)

                match_id = ingest_demo(
                    config, conn, dem_path,
                    share_code=share_code, source="upload", upload=True,
                    played_at=played_at, plataforma_manual=plataforma_manual,
                    alvo=alvo,
                )
                dbmod.atualizar_upload_pendente(conn, upload_id, "concluido", match_id=match_id)
                print(f"  {upload_id}: concluido ({match_id})")
                total += 1
                # Apaga o staging só em sucesso — numa falha o arquivo continua no R2
                # pro reprocessamento futuro reaproveitar sem o jogador subir de novo.
                storage_r2.delete_object(client, config.r2_bucket, arquivo_r2_key)
        except DemoNaoConfereError as e:
            # Falha DEFINITIVA (mapa/roster errado): guardar o staging só ocuparia
            # espaço pra sempre, já que nenhum retry vai mudar o resultado.
            conn.rollback()
            dbmod.atualizar_upload_pendente(conn, upload_id, "falhou", erro=str(e)[:500])
            storage_r2.delete_object(client, config.r2_bucket, arquivo_r2_key)
            print(f"  {upload_id}: RECUSADO ({e})")
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            dbmod.atualizar_upload_pendente(conn, upload_id, "falhou", erro=str(e)[:500])
            print(f"  {upload_id}: FALHOU ({e})")
```

Atenção: a variável local do download foi renomeada de `dados` pra `dados_dem`
porque `dados` agora é o retorno de `dados_da_partida_alvo`.

- [ ] **Step 7: Rodar a suíte do Coletor**

Run: `cd coletor && python -m pytest tests -q`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add coletor/src/coletor/db.py coletor/src/coletor/main.py coletor/tests/
git commit -m "feat: valida mapa e roster da Demo antes de enriquecer a Partida"
```

---

## Task 5: Servidor — `matchId` no `upload-url`

**Files:**
- Modify: `site/server/src/routes/upload.js`
- Test: `site/server/test/upload.test.js`

**Interfaces:**
- Consumes: `uploads_pendentes.match_alvo_id`, `matches.tem_demo` (Task 1).
- Produces: `POST /api/upload/upload-url` aceita `matchId` (uuid, opcional).
  403 sem participação, 409 se `tem_demo`, 409 se já há envio ativo, 400 se
  `matchId` não é uuid.

- [ ] **Step 1: Escrever os testes que falham**

Em `site/server/test/upload.test.js`, dentro do `describe` existente:

```js
  // ---- envio amarrado a uma Partida (matchId) ----

  const UUID = '11111111-1111-1111-1111-111111111111'

  it('matchId que não é uuid: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', matchId: 'nao-e-uuid' })
    expect(res.status).toBe(400)
  })

  it('matchId de partida onde o jogador não jogou: 403', async () => {
    const { app } = appWith([['from matches m where m.id', [{ id: UUID, tem_demo: false, source: 'faceit', participou: false }]]])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', matchId: UUID })
    expect(res.status).toBe(403)
    expect(res.body.erro).toMatch(/jogou/i)
  })

  it('matchId inexistente: 403 (não revela que a partida existe ou não)', async () => {
    const { app } = appWith([['from matches m where m.id', []]])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', matchId: UUID })
    expect(res.status).toBe(403)
  })

  it('partida que já tem demo processada: 409', async () => {
    const { app } = appWith([['from matches m where m.id', [{ id: UUID, tem_demo: true, source: 'faceit', participou: true }]]])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', matchId: UUID })
    expect(res.status).toBe(409)
    expect(res.body.erro).toMatch(/j[áa] tem demo/i)
  })

  it('partida que não é faceit stats-only: 409', async () => {
    const { app } = appWith([['from matches m where m.id', [{ id: UUID, tem_demo: false, source: 'valve_mm', participou: true }]]])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', matchId: UUID })
    expect(res.status).toBe(409)
  })

  it('caminho feliz: grava match_alvo_id e ignora shareCode/playedAt/plataforma do cliente', async () => {
    const { app, db } = appWith([
      ['from matches m where m.id', [{ id: UUID, tem_demo: false, source: 'faceit', participou: true }]],
      ['insert into uploads_pendentes', [{ id: 'u1' }]],
    ])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({
        filename: 'x.dem',
        matchId: UUID,
        shareCode: 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee',
        plataformaManual: 'gamers_club',
      })
    expect(res.status).toBe(200)
    const insert = db.query.mock.calls.find((c) => c[0].includes('insert into uploads_pendentes'))
    expect(insert[0]).toContain('match_alvo_id')
    // herda tudo da Partida: nada de share code / plataforma vindos do cliente
    expect(insert[1]).toEqual(['765', res.body.key, null, null, null, UUID])
  })

  it('envio já em andamento pra essa partida (unique violation): 409', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('from matches m where m.id')) {
          return Promise.resolve({ rows: [{ id: UUID, tem_demo: false, source: 'faceit', participou: true }] })
        }
        if (sql.includes('insert into uploads_pendentes')) {
          return Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }))
        }
        return Promise.resolve({ rows: [] })
      }),
    }
    const app = createApp({ config, db, r2Client: { send: vi.fn() } })
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', matchId: UUID })
    expect(res.status).toBe(409)
    expect(res.body.erro).toMatch(/em andamento/i)
  })
```

Além disso, os dois testes existentes que conferem os parâmetros do insert
(`'caminho feliz: insere na fila sem group_id...'` e
`'plataforma manual valida: grava na fila'`) ganham um 6º valor `null`:

```js
    expect(insert[1]).toEqual(['765', res.body.key, 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee', playedAt, null, null])
```
```js
    expect(insert[1]).toEqual(['765', res.body.key, null, null, 'gamers_club', null])
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/server && npx vitest run test/upload.test.js`
Expected: FAIL — os novos casos devolvem 200 em vez de 403/409.

- [ ] **Step 3: Implementar**

No topo de `site/server/src/routes/upload.js`, junto das outras constantes:

```js
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
```

Dentro do handler, **depois** das validações de `plataformaManual` e **antes**
da criação da `key`:

```js
    // Envio amarrado a uma Partida específica (botão "Enviar demo desta partida" na
    // página da Partida): o vínculo é explícito, então dá pra exigir prova de
    // participação e checar elegibilidade antes de gastar 300MB de upload.
    const matchId = String(req.body?.matchId ?? '').trim()
    if (matchId) {
      if (!UUID_RE.test(matchId)) return res.status(400).json({ erro: 'Partida inválida' })
      const { rows } = await db.query(
        `select m.tem_demo, m.source,
                exists (
                  select 1 from match_players mp
                  where mp.match_id = m.id and mp.steam_id64 = $2
                ) as participou
         from matches m where m.id = $1`,
        [matchId, req.player.steamId],
      )
      const alvo = rows[0]
      // Partida inexistente e partida onde ele não jogou dão a MESMA resposta —
      // senão o 404/403 vira um oráculo de "esta partida existe".
      if (!alvo || !alvo.participou) {
        return res.status(403).json({ erro: 'Só quem jogou esta partida pode enviar a demo dela' })
      }
      if (alvo.tem_demo) {
        return res.status(409).json({ erro: 'Esta partida já tem demo processada' })
      }
      if (alvo.source !== 'faceit') {
        return res.status(409).json({ erro: 'Esta partida não aceita envio de demo' })
      }
    }
```

E o insert passa a herdar tudo da Partida quando há alvo:

```js
    const key = `uploads-pendentes/${crypto.randomUUID()}.dem`
    // Com alvo, os metadados vêm da própria Partida — nada de share code, data ou
    // plataforma digitados pelo cliente (menos superfície pra dado mentiroso).
    const params = matchId
      ? [req.player.steamId, key, null, null, null, matchId]
      : [req.player.steamId, key, shareCode || null, playedAt || null, plataformaManual || null, null]
    let rows
    try {
      ;({ rows } = await db.query(
        `insert into uploads_pendentes (adicionado_por, arquivo_r2_key, share_code, played_at, plataforma_manual, match_alvo_id)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        params,
      ))
    } catch (e) {
      // uploads_pendentes_alvo_ativo_idx: um envio ativo por Partida (a trava é do
      // banco, não do aplicativo — dois cliques simultâneos não passam pelos dois).
      if (e?.code === '23505') {
        return res.status(409).json({ erro: 'Já existe um envio em andamento pra esta partida' })
      }
      throw e
    }
    const uploadUrl = await presignUpload(r2Client, r2Bucket, key, 'application/octet-stream')
    res.json({ id: rows[0].id, uploadUrl, key })
```

- [ ] **Step 4: Rodar os testes**

Run: `cd site/server && npx vitest run test/upload.test.js`
Expected: PASS, todos.

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/upload.js site/server/test/upload.test.js
git commit -m "feat: upload-url aceita matchId com prova de participacao"
```

---

## Task 6: Servidor — expor `temDemo` e `demoUpload`

**Files:**
- Modify: `site/server/src/routes/matches.js` (lista ~linha 95-120, detalhe ~linha 149-245)
- Test: `site/server/test/matches.test.js`

**Interfaces:**
- Consumes: `matches.tem_demo`, `uploads_pendentes.match_alvo_id` (Task 1).
- Produces: no JSON da lista e do detalhe, `temDemo: boolean`; no detalhe,
  `demoUpload: { status, erro, enviadoPorVoce } | null`.

- [ ] **Step 1: Escrever os testes que falham**

Em `site/server/test/matches.test.js` (siga o helper de app/db que o arquivo já
usa — não invente outro):

```js
  it('detalhe: expõe temDemo e o estado do envio de demo', async () => {
    const { app } = appComPartida({
      match: { tem_demo: false },
      uploads: [{ status: 'processando', erro: null, adicionado_por: '765' }],
    })
    const res = await request(app).get('/api/matches/m1').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.temDemo).toBe(false)
    expect(res.body.demoUpload).toEqual({ status: 'processando', erro: null, enviadoPorVoce: true })
  })

  it('detalhe: erro do envio só aparece pra quem enviou', async () => {
    const { app } = appComPartida({
      match: { tem_demo: false },
      uploads: [{ status: 'falhou', erro: 'o mapa da demo não confere', adicionado_por: '999' }],
    })
    const res = await request(app).get('/api/matches/m1').set('Cookie', cookie)
    expect(res.body.demoUpload).toEqual({ status: 'falhou', erro: null, enviadoPorVoce: false })
  })

  it('detalhe: sem envio, demoUpload é null', async () => {
    const { app } = appComPartida({ match: { tem_demo: true }, uploads: [] })
    const res = await request(app).get('/api/matches/m1').set('Cookie', cookie)
    expect(res.body.temDemo).toBe(true)
    expect(res.body.demoUpload).toBeNull()
  })
```

Se `matches.test.js` ainda não tiver um helper equivalente a `appComPartida`,
crie um seguindo o padrão de `appWith` de `upload.test.js` (casar por trecho de
SQL e devolver linhas), com entradas pra `from matches mt`, `from match_players mp`
e `from uploads_pendentes`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/server && npx vitest run test/matches.test.js`
Expected: FAIL — `temDemo` é `undefined`.

- [ ] **Step 3: Implementar**

No `select` do detalhe (`router.get('/:id')`), acrescentar a coluna:

```js
      `select mt.id, mt.map, mt.played_at, mt.score_a, mt.score_b, mt.source, mt.status, mt.demo_url, mt.replay_url,
              mt.ended_early, mt.abandoned_by_steam_id64, mt.plataforma_manual, mt.tem_demo,
```

Acrescentar mais uma query ao `Promise.all` (no fim da lista, junto com
`allstarClips`) — lembrando de acrescentar `demoUploads` ao array de
destructuring:

```js
      // Estado do envio de Demo amarrado a esta Partida (botão "Enviar demo desta
      // partida"). Só o mais recente importa: o índice único parcial garante no
      // máximo um ativo, e um 'falhou' antigo já foi substituído por um novo envio.
      db.query(
        `select status, erro, adicionado_por
         from uploads_pendentes
         where match_alvo_id = $1 and status in ('pendente', 'processando', 'falhou')
         order by adicionado_em desc limit 1`,
        [id],
      ),
```

E no `res.json`, junto de `source`:

```js
      source: m.source,
      temDemo: m.tem_demo,
```

e, junto de `endedEarly`:

```js
      demoUpload: (() => {
        const u = demoUploads.rows[0]
        if (!u) return null
        const meu = u.adicionado_por === req.player.steamId
        // O motivo da falha só interessa (e só é de quem) enviou — pros outros a
        // Partida só está incompleta, não falhou nada "deles".
        return { status: u.status, erro: meu ? u.erro : null, enviadoPorVoce: meu }
      })(),
```

Na query da LISTA (o `router.get('/')` no começo do arquivo), acrescentar
`m.tem_demo` ao select e `temDemo: m.tem_demo,` logo depois de `source: m.source,`
no `.map(...)` (~linha 112).

- [ ] **Step 4: Rodar os testes**

Run: `cd site/server && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/matches.js site/server/test/matches.test.js
git commit -m "feat: expoe temDemo e estado do envio de demo na Partida"
```

---

## Task 7: Cliente — badge "SEM DEMO"

**Files:**
- Modify: `site/client/src/lib/format.js:81-87`
- Modify: `site/client/src/pages/Partida.jsx:1356-1361`
- Modify: `site/client/src/pages/Feed.jsx:60`
- Test: `site/client/src/test/ui.test.jsx` (ou o arquivo de teste que já cobre `format.js`)

**Interfaces:**
- Consumes: `temDemo` do JSON (Task 6).
- Produces: `origemPartida(source, temDemo)` — 3 retornos possíveis:
  `MANUAL` (source `'upload'`), `SEM DEMO` (`temDemo === false`), `AUTO`.

- [ ] **Step 1: Escrever os testes que falham**

```js
import { origemPartida } from '../lib/format.js'

describe('origemPartida', () => {
  it('upload manual continua MANUAL', () => {
    expect(origemPartida('upload', true).label).toBe('MANUAL')
  })

  it('partida automática com demo parseada é AUTO', () => {
    expect(origemPartida('valve_mm', true).label).toBe('AUTO')
  })

  it('partida sem demo (stats-only da API) é SEM DEMO', () => {
    expect(origemPartida('faceit', false).label).toBe('SEM DEMO')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/client && npx vitest run src/test/ui.test.jsx`
Expected: FAIL — recebe `AUTO` onde espera `SEM DEMO`.

- [ ] **Step 3: Implementar**

```js
// Tag de origem da Partida. `temDemo` distingue a Partida COMPLETA (veio de um .dem
// parseado) da stats-only, montada só com o que a API da plataforma devolve — que não
// tem ADR, KAST, rating, rounds nem Replay 2D. Ver matches.tem_demo.
export function origemPartida(source, temDemo = true) {
  if (source === 'upload') return { label: 'MANUAL', title: 'Demo enviada manualmente' }
  if (!temDemo) {
    return {
      label: 'SEM DEMO',
      title: 'Só as estatísticas da plataforma — envie a demo pra completar (ADR, KAST, rating, replay)',
    }
  }
  return { label: 'AUTO', title: 'Baixada automaticamente pelo Coletor' }
}
```

O default `temDemo = true` mantém as chamadas antigas mostrando `AUTO`, sem
mudar o histórico de Partidas completas.

Em `Partida.jsx:1356-1361`, trocar as duas chamadas por
`origemPartida(m.source, m.temDemo)`. Em `Feed.jsx:60`, idem, com o campo
correspondente do item da lista.

- [ ] **Step 4: Rodar os testes do cliente**

Run: `cd site/client && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/client/src/lib/format.js site/client/src/pages/Partida.jsx site/client/src/pages/Feed.jsx site/client/src/test/
git commit -m "feat: badge SEM DEMO pra Partida stats-only"
```

---

## Task 8: Cliente — botão de envio e banner de estado

**Files:**
- Create: `site/client/src/lib/demoHeader.js`
- Create: `site/client/src/components/EnviarDemoDaPartida.jsx`
- Modify: `site/client/src/pages/Partida.jsx` (monta o componente no cabeçalho)
- Test: `site/client/src/test/EnviarDemoDaPartida.test.jsx`

**Interfaces:**
- Consumes: `POST /api/upload/upload-url` com `matchId` (Task 5);
  `temDemo` e `demoUpload` do detalhe (Task 6).
- Produces: `mapaDoCabecalho(file) -> Promise<string|null>`;
  `<EnviarDemoDaPartida partida={m} euSteamId={...} onEnviado={...} />`.

- [ ] **Step 1: Escrever os testes que falham**

`site/client/src/test/EnviarDemoDaPartida.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EnviarDemoDaPartida from '../components/EnviarDemoDaPartida.jsx'

const partidaBase = {
  id: '11111111-1111-1111-1111-111111111111',
  map: 'de_inferno',
  temDemo: false,
  demoUpload: null,
  players: [{ steamId: '765' }, { steamId: '999' }],
}

function arquivo(nome, conteudo) {
  return new File([conteudo], nome, { type: 'application/octet-stream' })
}

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('EnviarDemoDaPartida', () => {
  it('não aparece pra quem não jogou a partida', () => {
    const { container } = render(<EnviarDemoDaPartida partida={partidaBase} euSteamId="000" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('não aparece quando a partida já tem demo', () => {
    const { container } = render(
      <EnviarDemoDaPartida partida={{ ...partidaBase, temDemo: true }} euSteamId="765" />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('mostra o botão pra quem jogou numa partida sem demo', () => {
    render(<EnviarDemoDaPartida partida={partidaBase} euSteamId="765" />)
    expect(screen.getByRole('button', { name: /enviar demo desta partida/i })).toBeInTheDocument()
  })

  it('com envio em andamento: mostra o aviso e nenhum botão', () => {
    render(
      <EnviarDemoDaPartida
        partida={{ ...partidaBase, demoUpload: { status: 'processando', erro: null, enviadoPorVoce: false } }}
        euSteamId="765"
      />,
    )
    expect(screen.getByText(/em processamento/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enviar demo desta partida/i })).toBeNull()
  })

  it('falha de quem enviou: mostra o motivo e deixa enviar outra', () => {
    render(
      <EnviarDemoDaPartida
        partida={{
          ...partidaBase,
          demoUpload: { status: 'falhou', erro: 'o mapa da demo não confere', enviadoPorVoce: true },
        }}
        euSteamId="765"
      />,
    )
    expect(screen.getByText(/o mapa da demo não confere/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enviar demo desta partida/i })).toBeInTheDocument()
  })

  it('barra a demo de outro mapa antes de subir o arquivo', async () => {
    render(<EnviarDemoDaPartida partida={partidaBase} euSteamId="765" />)
    await userEvent.click(screen.getByRole('button', { name: /enviar demo desta partida/i }))
    const input = screen.getByLabelText(/arquivo/i)
    await userEvent.upload(input, arquivo('demo.dem', 'PBDEMS2 xxxx de_mirage xxxx'))
    await waitFor(() => expect(screen.getByText(/mirage/i)).toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('caminho feliz: pede a url e faz o PUT no R2', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'u1', uploadUrl: 'https://r2/put' }) })
      .mockResolvedValueOnce({ ok: true })
    const onEnviado = vi.fn()
    render(<EnviarDemoDaPartida partida={partidaBase} euSteamId="765" onEnviado={onEnviado} />)
    await userEvent.click(screen.getByRole('button', { name: /enviar demo desta partida/i }))
    await userEvent.upload(
      screen.getByLabelText(/arquivo/i),
      arquivo('demo.dem', 'PBDEMS2 xxxx de_inferno xxxx'),
    )
    await userEvent.click(screen.getByRole('button', { name: /^enviar$/i }))

    await waitFor(() => expect(onEnviado).toHaveBeenCalled())
    expect(global.fetch.mock.calls[0][0]).toBe('/api/upload/upload-url')
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).matchId).toBe(partidaBase.id)
    expect(global.fetch.mock.calls[1][0]).toBe('https://r2/put')
    expect(global.fetch.mock.calls[1][1].method).toBe('PUT')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/client && npx vitest run src/test/EnviarDemoDaPartida.test.jsx`
Expected: FAIL — módulo `../components/EnviarDemoDaPartida.jsx` não existe.

- [ ] **Step 3: Implementar o leitor de cabeçalho**

`site/client/src/lib/demoHeader.js`:

```js
// Pré-check barato do mapa antes de subir 100-300MB: o nome do mapa aparece como
// string nos primeiros KBs do .dem. É HEURÍSTICA, não garantia — no CS2 o cabeçalho
// é protobuf (PBDEMS2), sem offset fixo, então quando não achar nada a gente deixa
// passar e o Coletor decide (ele valida mapa E os 10 steam ids depois do parse).
const MAPA_RE = /de_[a-z0-9_]{2,20}/

const TRECHO_BYTES = 8192

export async function mapaDoCabecalho(arquivo) {
  try {
    const buf = await arquivo.slice(0, TRECHO_BYTES).arrayBuffer()
    const texto = new TextDecoder('latin1').decode(new Uint8Array(buf))
    return texto.match(MAPA_RE)?.[0] ?? null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Implementar o componente**

`site/client/src/components/EnviarDemoDaPartida.jsx`:

```jsx
import { useState } from 'react'
import { mapaDoCabecalho } from '../lib/demoHeader.js'
import { nomeMapa } from '../lib/format.js'

// Envio da Demo de uma Partida FACEIT stats-only, amarrado a ELA (matchId) — o
// servidor só emite a URL pré-assinada pra quem jogou, e o Coletor só grava se a
// Demo bater (mapa + os 10 Participantes). Ver
// docs/superpowers/specs/2026-07-25-enviar-demo-da-partida-faceit-design.md
export default function EnviarDemoDaPartida({ partida, euSteamId, onEnviado }) {
  const [aberto, setAberto] = useState(false)
  const [arquivo, setArquivo] = useState(null)
  const [erro, setErro] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const joguei = (partida.players ?? []).some((p) => p.steamId === euSteamId)
  const envio = partida.demoUpload
  const emAndamento = envio?.status === 'pendente' || envio?.status === 'processando'

  if (!joguei || partida.temDemo) return null

  if (emAndamento) {
    return (
      <div className="panel-cut-sm border border-borda bg-superficie px-3 py-2 font-mono text-xs text-texto-fraco">
        Demo em processamento — os dados completos aparecem em até 30 minutos.
      </div>
    )
  }

  async function escolher(lista) {
    setErro(null)
    const f = lista?.[0]
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.dem')) {
      setErro('Só arquivos .dem são aceitos.')
      return
    }
    const mapa = await mapaDoCabecalho(f)
    if (mapa && mapa !== partida.map) {
      setErro(`Essa demo é de ${nomeMapa(mapa)} e esta partida foi em ${nomeMapa(partida.map)}.`)
      return
    }
    setArquivo(f)
  }

  async function enviar() {
    if (!arquivo) return
    setEnviando(true)
    setErro(null)
    try {
      const resUrl = await fetch('/api/upload/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: arquivo.name, tamanho: arquivo.size, matchId: partida.id }),
      })
      const body = await resUrl.json().catch(() => ({}))
      if (!resUrl.ok) {
        setErro(body.erro ?? 'Erro ao preparar o envio')
        return
      }
      const resPut = await fetch(body.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: arquivo,
      })
      if (!resPut.ok) {
        setErro('Falha ao enviar o arquivo pro armazenamento')
        return
      }
      setAberto(false)
      setArquivo(null)
      onEnviado?.()
    } catch {
      setErro('Falha de rede ao enviar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="space-y-2">
      {envio?.status === 'falhou' && envio.enviadoPorVoce && (
        <div className="panel-cut-sm border border-perigo/40 bg-perigo/10 px-3 py-2 font-mono text-xs text-perigo">
          O envio anterior foi recusado: {envio.erro} Você pode enviar outra demo.
        </div>
      )}

      {!aberto ? (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="panel-cut-sm border border-borda bg-superficie px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-texto-fraco hover:border-destaque hover:text-texto"
        >
          Enviar demo desta partida
        </button>
      ) : (
        <div className="panel-cut-sm space-y-3 border border-borda bg-superficie p-3">
          <p className="font-mono text-xs text-texto-fraco">
            Baixe a demo desta partida na FACEIT e envie aqui. O processamento roda a cada ~30
            minutos e destrava ADR, KAST, rating, replay e clipes.
          </p>
          <label htmlFor="demo-da-partida" className="block font-mono text-xs text-texto">
            Arquivo .dem
          </label>
          <input
            id="demo-da-partida"
            type="file"
            accept=".dem"
            onChange={(e) => escolher(e.target.files)}
            className="block w-full font-mono text-xs text-texto-fraco"
          />
          {arquivo && <p className="font-mono text-xs text-texto-fraco">{arquivo.name}</p>}
          {erro && <p className="font-mono text-xs text-perigo">{erro}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={enviar}
              disabled={!arquivo || enviando}
              className="panel-cut-sm border border-destaque bg-destaque/10 px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-destaque disabled:opacity-40"
            >
              {enviando ? 'Enviando…' : 'Enviar'}
            </button>
            <button
              type="button"
              onClick={() => { setAberto(false); setArquivo(null); setErro(null) }}
              className="panel-cut-sm border border-borda px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-texto-fraco"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Montar na página da Partida**

Em `site/client/src/pages/Partida.jsx`, importar o componente e colocá-lo logo
depois do bloco `{m.endedEarly && (...)}` do cabeçalho (linha ~1368):

```jsx
      <EnviarDemoDaPartida partida={m} euSteamId={jogador?.steamId} onEnviado={carregar} />
```

`jogador` já vem de `const { jogador } = useAuth()`
([Partida.jsx:1151](site/client/src/pages/Partida.jsx:1151)) e `carregar` é a
função que rebusca o detalhe ([Partida.jsx:1215](site/client/src/pages/Partida.jsx:1215))
— ambos estão no escopo do componente `Partida`, não precisa criar nada.

O import vai junto dos outros, no topo do arquivo:

```jsx
import EnviarDemoDaPartida from '../components/EnviarDemoDaPartida.jsx'
```

- [ ] **Step 6: Rodar os testes do cliente**

Run: `cd site/client && npm test`
Expected: PASS.

- [ ] **Step 7: Build**

Run: `cd site/client && npm run build`
Expected: build sem erro.

- [ ] **Step 8: Commit**

```bash
git add site/client/src/lib/demoHeader.js site/client/src/components/EnviarDemoDaPartida.jsx site/client/src/pages/Partida.jsx site/client/src/test/EnviarDemoDaPartida.test.jsx
git commit -m "feat: botao de enviar demo na pagina da Partida"
```

---

## Verificação final

- [ ] `cd coletor && python -m pytest tests -q` — PASS
- [ ] `cd site/server && npm test` — PASS
- [ ] `cd site/client && npm test && npm run build` — PASS
- [ ] Migration `0051` aplicada em produção **antes** do merge, e o passo escrito
      na descrição da PR (`docs/WORKFLOW.md` §3).
