# Premier Rating (CS Rating) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar a pontuação de Premier (CS Rating) de cada jogador no perfil (pontuação atual) e
dentro de cada Partida (pontuação antes daquela Partida + ganho/perda), lendo o dado direto do
replay já processado — sem API externa.

**Architecture:** O demo do CS2 guarda, por jogador, `rank` (m_iCompetitiveRanking, pontuação
atual) e as 3 previsões `rank_if_win`/`rank_if_loss`/`rank_if_tie` (m_iCompetitiveRankingPredicted_*)
que o próprio jogo já calcula. O Coletor lê esses 4 campos no MESMO tick onde já lê o placar final
(`end_tick`, ~100 ticks antes do painel de fim de partida — já usado por `snapf` em `parse_demo`),
escolhe a previsão certa comparando com o placar final por time (`score`), e grava
`premier_rating_before`/`premier_rating_after` em `match_players`. Só populado quando `rank` existe
no replay (Wingman/Competitivo-por-mapa/Partida Pro não têm esse campo — vira `null`
naturalmente, sem precisar detectar o modo por um enum separado).

**Tech Stack:** Python (Coletor/demoparser2), Postgres/Supabase, Express, React.

## Global Constraints

- Toda query nova em `db.py` precisa manter `sql.count("%s") == len(params)` — o teste genérico
  `test_todas_as_queries_de_store_parsed_tem_placeholders_e_params_alinhados` (já existe em
  `coletor/tests/test_storage_db.py`) já cobre isso pra QUALQUER query de `store_parsed`, incluindo
  a nova; rodar a suíte inteira depois de editar `_write_players` é obrigatório, não opcional.
- Nenhum campo de julgamento bom/ruim depende só de cor — o ganho/perda de Premier precisa de
  ícone/seta além da cor verde/vermelho (Regra do Sinal Duplo, DESIGN.md).
- Todo container/badge novo usa `panel-cut-sm` (corte diagonal), nunca `border-radius` — ver
  DESIGN.md, Don't.
- Quando não há dado de Premier pra uma Partida/jogador, o elemento correspondente não aparece
  (não mostra "sem dado" cru ocupando espaço) — só a maioria das Partidas do grupo é Premier, mas
  Partida Pro e Wingman nunca são.

---

### Task 1: Migration — colunas de Premier em `match_players`

**Files:**
- Create: `supabase/migrations/0028_premier_rating.sql`

**Interfaces:**
- Produces: colunas `match_players.premier_rating_before numeric`, `match_players.premier_rating_after numeric` — usadas pela Task 2 (grava) e Task 3 (lê).

- [ ] **Step 1: Escrever a migration**

```sql
alter table match_players add column premier_rating_before numeric;
alter table match_players add column premier_rating_after numeric;
```

- [ ] **Step 2: Aplicar a migration**

Igual toda migration desse projeto: precisa de confirmação nomeada explícita do usuário antes de
aplicar (`apply_migration` via Supabase MCP, project_id `hrpgbrfqxqjxpsjeymec`) — não aplicar sem
essa confirmação, mesmo com autorização geral prévia dada em outro contexto.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0028_premier_rating.sql
git commit -m "feat: migration premier_rating_before/after em match_players"
```

---

### Task 2: Coletor — extrai e grava Premier rating

**Files:**
- Modify: `coletor/src/coletor/parse.py` (nova função pura `_premier_ratings` + wiring em `parse_demo`)
- Modify: `coletor/src/coletor/db.py:112-200` (`_write_players` — 2 colunas novas)
- Test: `coletor/tests/test_parse.py` (função pura)
- Test: `coletor/tests/test_storage_db.py` (persistência)

**Interfaces:**
- Consumes: `_num(v)`, `_sid(v)` (já existentes em `parse.py`, linhas 53-68) — conversão segura de
  NaN/None do pandas.
- Produces: `_premier_ratings(rows, fixed, score) -> {steam_id64: {"before": float, "after": float}}`
  — usada só dentro de `parse_demo`. Cada player dict no `players` (retorno de `parse_demo`) ganha
  `"premier_rating_before"` e `"premier_rating_after"` (chaves sempre presentes, valor `None`
  quando não há dado de Premier).

- [ ] **Step 1: Escrever o teste da função pura (falha primeiro)**

Adicionar em `coletor/tests/test_parse.py`, logo após `test_txt_converte_nan_e_none_em_none_e_o_resto_em_str`:

```python
def test_premier_ratings_escolhe_previsao_certa_pelo_placar_e_ignora_quem_nao_tem_rank():
    # time A venceu (13x5): quem é do time A usa rank_if_win, quem é do time B usa
    # rank_if_loss. "3" não tem campo "rank" (None) — Partida Pro/Wingman/Competitivo
    # por mapa não têm Premier, então some do resultado em vez de aparecer com lixo.
    rows = [
        {"steamid": "1", "rank": 5200, "rank_if_win": 5242, "rank_if_loss": 5150, "rank_if_tie": 5200},
        {"steamid": "2", "rank": 8100, "rank_if_win": 8151, "rank_if_loss": 8040, "rank_if_tie": 8100},
        {"steamid": "3", "rank": float("nan"), "rank_if_win": float("nan"), "rank_if_loss": float("nan"), "rank_if_tie": float("nan")},
    ]
    fixed = {"1": "A", "2": "B", "3": "A"}
    score = {"A": 13, "B": 5}
    resultado = parse._premier_ratings(rows, fixed, score)
    assert resultado == {
        "1": {"before": 5200, "after": 5242},  # time A, venceu -> rank_if_win
        "2": {"before": 8100, "after": 8040},  # time B, perdeu -> rank_if_loss
    }
    assert "3" not in resultado


def test_premier_ratings_empate_usa_rank_if_tie():
    rows = [{"steamid": "1", "rank": 12000, "rank_if_win": 12050, "rank_if_loss": 11940, "rank_if_tie": 12000}]
    fixed = {"1": "A"}
    score = {"A": 12, "B": 12}
    resultado = parse._premier_ratings(rows, fixed, score)
    assert resultado == {"1": {"before": 12000, "after": 12000}}
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd coletor && ./.venv/Scripts/python.exe -m pytest tests/test_parse.py -k premier_ratings -v`
Expected: FAIL com `AttributeError: module 'coletor.parse' has no attribute '_premier_ratings'`

- [ ] **Step 3: Implementar a função pura**

Adicionar em `coletor/src/coletor/parse.py`, logo depois de `_txt` (linha ~87):

```python
def _premier_ratings(rows, fixed, score):
    """A partir de um snapshot de tick (rank/rank_if_win/rank_if_loss/rank_if_tie por
    jogador, lido no mesmo end_tick do placar final) + o time fixo de cada um + o
    placar final por time, devolve {steam_id64: {"before": x, "after": y}} só pra quem
    tem dado de Premier (rank presente) — Wingman/Competitivo por mapa/Partida Pro não
    têm esse campo no replay, então saem de fora naturalmente (sem precisar detectar o
    modo por um enum separado, que não é documentado publicamente)."""
    resultado = {}
    for r in rows:
        sid = _sid(r.get("steamid"))
        antes = _num(r.get("rank"))
        time = fixed.get(sid)
        if not sid or antes is None or not time:
            continue
        outro = "B" if time == "A" else "A"
        if score.get(time, 0) > score.get(outro, 0):
            depois = _num(r.get("rank_if_win"))
        elif score.get(time, 0) < score.get(outro, 0):
            depois = _num(r.get("rank_if_loss"))
        else:
            depois = _num(r.get("rank_if_tie"))
        if depois is not None:
            resultado[sid] = {"before": antes, "after": depois}
    return resultado
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd coletor && ./.venv/Scripts/python.exe -m pytest tests/test_parse.py -k premier_ratings -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Ligar em `parse_demo`**

Em `coletor/src/coletor/parse.py`, logo antes de `players = [` (linha 825, depois do bloco de
`snapf`/`score` que já existe nas linhas 567-574):

```python
    # Premier: mesmo tick (end_tick) onde o placar final já é lido acima. Best-effort —
    # se o replay não tiver esses campos (Wingman/Competitivo por mapa/Partida Pro),
    # cai pra dict vazio em vez de derrubar o ingest inteiro (mesmo padrão do round_econ).
    premier = {}
    try:
        premier_snap = parser.parse_ticks(
            ["rank", "rank_if_win", "rank_if_loss", "rank_if_tie"], ticks=[end_tick],
        )
        premier = _premier_ratings(premier_snap.to_dict("records"), fixed, score)
    except Exception:  # noqa: BLE001
        pass

```

E dentro do dict comprehension de `players` (linha 825-857), adicionar duas chaves (junto de
`"weapons": weapons.get(sid, {}),`):

```python
            "premier_rating_before": premier.get(sid, {}).get("before"),
            "premier_rating_after": premier.get(sid, {}).get("after"),
```

- [ ] **Step 6: `_write_players` grava as 2 colunas novas**

Em `coletor/src/coletor/db.py`, dentro de `_write_players` (linhas 112-200) — editar a MESMA
query, com cuidado extra de contar `%s` == parâmetros (é exatamente a classe de bug já achada
uma vez neste projeto, no INSERT de KAST):

```python
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
```

- [ ] **Step 7: Teste de persistência (segue o padrão de `test_store_parsed_grava_kast_pct_em_match_players`)**

Adicionar em `coletor/tests/test_storage_db.py`:

```python
def test_store_parsed_grava_premier_rating_em_match_players():
    cur = FakeCursor()
    parsed = _parte_base(players=[
        {"steam_id64": "1", "team": "A", "premier_rating_before": 5200, "premier_rating_after": 5242},
    ])
    db.store_parsed(cur, "m1", parsed)
    insert = next(q for q, _ in cur.queries if "insert into match_players" in q)
    params = next(p for q, p in cur.queries if q == insert)
    assert params[-2:] == (5200, 5242)
```

(Ajustar o nome/assinatura de `_parte_base` pro que já existir em `test_storage_db.py` — usar o
helper de fixture já presente no arquivo, só adicionando os 2 campos novos ao dict de jogador.)

- [ ] **Step 8: Rodar a suíte inteira do Coletor (garante que o teste genérico de placeholder ainda passa)**

Run: `cd coletor && ./.venv/Scripts/python.exe -m pytest -q`
Expected: todos os testes passam, incluindo `test_todas_as_queries_de_store_parsed_tem_placeholders_e_params_alinhados`

- [ ] **Step 9: Commit**

```bash
git add coletor/src/coletor/parse.py coletor/src/coletor/db.py coletor/tests/test_parse.py coletor/tests/test_storage_db.py
git commit -m "feat: extrai e grava Premier rating (CS Rating) por jogador/partida"
```

---

### Task 3: Server — expõe Premier rating nas rotas

**Files:**
- Modify: `site/server/src/routes/profile.js:396-490` (rota `/api/profile/:steamId`)
- Modify: `site/server/src/routes/matches.js` (rota `/api/matches/:id`, SELECT de `players` — linha ~132-144 já lida nesta sessão)
- Test: `site/server/test/profile.test.js`
- Test: `site/server/test/matches.test.js`

**Interfaces:**
- Consumes: colunas `match_players.premier_rating_before/after` (Task 1/2).
- Produces: `GET /api/profile/:steamId` ganha `premierAtual: number | null` (nível raiz da
  resposta) e cada item de `recentes[]` ganha `premierBefore`/`premierAfter` (`number | null`).
  `GET /api/matches/:id` ganha `premierBefore`/`premierAfter` (`number | null`) em cada jogador de
  `players[]`.

- [ ] **Step 1: `recentes` — adicionar as 2 colunas na query e no mapeamento**

Em `site/server/src/routes/profile.js`, na query de `recentes` (linha 406-414), adicionar ao
SELECT:

```js
      db.query(
        `select m.id, m.map, m.played_at, m.score_a, m.score_b,
                mp.kills, mp.deaths, mp.assists, mp.rating, mp.won,
                mp.damage, mp.rounds_played, mp.headshot_kills,
                mp.premier_rating_before, mp.premier_rating_after
         from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = $1 and m.status = 'parsed'${recentesPeriodo}${recentesGrupo}
         order by m.played_at desc nulls last limit 20`,
        recentesParams,
      ),
```

E no mapeamento de `recentes` (linha 478-490), adicionar:

```js
        premierBefore: r.premier_rating_before == null ? null : Number(r.premier_rating_before),
        premierAfter: r.premier_rating_after == null ? null : Number(r.premier_rating_after),
```

- [ ] **Step 2: `premierAtual` — nova query, mais recente Premier de TODO o histórico (sem filtro de período, igual badges)**

`periodoWhere(from, to, params)` e `grupoWhere(groupId, params)` (definidas em
`site/server/src/routes/profile.js:12-29`) seguem uma convenção fixa: recebem um array `params`
já existente, empurram o(s) novo(s) valor(es) nele e devolvem o fragmento SQL com o placeholder
`$N` já no índice certo (`` `$${params.length}` ``) — é assim que `mapaGrupo`/`recentesGrupo`/
`destaquesGrupo` já são montados nas linhas 386-394. A nova query de `premierAtual` segue
exatamente o mesmo padrão, com seu próprio array `premierParams` (sem filtro de período — Premier
atual é igual badges, sempre o histórico inteiro, não o período filtrado da tela):

```js
    const premierParams = [steamId]
    const premierGrupo = grupoWhere(req.groupId, premierParams)
```

Adicionar essas 2 linhas junto das outras declarações de params (logo após a linha 394,
`const destaquesGrupo = grupoWhere(req.groupId, destaquesParams)`). Depois, adicionar ao
`Promise.all` (linha 396), junto das outras queries — uma nova entrada `premierRow`:

```js
      db.query(
        `select mp.premier_rating_after
         from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = $1 and m.status = 'parsed' and mp.premier_rating_after is not null${premierGrupo}
         order by m.played_at desc nulls last limit 1`,
        premierParams,
      ),
```

E no destructuring do `Promise.all` (linha 396, `const [stats, porMapa, recentes, sinergia, evolucao, statsGerais, sequencia, estilo, destaques, armas, economia] = await Promise.all([`), adicionar `premierRow` ao final da lista de nomes, na mesma posição que a nova query ocupa no array.

E no `res.json(...)` final (linha 454), adicionar:

```js
      premierAtual: premierRow.rows[0]?.premier_rating_after != null ? Number(premierRow.rows[0].premier_rating_after) : null,
```

- [ ] **Step 3: Teste do server pra `/api/profile/:steamId`**

Em `site/server/test/profile.test.js`, adicionar um teste seguindo o padrão dos já existentes no
arquivo (mock do `db.query` por chamada) verificando que `premierAtual` e
`recentes[].premierBefore/premierAfter` aparecem corretamente na resposta quando o banco devolve
esses valores, e como `null` quando o banco devolve `null`.

- [ ] **Step 4: `GET /api/matches/:id` — scoreboard por jogador**

Em `site/server/src/routes/matches.js`, na query de `players` da rota `/:id` (em torno da linha
132-144, já lida nesta sessão — mesma query que tem `mp.kast_pct`), adicionar ao SELECT:
`mp.premier_rating_before, mp.premier_rating_after`. No mapeamento de jogadores da mesma rota
(onde `kastPct` já é mapeado), adicionar:

```js
        premierBefore: p.premier_rating_before == null ? null : Number(p.premier_rating_before),
        premierAfter: p.premier_rating_after == null ? null : Number(p.premier_rating_after),
```

- [ ] **Step 5: Teste do server pra `/api/matches/:id`**

Em `site/server/test/matches.test.js`, seguindo o padrão já existente de teste dessa rota,
adicionar verificação de que `premierBefore`/`premierAfter` aparecem no jogador quando o banco
devolve valor, e `null` quando não.

- [ ] **Step 6: Rodar a suíte do server**

Run: `cd site/server && npm test`
Expected: todos os testes passam (194 + os novos)

- [ ] **Step 7: Commit**

```bash
git add site/server/src/routes/profile.js site/server/src/routes/matches.js site/server/test/profile.test.js site/server/test/matches.test.js
git commit -m "feat: expoe Premier rating nas rotas de perfil e partida"
```

---

### Task 4: Client — badge de Premier no perfil e no placar da Partida

**Files:**
- Create: `site/client/src/components/ui/PremierBadge.jsx`
- Modify: `site/client/src/components/ui/index.js` (export)
- Modify: `site/client/src/pages/JogadorPerfil.jsx` (mostra `premierAtual`)
- Modify: `site/client/src/pages/Partida.jsx` (Scoreboard — mostra `premierBefore` + delta por jogador)
- Test: `site/client/src/test/ui.test.jsx`

**Interfaces:**
- Consumes: `premierAtual` (raiz da resposta de `/api/profile/:steamId`), `premierBefore`/
  `premierAfter` (por item de `recentes[]` e por jogador em `/api/matches/:id`).
- Produces: `PremierBadge({ valor, size })` — `valor` é o CS Rating atual (number); `size`
  opcional (`'md'` default, `'sm'` pro placar da Partida). Não renderiza nada (`return null`)
  quando `valor == null`.

- [ ] **Step 1: `PremierBadge.jsx`**

```jsx
// Badge de Premier (CS Rating) — mesmas 7 faixas de cor que o próprio CS2 usa (fonte:
// pesquisa web confirmada na spec, docs/superpowers/specs/2026-07-16-premier-rating-design.md).
// Não renderiza nada se o jogador nunca jogou Premier (valor null) — sem "sem dado" cru
// ocupando espaço num lugar que boa parte do grupo pode nunca ter usado.
const FAIXAS = [
  { max: 5000, cor: 'text-texto-fraco', bg: 'bg-superficie-alta', border: 'border-borda' },
  { max: 10000, cor: 'text-time-b', bg: 'bg-time-b/10', border: 'border-time-b/40' },
  { max: 15000, cor: 'text-[#4f7fff]', bg: 'bg-[#4f7fff]/10', border: 'border-[#4f7fff]/40' },
  { max: 20000, cor: 'text-[#a855f7]', bg: 'bg-[#a855f7]/10', border: 'border-[#a855f7]/40' },
  { max: 25000, cor: 'text-[#ec4899]', bg: 'bg-[#ec4899]/10', border: 'border-[#ec4899]/40' },
  { max: 30000, cor: 'text-perigo', bg: 'bg-perigo/10', border: 'border-perigo/40' },
  { max: Infinity, cor: 'text-[#facc15]', bg: 'bg-[#facc15]/10', border: 'border-[#facc15]/40' },
]
function faixaDe(valor) {
  return FAIXAS.find((f) => valor < f.max) ?? FAIXAS[FAIXAS.length - 1]
}

export default function PremierBadge({ valor, size = 'md' }) {
  if (valor == null) return null
  const f = faixaDe(valor)
  const grande = size !== 'sm'
  return (
    <span
      title="Premier (CS Rating)"
      className={`panel-cut-sm inline-flex items-center gap-1 border font-mono font-bold tabular-nums ${f.bg} ${f.border} ${f.cor} ${
        grande ? 'px-2 py-1 text-sm' : 'px-1.5 py-0.5 text-xs'
      }`}
    >
      {Math.round(valor)}
    </span>
  )
}
```

- [ ] **Step 2: Export**

Em `site/client/src/components/ui/index.js`, adicionar:

```js
export { default as PremierBadge } from './PremierBadge.jsx'
```

- [ ] **Step 3: Teste de fumaça (mesmo padrão de `ui.test.jsx`)**

Adicionar em `site/client/src/test/ui.test.jsx`:

```jsx
  it('PremierBadge mostra o valor e não renderiza nada quando null', () => {
    const { getByText, container } = render(<PremierBadge valor={5200} />)
    expect(getByText('5200')).toBeInTheDocument()
    const { container: vazio } = render(<PremierBadge valor={null} />)
    expect(vazio.firstChild).toBeNull()
  })
```

(Adicionar `PremierBadge` ao import de `../components/ui/index.js` no topo do arquivo de teste.)

- [ ] **Step 4: Rodar o teste**

Run: `cd site/client && npm test`
Expected: todos passam, incluindo o novo

- [ ] **Step 5: `JogadorPerfil.jsx` — mostrar `premierAtual`**

O estado já é um único objeto genérico (`const [data, setData] = useState(null)`, preenchido via
`.then(setData)` no `fetch` de `/api/profile/:steamId` — não precisa de estado novo, o campo
`premierAtual` já chega dentro de `data` assim que a Task 3 estiver no ar).

Em `site/client/src/pages/JogadorPerfil.jsx:4`, adicionar `PremierBadge` ao import:

```jsx
import { Card, SectionHeader, StatTile, RatingBadge, DataTable, MapIcon, Badge, Select, PremierBadge } from '../components/ui'
```

Em `site/client/src/pages/JogadorPerfil.jsx:194`, adicionar `premierAtual` ao destructuring:

```jsx
  const { jogador, stats, porMapa, recentes, sinergia, evolucao, badges, estilo, destaques, armas, economia, premierAtual } = data
```

Em `site/client/src/pages/JogadorPerfil.jsx:205-210` (dentro do header, ao lado do nick e do
`TagEstilo`), adicionar o badge:

```jsx
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-display text-2xl font-bold uppercase tracking-wide text-texto">
                {jogador.nick || jogador.steamId}
              </h2>
              <TagEstilo estilo={estilo} />
              <PremierBadge valor={premierAtual} />
            </div>
```

(`PremierBadge` já não renderiza nada quando `premierAtual` é `null` — jogador que nunca jogou
Premier não ganha espaço vazio no header.)

- [ ] **Step 6: `Partida.jsx` Scoreboard — mostrar `premierBefore` + delta**

`Scoreboard` (`site/client/src/pages/Partida.jsx:397`) recebe `jogadores` (array) como prop. A
coluna de Premier só aparece quando pelo menos 1 jogador do TIME tem `premierBefore != null`
(Partida Pro/Wingman nunca terão; Partidas de Premier normais, todos terão) — diferente de KAST
(`p.kastPct != null ? ... : '–'`, linha 457), que sempre mostra a coluna com um traço porque a
ausência ali é "ainda não reprocessado", não "esse modo nunca tem esse dado". Calcular uma vez,
logo no topo do componente:

```jsx
function Scoreboard({ time, jogadores, matchId, podePromover, onPromover, promovendo }) {
  const [expandido, setExpandido] = useState(null)
  const [detalheAberto, setDetalheAberto] = useState(null)
  const temPremier = jogadores.some((p) => p.premierBefore != null)
```

No `<thead>` (`site/client/src/pages/Partida.jsx:416-417`), adicionar o `<th>` condicional entre
KAST e Rating:

```jsx
            <th className="hidden cursor-help px-2 py-2 text-right underline decoration-dotted underline-offset-2 sm:table-cell" title="KAST — % dos rounds em que ele teve kill, assist, sobreviveu ou foi vingado (trade)">KAST</th>
            {temPremier && (
              <th className="hidden cursor-help px-2 py-2 text-right underline decoration-dotted underline-offset-2 sm:table-cell" title="Pontuação de Premier (CS Rating) antes dessa partida, e quanto ganhou/perdeu">Premier</th>
            )}
            <th className="cursor-help px-3 py-2 text-right underline decoration-dotted underline-offset-2" title="Aproximação do HLTV Rating 1.0: combina kills/round, sobrevivência/round e multi-kills (2K/3K/4K/5K) num único número — acima de 1.00 é acima da média">Rating</th>
```

No `<tbody>` (`site/client/src/pages/Partida.jsx:457-458`), adicionar o `<td>` condicional na
mesma posição:

```jsx
                  <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">{p.kastPct != null ? `${p.kastPct}%` : '–'}</td>
                  {temPremier && (
                    <td className="hidden px-2 py-2 text-right sm:table-cell">
                      {p.premierBefore != null && (
                        <>
                          <span className="font-mono text-xs tabular-nums text-texto-fraco">{Math.round(p.premierBefore)}</span>
                          {p.premierAfter != null && (
                            <span className={`ml-1 font-mono text-xs font-semibold tabular-nums ${p.premierAfter >= p.premierBefore ? 'text-sucesso' : 'text-perigo'}`}>
                              {p.premierAfter >= p.premierBefore ? '▲' : '▼'}{Math.abs(Math.round(p.premierAfter - p.premierBefore))}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  )}
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${corRating(p.rating)}`}>
                    {p.rating?.toFixed(2) ?? '–'}
                  </td>
```

(`temPremier` é por TIME, calculado a partir da prop `jogadores` do próprio `Scoreboard` — como o
componente já é instanciado uma vez por time, cada lado decide independentemente se mostra a
coluna. Se um time inteiro não tiver Premier mas o outro tiver, as duas tabelas ficam com número
de colunas diferente — aceitável, cada `Scoreboard` é uma tabela própria, não compartilham
`<thead>`.)

- [ ] **Step 7: Build + testes do client**

Run: `cd site/client && npm run build && npm test`
Expected: build limpo, todos os testes passam

- [ ] **Step 8: Verificação visual**

Se houver acesso de login ao ambiente rodando (`npm run dev` + navegador), abrir um Perfil e uma
Partida com dado de Premier e conferir visualmente: badge no header do Perfil (cor certa pra
faixa), coluna "Premier" no placar da Partida com valor antes + delta colorido com seta. Sem
acesso de login disponível, validar via mockup estático isolado (HTML standalone renderizando
`PremierBadge` nas 7 faixas de cor + uma linha de placar com delta positivo e negativo) antes de
considerar a task pronta.

- [ ] **Step 9: Commit**

```bash
git add site/client/src/components/ui/PremierBadge.jsx site/client/src/components/ui/index.js site/client/src/pages/JogadorPerfil.jsx site/client/src/pages/Partida.jsx site/client/src/test/ui.test.jsx
git commit -m "feat: badge de Premier Rating no perfil e no placar da Partida"
```

---

### Task 5: Reprocessar partidas antigas (backfill)

**Files:** nenhum (operação, não código)

- [ ] **Step 1: Confirmar com o usuário e disparar `reprocessar_tudo=true`** (mesmo mecanismo já
  usado pro KAST/NaN nesta sessão) — só depois que Tasks 1-4 estiverem em produção.
