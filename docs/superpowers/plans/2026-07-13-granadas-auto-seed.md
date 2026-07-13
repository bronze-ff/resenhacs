# Auto-cadastro de granadas em lote (das demos pro) — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** admin gera a biblioteca curada de um mapa em um clique a partir das granadas mais usadas nas demos (sobretudo pro), com título automático via callout mais próximo; entradas sem vídeo ganham link "buscar no YouTube".

**Decisões (aprovadas em conversa):** título/descrição gerados são NOSSOS (callouts + tipo + técnica) — nada copiado de sites de terceiros; vídeo continua manual (link do YouTube), só facilitado pela busca pronta.

## Global Constraints

- Mesmas do plano anterior (SQL parametrizado/allowlist, UI pt-BR, tokens Tailwind, posições 0..1).
- `lado` na tabela `lineups` é NULLABLE (dados antigos não têm; só demos processadas após o deploy preenchem).
- Geração em lote acontece no CLIENT (admin logado): o browser já tem callouts carregados e usa o `POST /api/granadas` existente item a item — nenhum endpoint novo de escrita em lote no servidor.

### Task A: lado do arremessador (coletor + migration + sugestões)

**Files:** `coletor/src/coletor/parse.py`, `coletor/src/coletor/db.py`, `coletor/src/coletor/main.py` (`_montar_lineups`), `supabase/migrations/0017_lineups_lado.sql`, `site/server/src/routes/granadas.js` (`/sugestoes`), testes correspondentes.

1. Migration 0017: `alter table lineups add column lado text check (lado in ('T', 'CT'));` (nullable).
2. parse.py: no snapshot batched dos weapon_fire de granada (`snap_fire`, que já busca X/Y/yaw/pitch por `parse_ticks`), incluir `team_num` e converter pra `'T'`/`'CT'` (team_num 2=T, 3=CT — mesma convenção já usada no arquivo); propagar `throwerLado` junto de `throwerX/Y` em `_dados_arremesso`/itens de smokes/fires/flashes/hes (None quando não correlacionado).
3. `_montar_lineups` (main.py): incluir `"lado": g.get("throwerLado")` no dict.
4. db.py `_write_lineups`: coluna `lado` no insert (param a mais).
5. `/sugestoes` (granadas.js): adicionar `lado` ao SELECT/GROUP BY (`group by tipo, origem, lado, ...`), devolver `lado` (pode ser null) no JSON.
6. Testes: parser (item com team_num vira lado certo; sem correlação = None), db (insert com lado), server (sugestões devolvem lado; mock com lado null não quebra).

### Task B: geração em lote no client + busca no YouTube

**Files:** `site/client/src/components/granadas/PaginaMapa.jsx`, `FormGranada.jsx`, `DetalheGranada.jsx`, helper novo `site/client/src/lib/calloutsUtil.js`.

1. `calloutsUtil.js`: `calloutMaisProximo(callouts, x, y)` → callout de menor distância euclidiana (ou null se lista vazia); `nomeAutomatico(tipo, callouts, alvoX, alvoY, arremessoX, arremessoY)` → ex.: `"Smoke Connector — de Base T"` (rótulos de tipo: Smoke/Flash/Molotov/HE; se não houver callout, `"Smoke em (52, 47)"` com coords %).
2. Botão "Gerar biblioteca deste mapa" na seção Sugestões (admin, aparece quando `sugestoes?.length > 0`): itera os clusters visíveis (até 15), pula os SEM `lado` (não dá pra cadastrar sem lado — mostra aviso "N sem lado identificado (demos antigas)"), pula os que já têm entrada curada do mesmo tipo/lado com alvo a menos de 0.03 de distância (dedupe contra `lineups` carregados — refetch de TODOS os lados pra comparar: use um fetch dedicado `/api/granadas?map=` sem lado), e POSTa os demais um a um (`titulo` = nomeAutomatico, `descricao` = `"Gerada automaticamente das demos (NNx). Adicione um vídeo."`, tecnica normal, botao esquerdo, passos []). Mostra progresso simples ("cadastrando 3/12…") e recarrega no fim.
3. "Buscar vídeo no YouTube": no `DetalheGranada`, quando `!embed`, além do texto atual, um link `<a target="_blank" rel="noreferrer">` pra `https://www.youtube.com/results?search_query=${encodeURIComponent(\`${nomeMapa(granada.map)} ${granada.tipo} ${titulo-limpo}\`)}`; no `FormGranada`, o mesmo link ao lado do campo de vídeo (usando título digitado + mapa).
4. Build + commit.

### Task C: verificação integrada (suítes + build) e aplicar migration 0017 em produção (controlador).
