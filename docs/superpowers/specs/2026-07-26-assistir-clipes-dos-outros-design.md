# Assistir os Clipes dos outros na Competição

## Problema

Na aba Competições, a seção "Enviados recentemente" mostra apenas o nick de quem
enviou e o total de pontos (`site/client/src/pages/Competicoes.jsx:157-166`). O
leaderboard mostra nick e soma. Não há como assistir o Clipe de outro Jogador —
então não dá pra saber se a jogada que rendeu 85 pontos ao adversário foi boa,
nem entender por que alguém está na frente.

O dado já existe e já trafega: `buscarClipesRecentes`
(`site/server/src/routes/competicoes.js:88-98`) devolve `clipUrl`,
`clipSnapshotUrl`, `nick` e `avatarUrl` de cada envio. O cliente ignora os quatro.

## Objetivo

Deixar qualquer competidor assistir os Clipes enviados à Competição — no feed
dos envios recentes e expandindo um Jogador no leaderboard —, com contexto
suficiente pra julgar a jogada sem abrir o vídeo.

## Decisões de escopo

- **Feed e leaderboard**, não um só.
- **Um card compartilhado** entre as três telas (envio, feed, leaderboard), com
  autor e ação como variações por prop.
- **Sem link "ver partida".** A página da Partida é protegida por
  `partidaVisivelExpr` (`site/server/src/friendships.js:17`): só abre pra quem
  jogou nela ou é amigo de quem jogou. Um link levaria a "Partida não
  encontrada" para a maioria dos competidores. Tornar a Partida visível por ter
  Clipe em Competição seria uma segunda exceção deliberada ao isolamento por
  amizade, expondo placar e estatísticas dos outros nove Participantes, que não
  entraram em competição nenhuma — descartado. O card mostra `mapa · data ·
  round` como texto.
- **`origemNaoVerificada` continua só no admin.** O marcador de Partida com data
  auto-declarada existe pra conferência antes de liberar o prêmio; exibi-lo aos
  competidores geraria atrito num caso que quase sempre é legítimo.
- **Um player tocando por vez** em toda a tela.

## Consequência registrada (não é escolha desta spec)

Qualquer pessoa logada já vê a página de Competições com as URLs dos Clipes no
payload, e o login da plataforma é aberto. Esta feature não cria classe nova de
exposição — torna visível na tela o que já ia no JSON. Restringir competições a
um círculo, se um dia for desejado, é mudança no endpoint de Competições
inteiro, não neste card.

## Arquitetura

### 1. Cliente — `CardClipeCompeticao` compartilhado

O corpo do card construído em `SeletorClipesCompeticao.jsx` (thumbnail que vira
player, jogada em destaque, `mapa · data · round`, breakdown da pontuação) sai
pra `site/client/src/components/CardClipeCompeticao.jsx`:

```jsx
<CardClipeCompeticao
  clipe={c}                 // { id, map, playedAt, roundNumber, kind,
                            //   clipUrl, clipSnapshotUrl, pontuacao, nick?, avatarUrl? }
  autor                     // bool — mostra avatar + nick de quem enviou
  aberto={clipeAberto === c.id}
  onAbrir={setClipeAberto}  // toggle; null fecha
  viewerSteamId={jogador?.steamId}
  acao={<button …>enviar</button>}   // opcional; só a tela de envio passa
/>
```

**Nome da chave**: o card exige `clipe.id`. O feed e o endpoint do Jogador já
usam `id`; o `/elegiveis` usa `allstarClipId` por contrato anterior. Em vez de
mudar o endpoint de novo (ele acabou de mudar) ou de o card aceitar duas
chaves, o `SeletorClipesCompeticao` normaliza **uma vez, no `carregar()`**:
`(body.clipes ?? []).map((c) => ({ ...c, id: c.allstarClipId }))`. Uma linha na
fronteira, e o card tem uma regra só.

Três consumidores: `SeletorClipesCompeticao` (com `acao`, sem `autor`), o feed e
a expansão do leaderboard (com `autor`, sem `acao`). Sem a extração, o card
existiria em três variantes parecidas-mas-não-iguais.

O componente usa `PlayerClipe`/`SnapshotPlaceholder`/`nomeDoKind` de
`components/ui/PlayerClipe.jsx`, e `nomeMapa`/`dataHora` de `lib/format.js`.

### 2. Servidor — contexto no feed

`buscarClipesRecentes` (`competicoes.js:74-99`) ganha as colunas que faltam:
`m.map`, `m.played_at`, `ac.round_number` e o `kind`, este último por
`left join lateral` com `limit 1` — mesmo motivo do `/elegiveis`: `highlights`
não tem unique em `(match_id, steam_id64, round_number)`, então um Jogador com
`ace` **e** `clutch_1v4` no mesmo round duplicaria a linha do Clipe.

Cada item do feed passa a ser:

```json
{
  "id": "…", "clipUrl": "…", "clipSnapshotUrl": "…",
  "steamId": "…", "nick": "…", "avatarUrl": "…",
  "map": "de_inferno", "playedAt": "2026-07-25T00:37:00Z",
  "roundNumber": 18, "kind": "clutch_1v3",
  "pontuacao": { … }
}
```

### 3. Servidor — clipes de um Jogador

Endpoint novo, `GET /api/competicoes/:id/jogador/:steamId/clipes`, com
`requireAuth` (mesma proteção do `GET /api/competicoes`, que já expõe o feed).
Valida `:id` como uuid e devolve 404 pra competição inexistente. Resposta:
`{ clipes: [ … ] }`, cada item no **mesmo shape do feed**.

Cuidado obrigatório: `buscarSubmissoesDoJogador` (`competicoes.js:107-127`) já
faz essa busca, mas devolve `origemNaoVerificada` e `plataformaManual` — campos
de conferência de admin, que por decisão desta spec não vão pros competidores. O
endpoint público monta o próprio mapeamento **campo a campo**, sem espalhar o
objeto, pra que um campo sensível acrescentado amanhã à função de admin não vaze
sozinho. A query pode ser compartilhada; o mapeamento, não.

### 4. Cliente — feed e leaderboard

**Feed "Enviados recentemente"** (`Competicoes.jsx:155-171`): os cards passam a
usar `CardClipeCompeticao` com `autor`. Continua sendo os últimos 20 envios da
Competição inteira.

**Leaderboard** (`Competicoes.jsx:150-155`): cada linha vira um botão que expande
os Clipes daquele Jogador. Busca **na primeira expansão** e guarda o resultado —
carregar os Clipes de todos só pra mostrar o ranking seria desperdício. Um
Jogador expandido por vez.

Só há linha pra quem está qualificado; quem ainda não atingiu o mínimo aparece
numa linha de texto ("Ainda não qualificado (mínimo N): nick1, nick2",
`Competicoes.jsx:23-27`) e portanto não expande. Os Clipes dessas pessoas
continuam visíveis no feed enquanto forem recentes. Tornar o não-qualificado
expansível também é possível depois; não entra agora.

**Estado do player no `CardCompeticao`**, acima das duas seções: abrir um Clipe
no leaderboard fecha o que tocava no feed. Sem isso, dois vídeos com áudio ao
mesmo tempo.

## Testes

**Servidor** (`site/server/test/competicoes.test.js`):
- o feed devolve `map`, `playedAt`, `roundNumber` e `kind`;
- Clipe sem Highlight correspondente continua no feed, com `kind` nulo;
- `GET /:id/jogador/:steamId/clipes` devolve os Clipes daquele Jogador;
- e **não** devolve `origemNaoVerificada` nem `plataformaManual`;
- 404 pra competição inexistente; 401 sem login.

**Cliente**:
- `CardClipeCompeticao` mostra avatar e nick quando recebe `autor`, e omite
  quando não recebe;
- renderiza a `acao` quando recebe, e nada quando não;
- abrir um player fecha o que estava aberto na outra seção;
- a linha do leaderboard expande, busca uma vez e não refaz a busca ao recolher
  e expandir de novo.

## Fora de escopo

- Link para a página da Partida a partir do Clipe.
- Exibir `origemNaoVerificada` fora do admin.
- Paginar o feed além dos 20 atuais.
- Qualquer mudança na fórmula de pontuação ou nas regras de limite.
- Restringir a visibilidade da Competição a um círculo de Jogadores.
