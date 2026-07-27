# KAST estilo Leetify

## Objetivo

Adicionar a métrica KAST (% de rounds em que o jogador teve Kill, Assist,
Sobreviveu ou foi vingado — Traded) ao placar da Partida, igual ao Leetify.
Rating não muda — já é uma implementação correta da fórmula pública do HLTV
Rating 1.0 (`hltv_rating()` em `transform.py`); não bate com o "Rating"/
"Personal Performance" do Leetify porque aqueles são proprietários deles
(o próprio Leetify explica isso no tooltip: usa o histórico pessoal do
jogador).

## O que já existe (reaproveitado, sem mudança)

- `kills_por_round_por_jogador(kills)` — `{steam_id: {round_number: qtd}}`,
  já usado pelo Rating.
- `trade_kills(kills, teams)` — já devolve `{round_number, attacker,
  avenged_teammate}` para cada kill que vingou um teammate morto há pouco
  (janela de 5s). `avenged_teammate` é exatamente quem teve o round contado
  como "Traded" no KAST.
- "Sobreviveu o round" é derivável da lista de `kills` (quem não aparece
  como `victim` naquele `round_number`).

## O que falta

- Assist POR ROUND. Hoje `parse.py` só acumula um total (`assists[ast] += 1`
  em `parse_demo`, coletor/src/coletor/parse.py:598) — descarta o
  `round_number` do evento. Precisa guardar o round de cada assist.

## Mudanças

### 1. Parser (`coletor/src/coletor/parse.py`)

No loop que já existe (por volta da linha 578-598), adicionar `"assister"`
ao dict de cada kill:

```python
kills.append(
    {
        "round_number": int(r["total_rounds_played"]) + 1,
        "tick": int(r["tick"]),
        "attacker": atk,
        "victim": vic,
        "assister": ast,
        "headshot": headshot,
        "team_kill": team_kill,
        "weapon": _arma_limpa(r.get("weapon")) or "",
    }
)
```

Isso não afeta a fusão de partes (Partidas Pro multi-.dem): `_offset_campo`
já preserva campos extras via spread (`{**it, campo: it[campo]+offset}`),
então `assister` sobrevive à fusão sem mudança lá.

### 2. `coletor/src/coletor/transform.py` — nova função `kast_pct`

```python
def kast_pct(kills, rounds_total):
    """% de rounds em que o jogador teve Kill, Assist, Sobreviveu ou foi
    vingado (Traded). {steam_id64: pct (float, 1 casa)}. rounds_total <= 0
    devolve {} (mesma guarda de hltv_rating)."""
    if rounds_total <= 0:
        return {}
    por_round = _agrupar_por_round(kills)
    teams = {}  # não precisa: trade_kills já foi chamado por enrich() com teams reais
    ...
```

(A implementação real usa os mesmos dados que `enrich()` já tem calculado —
`kpr` para kills, um novo agrupamento de assists por round a partir de
`kills`, `trade_kills(...)` já chamado, e um cálculo de sobrevivência por
round. Constrói-se um `set()` de `(steam_id64, round_number)` que satisfaz
K/A/S/T e divide por `rounds_total`. Detalhe exato de implementação e testes
ficam para o plano — aqui só o contrato: entrada `kills` (com `assister`),
`teams`, `trades` (já computado por `trade_kills`), `rounds_total`; saída
`{steam_id64: pct}`.)

Chamada dentro de `enrich()`, junto dos outros stats por jogador, e o
resultado vira `"kast_pct": kast.get(sid)` no dict de cada player (mesmo
padrão de `entry_kills`/`trade_kills`/etc já existente).

### 3. Migration — `match_players.kast_pct`

```sql
alter table match_players add column kast_pct numeric;
```

### 4. `coletor/src/coletor/db.py`

Adiciona `kast_pct` à lista de colunas do INSERT/ON CONFLICT de
`match_players` (mesmo padrão de `trade_kills`/`clutch_saves` já lá) e
`p.get("kast_pct")` (sem default — fica `null` se ausente, mesma
convenção de `rating`, que também não tem default numérico) na tupla de
valores.

### 5. Servidor (`site/server/src/routes/matches.js`)

No mapeamento de jogadores da rota `GET /:id`, adiciona
`kastPct: p.kast_pct != null ? Number(p.kast_pct) : null` (mesmo padrão do
`rating` já mapeado ali).

### 6. Cliente (`site/client/src/pages/Partida.jsx`)

Nova coluna KAST% no `Scoreboard`, escondida abaixo de `sm:` (mesmo grupo
de A/ADR/HS% que já ficam escondidos no mobile — não pode empurrar as 4
colunas essenciais pra fora da tela de novo), com `title` explicando (mesmo
padrão dos outros headers que acabaram de ganhar tooltip): "% dos rounds em
que ele teve kill, assist, sobreviveu ou foi vingado (trade)".

## Testes

- `transform.py`: `kast_pct` — cenários: round só com kill (conta), só com
  assist (conta), só sobrevivência (conta), só trade/vingança (conta), round
  sem nenhum dos 4 (não conta), rounds_total<=0 (devolve `{}`).
- `db.py`: `kast_pct` persistido no INSERT/ON CONFLICT.
- `matches.js`: `kastPct` no corpo da resposta.

## Fora de escopo

- Reprocessar partidas antigas agora — tem um reprocess-all rodando nesse
  exato momento (pro Head to Head); essa mudança só vale pra partidas
  processadas DEPOIS dela estar no ar. Reprocessar de novo pra backfillar
  KAST fica pra depois, sem pressa (o placar mostra "–" pra partida antiga
  sem o dado, mesmo padrão já usado no site pra dado ausente).
- Mudar o Rating — já está correto (fórmula pública do HLTV 1.0).
