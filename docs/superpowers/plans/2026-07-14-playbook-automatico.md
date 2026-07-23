# Playbook automático (Fase 4) — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** botão admin "Detectar táticas" na página do mapa de Táticas: analisa os rounds das demos (pro e grupo) já processadas, encontra padrões de execute/rush (várias utilitárias do mesmo time numa janela curta, caindo agrupadas numa região), apresenta candidatos ("Execute B — 3 smokes + 1 flash — visto em 4 rounds da Vitality") e cria a tática com um clique — auto-criando as granadas curadas envolvidas (com dedupe) e os papéis por jogador.

**Arquitetura:** um endpoint novo de LEITURA agrupada (server) + toda a inteligência de clustering/classificação no CLIENT (que já tem os callouts pra nomear regiões e o fluxo de criação de granada/tática das fases 2-3). Nada de coletor/Python — os dados necessários (map, round, lado, tipo, tick, posições, thrower, origem) já estão na tabela `lineups`.

## Global Constraints

- Mesmas das fases anteriores (SQL parametrizado/allowlist, UI pt-BR, tokens, mobile ≥40px/390px).
- Detecção é admin-only (é ferramenta de curadoria).
- Heurística v1 (deliberadamente simples, YAGNI): um ROUND é candidato quando o mesmo (match, round, lado) tem ≥3 granadas com `lado` não-nulo cujos ticks de arremesso cabem numa janela de 1920 ticks (~30s a 64) e cujos alvos têm centróide classificável (região = mais próximo entre os callouts noob "A"/"B"/"Mid"-equivalentes do mapa — client-side). Candidatos AGRUPAM entre rounds quando lado+região+multiconjunto de tipos igual e centróides a <0.06.

### Task F1: endpoint `GET /api/granadas/rounds-utilitaria`

**Files:** `site/server/src/routes/granadas.js`, `site/server/test/granadas.test.js`.

- `GET /rounds-utilitaria?map=` (requireAuth+requireAdmin; map validado por regex, obrigatório):

```sql
select l.match_id, l.round_number, l.lado, l.tipo, l.tick, l.origem,
       l.thrower_steam_id, l.thrower_nick,
       l.thrower_x, l.thrower_y, l.target_x, l.target_y,
       m.team_a_name, m.team_b_name
from lineups l
join matches m on m.id = l.match_id
where l.map = $1 and l.lado is not null
order by l.match_id, l.round_number, l.tick
limit 5000
```

- Resposta agrupada em JS por `(matchId, roundNumber, lado)`:

```json
[{ "matchId", "roundNumber", "lado", "origem", "teamAName", "teamBName",
   "granadas": [{ "tipo", "tick", "throwerSteamId", "throwerNick",
     "arremessoX", "arremessoY", "alvoX", "alvoY" }] }]
```

(números via `Number(...)`, camelCase, granadas ordenadas por tick). Grupos com <3 granadas podem ser filtrados já no server (menos payload).
- Testes (padrão do arquivo): 403 não-admin; 400 sem map; agrupamento correto com mock (2 rounds, um com 3 granadas, outro com 2 → só o de 3 volta); params 1:1.
- Commit: `feat: endpoint de rounds com utilitaria agrupada (base do playbook automatico)`.

### Task F2: detecção + criação com um clique (client)

**Files:** `site/client/src/lib/deteccaoTaticas.js` (novo, lógica pura testável a olho), `site/client/src/components/taticas/DetectarTaticas.jsx` (novo), `site/client/src/components/taticas/PaginaMapaTaticas.jsx` (botão admin + integração).

- `deteccaoTaticas.js` (funções puras):
  - `filtrarJanela(round)` → granadas do round que cabem na janela de 1920 ticks a partir da primeira (se as ≥3 primeiras não couberem, tenta a partir da segunda etc.; v1 simples: janela ancorada na primeira granada).
  - `classificarRegiao(callouts, cx, cy)` → 'A' | 'B' | 'MID' | null: entre os callouts nivel noob cujo nome normalizado é "A"/"B"/"Mid"/"Meio" (case-insensitive; aceite também nomes que contenham só isso), o mais próximo do centróide; null se o mapa não tiver os três.
  - `detectar(rounds, callouts)` → candidatos: para cada round válido (≥3 granadas na janela), calcula centróide dos alvos, região, assinatura = `lado|regiao|tipos ordenados` ; agrupa rounds com mesma assinatura e centróides <0.06; devolve `[{lado, regiao, tipos, rounds: [...], granadasRepresentativas, times}]` ordenado por nº de rounds desc. `granadasRepresentativas` = as do round mais recente do grupo (mantendo thrower/posições).
  - `montarTatica(candidato)` → `{titulo, tipo, local, lado, papeis}`: titulo tipo `"Execute B (3 smokes + flash)"`; tipo = 'execute' se lado T, 'setup' se CT; local = regiao (MID se null→ 'MID'? não: descarte candidato sem região); papéis = agrupa granadas por throwerSteamId ordenado pelo primeiro tick, cada papel `{descricao: "Jogador N: smoke Connector + flash Rampa" (nomes via calloutMaisProximo), granadas: [...]}`.
- `DetectarTaticas.jsx` (modal admin): botão "Detectar táticas" (na sidebar de PaginaMapaTaticas, admin) → fetch `/api/granadas/rounds-utilitaria?map=` + callouts já carregados → `detectar` → lista de candidatos (badge lado/região/tipos, "visto em N rounds · times X, Y", mini-radar com as granadas representativas reutilizando `MiniRadarTatica`-like ou os marcadores) → botão "Criar tática" por candidato:
  1. Pra cada granada representativa: dedupe contra `GET /api/granadas?map=` (tipo+lado e alvo <0.03 → reusa o id existente) senão `POST /api/granadas` (titulo via `nomeAutomatico` de `calloutsUtil.js`, descricao "Gerada da detecção automática (Nx rounds).", tecnica normal, botao esquerdo) e guarda o id.
  2. `POST /api/taticas-curadas` com o payload de `montarTatica` + granadaIds por papel.
  3. Progresso simples + erro visível + recarrega a lista de táticas no sucesso.
- Estados: detecção é computada on-demand (sem cache); candidato já criado nesta sessão fica marcado "criada ✓" (estado local).
- Mobile: modal tela cheia padrão M4.
- Commit: `feat: detectar taticas das demos (executes/setups) com criacao em um clique`.

### Task F3: verificação (controlador)

- Suítes + build; push; deploy; validação com dados reais do Inferno (Vitality vs Falcons) — a detecção deve achar os executes da partida do Major.
