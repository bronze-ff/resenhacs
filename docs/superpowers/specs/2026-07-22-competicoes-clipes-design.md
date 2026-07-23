# Competições de Clipes — Design

**Data:** 2026-07-22
**Status:** aprovado, aguardando plano de implementação

## Problema

O Resenha já gera clipes reais via Allstar (ADR-0004) e tem uma pontuação
própria (`clipesScore.js`, spec 2026-07-21), mas essa pontuação tem só 16
valores possíveis (8 tipos de jogada × bônus binário de headshot) — com mais
de uma dezena de participantes, é fácil demais empatar, o que inviabiliza um
ranking competitivo de verdade. Além disso não existe nenhum jeito de rodar
uma "competição" com prazo, prêmio e regras de envio — só o leaderboard
agregado sempre-ativo da aba Clipes.

Referência direta: sistema de "Competitions" da Allstar.gg (prints
analisados no brainstorming) — pontuação transparente por componente,
limites de envio diário/total, mínimo pra qualificar no ranking.

## Objetivo

1. Reformular a fórmula de pontuação de clipe pra ser granular o bastante
   pra evitar empate na prática (mantendo transparência: o usuário vê
   exatamente de onde vem cada ponto).
2. Nova aba **Competições**: o dono do sistema cria competições com prazo,
   prêmio e limites; jogadores enviam clipes já gerados (via Allstar) pra
   competir; ao final, quem tiver a maior soma de pontos entre os
   qualificados vence e recebe um campo pra informar o tradelink do prêmio.

## Decisões travadas (do brainstorming)

- **A pontuação nova substitui a atual em TODO lugar** — inclusive a aba
  Clipes agregada existente (spec 2026-07-21). Não fica um sistema de pontos
  duplicado no site.
- **Só `allstar_clips` (status `Processed`) participa** — links manuais da
  tabela `clips` (Medal/YouTube colados à mão) não têm dados de round pra
  pontuar nem podem ser enviados a uma competição.
- **Competições são um sistema reusável, criado pelo admin** (não uma
  competição hardcoded) — o dono cria quantas quiser ao longo do tempo,
  cada uma com seu próprio prazo/prêmio/limites.
- **Elegibilidade de envio**: o clipe é seu (só envia clipe próprio — o
  privilégio do dono de *gerar* clipe de qualquer jogador não muda, mas
  *enviar pra competição* é sempre em nome de quem é dono do clipe), está
  `Processed`, e a **partida foi jogada dentro do período da competição**
  (não o clipe ter sido *gerado* dentro do período — o que importa é quando
  a partida rolou).
- **Limites configuráveis por competição**: `limite_diario` (padrão 2),
  `limite_total` (padrão 10), `minimo_para_rankear` (padrão 3). Quem não
  bate o mínimo **continua visível** (numa lista separada abaixo do
  leaderboard, tipo "ainda não qualificado — envie mais N clipe(s)"), só não
  entra na ordenação por posição/1º-2º-3º — não some da tela.
- **Total do jogador = soma** de todos os clipes que ele enviou àquela
  competição (não média) — recompensa participação constante, mais simples
  de explicar num grupo pequeno de amigos.
- **Vencedor é automático, não sorteio**: quando a data final passa, quem
  tiver a maior soma entre os qualificados vence, sem confirmação manual do
  admin. Empate exato: desempate comparando o `enviado_em` da ÚLTIMA
  submissão de cada um dos empatados (a que fechou o total final de cada
  jogador) — quem chegou naquele total mais cedo (timestamp menor) vence.
- **Dois pontos de entrada pro envio**: a aba Competições (botão "Enviar
  clipe", estilo Allstar) e um atalho dentro de Partida → aba Clipes (link
  "Enviar pra competição →" quando o clipe da partida atual é elegível).
  Os dois levam à mesma tela de seleção.
- **Tradelink**: só visível/editável pelo próprio vencedor (uma vez) e
  pelo super-admin (só leitura) — nunca aparece pra outros jogadores.
- **O leaderboard sai da aba Clipes agregada existente** (`/clipes`, print
  revisado no brainstorming) — essa página mantém só a grade de clipes com
  os filtros de período (Semana/Mês/Sempre), sem tabela de ranking.
  Leaderboard passa a existir **exclusivamente dentro de cada competição**,
  escopado por `competicao_id` — não existe mais um ranking-geral-de-sempre;
  cada competição tem o seu próprio, isolado, calculado só com as submissões
  daquela competição específica.

## Fórmula de pontuação (substitui `clipesScore.js` inteiro)

Calculada **uma vez**, quando o webhook da Allstar confirma `status:
'Processed'` (não recalculada depois — histórico fica estável mesmo se a
fórmula mudar de novo no futuro). Usa dados que já existem: `kill_positions`
(kills daquele round específico, por `match_id` + `round_number` +
`killer`) e `highlights.kind` (se houver um highlight casando `match_id` +
`steam_id64` + `round_number`, pra saber se é um clutch).

| Componente | Cálculo | Notas |
|---|---|---|
| Kills no round | Curva não-linear: 1=10, 2=25, 3=50, 4=80, 5=120 | Vem de `count(*)` em `kill_positions` filtrado por killer+round |
| Headshots | `+8` por kill daquele round que foi `headshot = true` | Escala com a contagem, não é mais um bônus binário |
| Clutch | Se existir `highlights.kind` = `clutch_1vX` pro mesmo match+jogador+round: 1v1=+10, 1v2=+20, 1v3=+35, 1v4=+55, 1v5=+80 | Ausência de highlight = +0, não é erro |
| Variedade de armas | `+5` por arma distinta usada nos kills daquele round | `count(distinct weapon)` |

`total = kills + headshots + clutch + armas`. A resposta da API sempre inclui
o breakdown completo — nunca só o número final (requisito de transparência
do dono).

**Fora de escopo agora**: no-scope, wallbang, defuse (a Allstar pontua isso
como "jogada especial" também, mas o parser do Coletor não extrai esses
flags de kill hoje — exigiria mudança no parser de demo, não neste projeto).

**Migração de dados**: clipes já existentes em `allstar_clips` (gerados
antes desta mudança) recebem a pontuação nova via backfill único (script
rodado pelo controller direto em produção, mesmo padrão já usado nesta
sessão pra outras migrações) — não ficam com a pontuação antiga misturada
no mesmo ranking.

## Modelo de dados (migração nova, `0047_competicoes.sql`)

```sql
alter table allstar_clips add column pontuacao_total int;
alter table allstar_clips add column pontuacao_detalhe jsonb;
-- pontuacao_detalhe: {"kills": 4, "pontosKills": 80, "headshots": 3,
--   "pontosHeadshots": 24, "clutch": "1v2", "pontosClutch": 20,
--   "armas": 2, "pontosArmas": 10, "total": 134}

create table competicoes (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null,
  descricao             text not null default '',
  premio_descricao      text not null default '',
  data_inicio           timestamptz not null,
  data_fim              timestamptz not null,
  limite_diario         int not null default 2,
  limite_total          int not null default 10,
  minimo_para_rankear   int not null default 3,
  vencedor_steam_id64   text references players(steam_id64),
  tradelink_vencedor    text,
  criado_por            text not null references players(steam_id64),
  criado_em             timestamptz not null default now(),
  constraint periodo_valido check (data_fim > data_inicio)
);

create table competicao_submissoes (
  id              uuid primary key default gen_random_uuid(),
  competicao_id   uuid not null references competicoes(id) on delete cascade,
  allstar_clip_id uuid not null references allstar_clips(id) on delete cascade,
  steam_id64      text not null references players(steam_id64),
  enviado_em      timestamptz not null default now(),
  unique (competicao_id, allstar_clip_id)
);
create index idx_competicao_submissoes_competicao on competicao_submissoes (competicao_id);
create index idx_competicao_submissoes_jogador on competicao_submissoes (competicao_id, steam_id64);
```

## Arquitetura

### Server

- **`site/server/src/clipesScore.js`** (reescrito): `calcularPontuacao({
  kills, headshots, clutchKind, armasDistintas })` — pura, testável sem
  banco, troca a tabela por `kind` pela fórmula por componente acima.
- **`site/server/src/routes/allstar.js`** (webhook): quando o payload traz
  `status: 'Processed'`, antes de responder, busca `kill_positions` +
  `highlights` pro match/jogador/round do clipe, chama
  `calcularPontuacao`, grava `pontuacao_total`/`pontuacao_detalhe` no mesmo
  UPDATE que já existe.
- **`site/server/src/routes/clipes.js`** (existente, spec 2026-07-21):
  troca a leitura de `pontuacao` calculada em JS pela leitura direta das
  colunas novas de `allstar_clips` — mais simples, já vem pronta. **Remove
  o `leaderboard` da resposta** — essa rota devolve só `clipes` daqui pra
  frente; ranking vira exclusividade de `/api/competicoes/:id`.
- **`site/server/src/routes/competicoes.js`** (novo),
  `createCompeticoesRouter({ db, requireAuth })`, montado em
  `/api/competicoes`:
  - `GET /` — competição ativa (`data_inicio <= now <= data_fim`) +
    histórico de encerradas. **Cada competição carrega o próprio leaderboard
    isolado** (soma por jogador calculada só com `competicao_submissoes`
    daquele `competicao_id`, flag `qualificado`) e sua própria grade de
    clipes enviados recentemente — nunca um ranking agregado entre
    competições diferentes.
  - `GET /:id/elegiveis` — lista os `allstar_clips` do próprio
    `req.player.steamId` com `status='Processed'` e partida dentro do
    período da competição `:id`, marcando quais já foram enviados.
  - `POST /:id/submissoes` — body `{ allstarClipId }`. Valida: clipe é do
    usuário logado, `Processed`, partida no período, limite diário e total
    não estourados; insere em `competicao_submissoes`.
  - `POST /admin` / `PUT /admin/:id` (`requireSuperAdmin`) — criar/editar
    competição.
  - `PUT /:id/tradelink` — só se `req.player.steamId ===
    competicao.vencedor_steam_id64` e a competição já encerrou.
  - Cálculo do vencedor: função pura chamada no `GET /` sempre que
    `now() > data_fim` e `vencedor_steam_id64 is null` — persiste o
    resultado na primeira vez, não recalcula depois.

### Client

- **`site/client/src/pages/Clipes.jsx`** (existente, spec 2026-07-21):
  **remove a seção de Leaderboard inteira** — fica só o texto de
  transparência da pontuação + os filtros de período + a grade de clipes.
  Ranking deixa de existir nessa página.
- **`site/client/src/pages/Competicoes.jsx`** (novo) — item de menu novo
  (Shell.jsx, `ITENS_BASE`, numeração já é derivada do índice do array
  desde a correção da auditoria de segurança, então basta inserir na
  posição certa). Cabeçalho da competição ativa (nome, prêmio, contagem
  regressiva, regras), **leaderboard próprio dessa competição** (isolado —
  ao navegar pro histórico de uma competição encerrada, mostra o
  leaderboard congelado dela, nunca misturado com o de outra), grade de
  "enviados recentemente", histórico de competições encerradas com
  vencedor.
- **Modal/tela de seleção** (componente compartilhado, ex.
  `SeletorClipesCompeticao.jsx`): grade dos clipes elegíveis
  (`GET /:id/elegiveis`), score + botão enviar por card, painel de regras
  com limites usados/restantes. Acionado tanto pelo botão "Enviar clipe" em
  `Competicoes.jsx` quanto pelo atalho em `Partida.jsx` (aba Clipes).
- **`Partida.jsx`** (aba Clipes): link "Enviar pra competição →" ao lado do
  clipe já gerado, visível só se existir competição ativa cujo período
  cobre `matches.playedAt`.
- **Painel de transparência**: em qualquer card de clipe (Competições ou a
  aba agregada existente), o score vem acompanhado do breakdown
  (`pontuacao_detalhe`) — exibido expandido ou em tooltip, mesmo padrão já
  usado na aba Clipes existente.
- **Admin**: nova seção em `Admin.jsx` (ou página própria, mesmo padrão de
  `FormGranada.jsx`/`FormTatica.jsx`) pra criar/editar competições.

## Segurança

Aplicando a mesma disciplina da auditoria de 2026-07-22 (14 áreas +
checklist do artigo "15 perguntas de segurança pra quem pratica vibe
coding") a esta feature nova:

- **#5 Autorização/IDOR**: `POST /:id/submissoes` DEVE validar
  `allstar_clips.steam_id64 = req.player.steamId` antes de aceitar — sem
  isso, um jogador poderia enviar o clipe de outro pra competição em nome
  próprio. `GET /:id/elegiveis` só devolve clipes do próprio
  `req.player.steamId`, nunca de terceiros.
- **#6 Áreas administrativas**: criar/editar competição exige
  `requireSuperAdmin` no servidor (reconsulta `is_super_admin` no banco,
  mesmo padrão já usado em granadas/táticas) — não só esconder o botão no
  client.
- **#7 "Pagamentos"**: o prêmio (tradelink) não é pagamento real, mas seguem
  o mesmo princípio — o vencedor e o total de pontos são **sempre
  calculados no servidor a partir do banco**, nunca aceitos como valor
  vindo do client. `PUT /:id/tradelink` só grava se
  `req.player.steamId === vencedor_steam_id64` E a competição já
  encerrou (checado no servidor, não no client).
- **#9 Validação de entrada**: `competicaoId`/`allstarClipId` validados
  como UUID antes de qualquer query; formulário de criar competição no
  admin valida `data_fim > data_inicio` e limites como inteiros positivos
  tanto no client quanto no servidor (constraint `periodo_valido` já
  garante no banco como última linha de defesa).
- **#11 Limites contra abuso**: `POST /:id/submissoes` recebe
  `limiteEstrito` (mesmo rate limiter da auditoria) como defesa em
  profundidade, além da regra de negócio (limite diário/total) que já
  bloqueia bem antes desse teto técnico.
- **#12 Exposição em logs**: `tradelink_vencedor` nunca aparece em log
  nenhum (nem sucesso nem erro) — mesmo tratamento que outros dados
  sensíveis do sistema.
- Campo `tradelink_vencedor` só é incluído na resposta de `GET /` quando
  `req.player.steamId === vencedor_steam_id64` ou `req.player.isSuperAdmin`
  — em qualquer outro caso o campo é omitido da resposta (não só
  escondido no client).

## O que NÃO muda

- Geração de clipe (`POST /api/matches/:id/jogador/:steamId/clipe`) e sua
  regra de permissão (qualquer um gera o próprio, só o dono gera de
  outros) — inalterada. Competições só consomem clipes já gerados.
- Links manuais (`clips` table, `FormClipe`) continuam existindo do jeito
  que estão, fora do sistema de competições.

## Testes

- `clipesScore.js`: cada componente isolado (kills 1-5, headshots 0-5,
  cada clutch 1v1-1v5 + ausência, armas 1-5+), soma correta, breakdown
  completo no retorno.
- Webhook (`allstar.js`): grava `pontuacao_total`/`pontuacao_detalhe`
  corretamente ao receber `status: 'Processed'` com round/kills reais;
  round sem highlight de clutch não quebra (clutch = null, +0).
- `competicoes.js`: IDOR (não envia clipe de outro), limite diário/total
  respeitados (inclusive exatamente no limite, não só acima), partida fora
  do período rejeitada, competição inexistente/encerrada rejeitada,
  cálculo de vencedor (qualificados vs não-qualificados, empate,
  ninguém qualificado), tradelink só visível/gravável pelo vencedor,
  admin-only nas rotas de criar/editar. **Leaderboard de uma competição
  nunca inclui submissão de outra** — teste com 2 competições distintas e
  jogadores em comum, confirmando que a soma de cada uma é calculada só
  com as próprias submissões.
- `clipes.js`: resposta não inclui mais campo `leaderboard` nenhum.
- Client: `Clipes.jsx` não renderiza leaderboard (só grade + filtro de
  período); seletor de clipes mostra só elegíveis e marca já-enviados;
  `Competicoes.jsx` renderiza o leaderboard e histórico da competição
  aberta a partir de mock da API (trocar de competição no histórico troca
  o leaderboard exibido); atalho em `Partida.jsx` só aparece com
  competição ativa cobrindo a partida.

## Riscos / notas

- Migração de pontuação: clipes antigos recebem backfill uma vez; se o
  backfill falhar parcialmente, o `/clipes` agregado mostraria uma mistura
  de pontuação nova e null — o backfill deve ser tudo-ou-nada por clipe
  (uma transação por linha, não em lote).
- No-scope/wallbang/defuse ficam de fora da pontuação por ora — se algum
  dia o parser do Coletor passar a extrair esses flags, a fórmula pode
  incorporar sem quebrar histórico (campos novos em `pontuacao_detalhe`,
  não recalcula o passado).
- Ver [[resenha-freemium-plano]] (memória) — quando o freemium existir,
  "criar competição" ou "enviar clipe" podem virar gate de plano pago;
  fora de escopo nesta spec.
