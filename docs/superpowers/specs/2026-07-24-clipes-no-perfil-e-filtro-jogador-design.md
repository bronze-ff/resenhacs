# Clipes no perfil do jogador + filtro por jogador na aba Clipes — Design

**Data:** 2026-07-24

**Origem:** pedido do Filippe — os clipes de um jogador devem aparecer também dentro do
perfil dele (ex.: entrar no perfil do bronze e ver os clipes dele), e a aba Clipes
precisa de um filtro por jogador pra não ter que caçar os clipes de alguém no meio dos
dos amigos.

## Objetivo

Duas peças que se completam:

1. **Seção "Clipes" no perfil** (`/jogador/:steamId`) — prévia dos 6 melhores clipes do
   jogador (por pontuação), com link "Ver todos →" que leva pra aba Clipes já filtrada
   naquele jogador.
2. **Filtro por jogador na aba Clipes** (`/clipes`) — dropdown combinável com o filtro
   de período existente, com deep link via query string (`/clipes?jogador=<steamId>`).

## Escopo

**Dentro:** campo `clipes` no payload do perfil, componente de card de clipe extraído
pra reuso, seção nova no perfil, dropdown de jogador + leitura/escrita de
`?jogador=` na aba Clipes.

**Fora:** paginação/carregar-mais (nem a aba Clipes tem hoje), mudança no endpoint
`GET /api/clipes` (o filtro por jogador é client-side sobre a lista já carregada),
qualquer mudança na pontuação ou geração de clipes.

## Backend — `clipes` no payload do perfil

`site/server/src/routes/profile.js`, rota `GET /:steamId` (linha 392): o padrão do
arquivo é "backend manda tudo num payload único" (comentário em `JogadorPerfil.jsx:37-38`),
então clipes entram como mais uma query no `Promise.all` existente (linhas 443-503) — não
um endpoint novo.

Query nova (mesmo estilo das vizinhas, reaproveitando `periodoWhere`/`visivelWhere` já
declarados no arquivo):

```javascript
// Prévia dos melhores clipes do jogador pro perfil — mesmo shape da aba Clipes
// (clipes.js), MESMA regra de visibilidade por amizade (clipe de partida que o viewer
// não pode ver não vaza) e mesmo cuidado com kind: subquery em highlights, nunca join
// inner (excluiria clipes do fluxo por-jogador, migração 0042).
db.query(
  `select ac.id, ac.clip_url, ac.clip_snapshot_url, ac.pontuacao_total, ac.pontuacao_detalhe,
          ac.round_number, ac.match_id,
          (select h.kind from highlights h
           where h.match_id = ac.match_id and h.steam_id64 = ac.steam_id64 and h.round_number = ac.round_number
           limit 1) as kind,
          m.map, m.played_at
   from allstar_clips ac
   join matches m on m.id = ac.match_id
   where ac.steam_id64 = $1 and ac.status = 'Processed'${clipesPeriodo}${clipesVisivel}
   order by ac.pontuacao_total desc nulls last
   limit 6`,
  clipesParams,
),
```

Com `clipesParams`/`clipesPeriodo`/`clipesVisivel` declarados junto dos congêneres
(linhas 431-441). O filtro de período do perfil (`from`/`to`) se aplica aos clipes
igual às outras seções — filtrou o perfil por data, a prévia de clipes acompanha.

Resposta ganha:

```javascript
clipes: clipes.rows.map((c) => ({
  id: c.id, matchId: c.match_id, steamId,
  nick: jogador.nick, avatarUrl: jogador.avatar_url,
  clipUrl: c.clip_url, clipSnapshotUrl: c.clip_snapshot_url,
  kind: c.kind, roundNumber: c.round_number, map: c.map, playedAt: c.played_at,
  pontuacao: c.pontuacao_detalhe ?? { total: c.pontuacao_total ?? 0 },
})),
```

Mesmo shape de item da aba Clipes (`clipes.js:47-62`) — o card reutilizado funciona nos
dois sem adaptação.

## Frontend — card de clipe extraído pra componente reutilizável

Hoje `CardClipe` + helpers (`nomeDoKind`, `SnapshotPlaceholder`, `PlayerClipe`,
`tituloPontuacao`, `NOME_KIND`) são internos de `Clipes.jsx` (linhas 6-102). Extrair
tudo pra `site/client/src/components/CardClipe.jsx` com a mesma interface
(`{ clipe, aberto, onAbrir, viewerSteamId }`), export default `CardClipe`.
`Clipes.jsx` passa a importar. Refactor puro — zero mudança de comportamento, os testes
existentes de `Clipes.test.jsx` continuam passando sem alteração.

## Frontend — seção "Clipes" no perfil (`JogadorPerfil.jsx`)

Nova seção logo depois da `SecaoHighlights` (linha 403) — mesmo domínio (momentos da
partida), mesmo padrão condicional:

```jsx
{clipes.length > 0 && <SecaoClipes clipes={clipes} steamId={jogador.steamId} viewerSteamId={viewerSteamId} />}
```

`SecaoClipes` (componente local do arquivo, como `SecaoHighlights`):
- `SectionHeader` com título "Clipes" e ação = link "Ver todos →" pra
  `/clipes?jogador=<steamId>` (via `Link` do react-router, estilo de botão secundário
  do design system).
- Grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (mesmo da aba Clipes) renderizando
  `CardClipe` pra cada clipe, com estado local de clipe aberto (mesmo padrão
  `clipeAberto`/`setClipeAberto` da aba).
- `viewerSteamId` vem do `useAuth()` (o perfil pode ser de outro jogador — o UID do
  iframe do player é sempre o do viewer logado, igual na aba Clipes).

`clipes` entra no destructuring do payload (linha 194). Como perfis antigos em cache não
existem (fetch sempre fresco), não precisa de fallback além de `data.clipes ?? []` por
robustez.

## Frontend — filtro por jogador na aba Clipes (`Clipes.jsx`)

- Lê `?jogador=<steamId>` da URL na montagem (`useSearchParams` do react-router) como
  valor inicial do filtro; trocar o filtro atualiza a URL (`setSearchParams`, sem
  recarregar — filtro é client-side).
- Dropdown "Jogador" usando o `Select` customizado do design system
  (`components/ui`), ao lado dos botões de período no `acao` do `SectionHeader`:
  - Opção "Todos" (default, valor vazio).
  - Demais opções derivadas da lista carregada: pares `steamId`/`nick` distintos dos
    clipes visíveis, ordenados por nick — sem fetch extra, a aba já carrega tudo.
- Filtro aplicado client-side: `dados.clipes.filter((c) => !jogadorFiltro || c.steamId === jogadorFiltro)`.
- Estado vazio: se o filtro não casa nenhum clipe (ex.: deep link pra jogador sem clipe
  no período), mensagem "Nenhum clipe desse jogador nesse período." e o dropdown mostra
  o filtro ativo mesmo sem opção correspondente na lista (pra dar como limpar).
- Trocar o período mantém o filtro de jogador (estados independentes).

## Erros e casos extremos

- **Jogador do perfil sem nenhum clipe:** seção não renderiza (condicional já cobre).
- **Deep link com steamId inválido/sem clipes:** aba Clipes abre com o filtro aplicado e
  estado vazio explicando; "Todos" a um clique.
- **Clipe de partida não visível ao viewer:** já filtrado no servidor
  (`visivelWhere`) — nunca chega ao client.
- **Perfil filtrado por período sem clipes naquele range:** seção some (mesma regra do
  condicional).

## Testes

- **Servidor (`site/server/test/profile.test.js`):** `GET /api/profile/:steamId` inclui
  `clipes` com o shape esperado (kind via subquery, pontuação com fallback), e a query
  de clipes usa a regra de visibilidade (`from friendships f` presente no SQL, sem
  `group_id`).
- **Client:**
  - `Clipes.test.jsx` (existentes passam sem mudança — refactor do card não muda
    comportamento; novos): dropdown filtra a lista por jogador; deep link
    `?jogador=<id>` chega filtrado; trocar filtro atualiza a URL.
  - Teste novo da seção no perfil (arquivo novo `JogadorPerfil.test.jsx`, escopo mínimo
    na seção de clipes): seção aparece com clipes e o link "Ver todos" aponta pra
    `/clipes?jogador=<steamId>`; seção some com `clipes: []`.
