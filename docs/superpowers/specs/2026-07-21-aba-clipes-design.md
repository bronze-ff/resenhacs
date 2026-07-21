# Aba "Clipes" (melhores clipes + leaderboard) — Design

**Data:** 2026-07-21
**Status:** aprovado, aguardando plano de implementação

## Problema

O Allstar.gg tem uma tela de "Competitions" que mostra os melhores clipes do
período (semana/mês) com uma pontuação por clipe e um leaderboard de jogadores.
O Resenha já gera clipes reais (Allstar, ADR-0004), mas eles só aparecem
espalhados dentro da aba Clipes de cada Partida — não existe um lugar central
pra ver "quais foram os melhores momentos da semana do grupo".

## Objetivo

Nova página/aba **Clipes** (nível de menu, não dentro de uma Partida) que
lista os clipes reais gerados pelo Allstar, ordenados por uma pontuação
própria calculada a partir dos dados que o Resenha já coleta, com um
leaderboard de jogadores ao lado. Filtro por período: Semana / Mês / Sempre.

## Decisões travadas (do brainstorming)

- **A Allstar não expõe a fórmula de pontuação deles** (o webhook não manda
  nenhum campo de score) — a pontuação é **inventada pelo Resenha**, baseada
  no tipo de jogada (`highlights.kind`) e se todos os kills daquele round
  foram headshot. Não é uma tentativa de replicar o algoritmo deles.
- **Escopo**: só clipes com `allstar_clips.status = 'Processed'` (clipe real,
  pronto). Links manuais da tabela `clips` (Medal/YouTube/etc, colados à mão)
  ficam de fora — não têm highlight/round associado pra pontuar.
- **Período**: abas fixas Semana / Mês / Sempre (não um seletor de data livre).
- **Leaderboard de jogadores**: rank, quantidade de clipes, melhor pontuação —
  igual ao painel lateral do Allstar.
- **Visibilidade**: mesma regra do resto do site pós-refactor de amizades —
  só entram clipes de partidas visíveis ao viewer (participação ou amigo
  accepted de algum participante).

## Fórmula de pontuação

Por clipe (= 1 linha de `allstar_clips` com seu `highlight` associado):

**Base pelo tipo da jogada** (`highlights.kind`):

| kind | pontos |
|---|---|
| `ace` | 100 |
| `clutch_1v5` | 100 |
| `clutch_1v4` | 85 |
| `quad` | 80 |
| `clutch_1v3` | 65 |
| `triple` | 60 |
| `clutch_1v2` | 45 |
| `clutch_1v1` | 25 |
| qualquer outro | 10 (piso — não deveria acontecer hoje, já que só `allstar_clips` tem clipe real e a geração só roda pra ace/quad/triple/clutch, mas evita `NaN`/undefined se um kind novo aparecer) |

**Bônus:** `+20` se **todos** os kills daquele jogador naquele round
(`kill_positions` filtrado por `match_id`, `round_number`, `killer =
steam_id64` do highlight) foram `headshot = true`. Round com 0 kills
registrados (não deveria acontecer, mas defensivo) não recebe o bônus.

`pontuacaoTotal = base(kind) + (todosHeadshot ? 20 : 0)`

A resposta da API já vem com o breakdown (`{ base, kind, bonusHeadshot,
total }`) — o front não recalcula nada, só exibe.

## Arquitetura

### Server: novo módulo + rota

- **`site/server/src/clipesScore.js`** — função pura
  `calcularPontuacao({ kind, todosHeadshot }) -> { base, bonusHeadshot, total }`,
  usando a tabela acima. Isolado num módulo próprio pra ser testável sem tocar
  banco.
- **`site/server/src/routes/clipes.js`** — `createClipesRouter({ db, requireAuth })`,
  montado em `/api/clipes`.
  - `GET /api/clipes?periodo=semana|mes|sempre` (default `sempre`) devolve:
    ```json
    {
      "clipes": [{
        "id", "matchId", "highlightId", "steamId", "nick", "avatarUrl",
        "clipUrl", "clipSnapshotUrl", "kind", "roundNumber", "map", "playedAt",
        "pontuacao": { "base": 100, "kind": "ace", "bonusHeadshot": 20, "total": 120 }
      }],
      "leaderboard": [{ "steamId", "nick", "avatarUrl", "clipes": 4, "melhorPontuacao": 120 }]
    }
    ```
  - Query: `allstar_clips` (`status='Processed'`) join `highlights` join
    `matches` (filtro `partidaVisivelExpr` pelo viewer + filtro de período
    sobre `matches.played_at`) join `match_players`/`players` pro nick/avatar.
    Pra cada clipe, subquery em `kill_positions` (mesmo `match_id`,
    `round_number`, `killer`) pra achar `todosHeadshot` (`count(*) filter
    (where not headshot) = 0` e `count(*) > 0`).
  - `pontuacao` calculada em JS (`calcularPontuacao`) depois da query, não em
    SQL — mantém a fórmula num lugar só, testável.
  - `clipes` ordenado por `pontuacao.total desc`. `leaderboard` agrega os
    mesmos clipes por `steamId` (contagem + max pontuação), ordenado por
    `melhorPontuacao desc`.
  - Período: `semana` = `matches.played_at >= now() - interval '7 days'`,
    `mes` = `>= now() - interval '30 days'`, `sempre` = sem filtro.

### Client: nova página

- **`site/client/src/pages/Clipes.jsx`** — nova rota `/clipes`, item de menu
  entre "Enviar Demo" (03) e "Amigos" (04). Insere como novo `04`, empurrando
  Amigos→05, Comparar→06, Granadas→07, Táticas→08, Minha conta→09, Curso de
  mira→10; os itens de super-admin (`Admin`/`Partidas pro`, numerados à parte
  no JSX — ver `site/client/src/components/Shell.jsx:231,242`) sobem de
  10/11 pra **11/12**.
  - Abas de período (Semana/Mês/Sempre) — mesmo padrão visual de outras abas
    do site.
  - Leaderboard (tabela pequena, reusa `DataTable`): posição, avatar+nick,
    clipes, melhor pontuação.
  - Grade de cards (reusa `Card`): thumbnail (`clipSnapshotUrl`, fallback pra
    ícone genérico se null), nick+avatar, mapa+round, badge do tipo de jogada,
    pontuação com breakdown em tooltip/expandido (`"ACE (100) + Headshots
    (+20) = 120"`), botão "assistir" que abre o mesmo player embutido
    (`iframe` com `src={clipUrl}&UID=...&location=matchResults}`) já usado na
    aba Clipes da Partida — sem duplicar a lógica do iframe, extrair um
    componente `PlayerClipeAllstar` compartilhado entre `Partida.jsx` e
    `Clipes.jsx` se a duplicação incomodar (decisão de implementação, não
    trava o design).

## O que NÃO muda

A aba Clipes de dentro de uma Partida continua existindo do jeito que está
(vídeo por highlight daquela partida específica) — essa spec só adiciona uma
visão agregada nova, não substitui a existente. Layout do player embutido e o
bug de travamento/áudio ficam pra specs separadas (já combinado no
brainstorming).

## Testes

- `clipesScore.js`: tabela de pontos por `kind` (todos os 8 valores + default),
  bônus de headshot aplicado/não aplicado, soma correta.
- Rota `/api/clipes`: filtro de período (semana/mês/sempre gera o `where`
  certo), visibilidade por amizade (clipe de partida não-visível não aparece),
  `leaderboard` agregando corretamente (contagem + melhor pontuação por
  jogador), ordenação por pontuação.
- Client: `Clipes.jsx` renderiza grade + leaderboard a partir de um mock da
  API, troca de aba de período dispara novo fetch.

## Riscos / notas

- Pontuação é heurística nossa, não a real do Allstar — vale deixar isso
  claro na UI (ex.: um texto pequeno "pontuação calculada pelo Resenha,
  baseada no tipo de jogada").
- Se um dia a Allstar passar a mandar algum campo de qualidade/score no
  webhook, essa fórmula pode incorporar isso depois — fora de escopo agora.
