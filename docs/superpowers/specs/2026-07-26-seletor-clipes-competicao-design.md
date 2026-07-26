# Seletor de clipes da Competição: conserto do modal e cards com contexto

## Problema

### 1. O modal aparece recortado

`SeletorClipesCompeticao` é um overlay `fixed inset-0 z-50`
(`site/client/src/components/SeletorClipesCompeticao.jsx:46`). Na aba
Competições ele é montado **dentro de um `<Card>`**
(`site/client/src/pages/Competicoes.jsx:116`), e `Card` aplica a classe
`panel-cut`, que é um `clip-path` (`site/client/src/index.css:84`).

`clip-path` recorta visualmente **todos** os descendentes de um elemento,
inclusive os posicionados com `fixed`. O overlay continua posicionado pela
viewport (o `inset-0` está correto), mas só a parte que cai dentro da caixa do
card é desenhada: o modal aparece truncado e o fundo escuro não cobre a tela.

O mesmo componente é montado em `site/client/src/pages/Partida.jsx:1571`, fora
de qualquer `panel-cut`, e por isso funciona lá — o que explica por que o
defeito passou despercebido.

### 2. O card não ajuda a escolher

Cada clipe hoje mostra `mapa · round N` e um número de pontuação
(`SeletorClipesCompeticao.jsx:64-65`). A decisão que o Jogador toma nessa tela é
"quais dos meus clipes valem mais", e nada na tela responde por que um vale 55 e
outro 30, nem qual jogada foi, nem de que dia é a Partida — e não dá pra ver o
Clipe antes de enviar.

O dado já existe: o endpoint devolve `pontuacao_detalhe` completo
(`site/server/src/routes/competicoes.js:298`), com kills, headshots, armas e
clutch, e o componente usa só o `.total`.

### 3. O limite diário zera no horário errado

`count(*) filter (where enviado_em::date = now()::date)`
(`competicoes.js:338-339`) usa o fuso do servidor Postgres (UTC). Na prática o
limite diário zera às 21h de Brasília, não à meia-noite — contra a convenção do
projeto de que datas sempre são em Brasília.

Hoje ninguém percebe porque o número nunca é exibido. Este spec passa a exibi-lo
no cabeçalho do modal, o que tornaria a divergência visível como bug.

## Objetivo

Consertar o recorte do modal, dar ao Jogador o contexto necessário pra escolher
os Clipes (incluindo assistir antes de enviar), e mostrar quanto ele já enviou
contra os limites da Competição.

## Decisões de escopo

- O conserto do modal é por **portal**, não movendo o ponto de montagem — imuniza
  qualquer montagem futura em vez de depender de alguém lembrar da regra.
- **Preview por thumbnail que vira player** ao clicar, um por vez. Carregar N
  iframes da Allstar de uma vez travaria o modal.
- **Breakdown da pontuação como texto**, não tooltip: no celular não há hover.
- **A correção do fuso entra junto**, mudando o comportamento do limite diário
  existente (passa a zerar à meia-noite de Brasília). Decidido com o usuário.
- Sem `kind` no `highlights`, o card mostra o número de kills como fallback.

## Arquitetura

### 1. Cliente — portal e ergonomia do modal

`SeletorClipesCompeticao` passa a retornar
`createPortal(<overlay …/>, document.body)`. Nada mais do componente muda de
posição na árvore React (estado, props e handlers seguem iguais); só o destino
do DOM.

Junto, duas faltas que pesam mais agora que o conteúdo cresceu:

- **`Esc` fecha** o modal (listener em `keydown`, removido no unmount).
- **Scroll do fundo travado** enquanto aberto (`document.body.style.overflow`
  restaurado no unmount).

O `onClick={fechar}` no backdrop e o `stopPropagation` no painel continuam como
estão.

### 2. Servidor — `GET /api/competicoes/:id/elegiveis`

A query principal (`competicoes.js:285-295`) ganha três colunas das tabelas que
ela **já** junta — `ac.clip_url`, `ac.clip_snapshot_url`, `m.played_at` — e um
LEFT JOIN novo pra trazer o tipo da jogada:

```sql
left join highlights h
  on h.match_id = ac.match_id
 and h.steam_id64 = ac.steam_id64
 and h.round_number = ac.round_number
```

O join é **LEFT** deliberadamente. Clipes do fluxo novo têm `highlight_id` nulo
(`0042_clipe_por_jogador.sql:15`), e um INNER faria eles sumirem da lista — a
query atual evita o join justamente por isso (comentário em `competicoes.js:282`).
O LEFT preserva o comportamento e agrega o `kind` quando existe.

**Cuidado com duplicata**: nada impede o mesmo Jogador ter dois `highlights` no
mesmo round (um `ace` e um `clutch_1v4`, por exemplo) — `highlights` não tem
unique em `(match_id, steam_id64, round_number)`. Um LEFT JOIN ingênuo
multiplicaria a linha do clipe e o Clipe apareceria duas vezes na lista. O join
tem que colapsar pra no máximo uma linha, via subquery lateral que escolhe um
`kind` de forma determinística:

```sql
left join lateral (
  select h.kind from highlights h
  where h.match_id = ac.match_id
    and h.steam_id64 = ac.steam_id64
    and h.round_number = ac.round_number
  order by h.kind
  limit 1
) h on true
```

`order by h.kind` é arbitrário mas estável — o que importa é não duplicar e não
variar entre requisições. A primeira query (`competicoes.js:276`) também passa a
selecionar `limite_diario, limite_total, minimo_para_rankear`, que hoje ela não
traz e que o bloco `limites` precisa.

A resposta deixa de ser um array cru e passa a ser um objeto:

```json
{
  "clipes": [
    {
      "allstarClipId": "…", "matchId": "…", "roundNumber": 18, "map": "de_inferno",
      "playedAt": "2026-07-25T00:37:00Z", "kind": "clutch_1v3",
      "clipUrl": "https://…", "clipSnapshotUrl": "https://…",
      "pontuacao": { "kills": 3, "pontosKills": 50, "headshots": 2, "pontosHeadshots": 16,
                     "armas": 2, "pontosArmas": 10, "clutch": "1v3", "pontosClutch": 35,
                     "total": 111 },
      "jaEnviado": false
    }
  ],
  "limites": { "hoje": 2, "limiteDiario": 2, "total": 5, "limiteTotal": 10, "minimoParaRankear": 3 }
}
```

**Mudança de contrato**: o cliente atual espera um array. Os dois consumidores
são o mesmo componente (`SeletorClipesCompeticao`), atualizado no mesmo commit —
não há terceiro consumidor.

### 3. Servidor — contagem única e no fuso certo

A contagem hoje/total vive inline no `POST /submissoes`
(`competicoes.js:337-344`). Vira um helper exportado, usado pelos dois endpoints,
pra não existirem duas verdades sobre o mesmo número:

```js
// Conta as submissões do Jogador nesta Competição: no dia (fuso de Brasília) e no total.
// Fonte única pro limite aplicado no POST /submissoes e pro contador exibido no seletor —
// duas contagens divergentes fariam a UI prometer um envio que o servidor recusa.
async function contarSubmissoes(db, competicaoId, steamId) {
  const { rows } = await db.query(
    `select
       count(*) filter (
         where (enviado_em at time zone 'America/Sao_Paulo')::date
             = (now() at time zone 'America/Sao_Paulo')::date
       ) as hoje,
       count(*) as total
     from competicao_submissoes
     where competicao_id = $1 and steam_id64 = $2`,
    [competicaoId, steamId],
  )
  return { hoje: Number(rows[0].hoje), total: Number(rows[0].total) }
}
```

O `at time zone` corrige o limite diário existente: passa a zerar à meia-noite de
Brasília, como a regra da Competição sempre disse. É mudança de comportamento
consciente, aprovada pelo usuário.

### 4. Cliente — o card

Quatro faixas, de cima pra baixo:

1. **Thumbnail 16:9** com `clipSnapshotUrl` e um botão de play sobreposto.
   Clicar troca pelo iframe do player. **Um por vez**: abrir outro fecha o
   anterior (estado `clipeAbertoId` no componente pai). Sem snapshot, usa o
   `SnapshotPlaceholder` SVG que já existe.
2. **Jogada em destaque** — `ACE`, `QUAD`, `TRIPLE`, `CLUTCH 1v3`, derivada do
   `kind`. Sem `kind`, mostra `N KILLS` a partir de `pontuacao.kills`.
3. **Contexto** — `Inferno · 25/07/2026 · round 18`, com `nomeMapa` e `dataHora`
   de `lib/format.js` (que já formata em Brasília).
4. **Pontuação** — total em destaque e, embaixo, o breakdown em linha:
   `3 kills 50 · 2 hs 16 · 2 armas 10 · clutch 1v3 35`. Só entram os componentes
   que somaram. É texto, não tooltip.

### 5. Cliente — módulo compartilhado do player

`PlayerClipe` e `SnapshotPlaceholder` moram hoje dentro de
`site/client/src/components/CardClipe.jsx:22-45`, e `Partida.jsx:1030-1036` já
duplica o mesmo iframe com outro `location`. Este spec criaria a terceira cópia.

Os dois saem pra `site/client/src/components/ui/PlayerClipe.jsx`, exportando:

```jsx
<PlayerClipe clipUrl={…} viewerSteamId={…} location="selecaoCompeticao" />
<SnapshotPlaceholder />
```

`CardClipe.jsx` e o seletor passam a importar de lá. `Partida.jsx` **fica fora
deste escopo** — é um arquivo grande, com um painel de clipe próprio e outras
responsabilidades em volta; unificar os três é uma tarefa separada. Extrair o
que as duas telas novas precisam já evita a terceira cópia.

O `location` é parâmetro porque a Allstar usa isso pra telemetria e os dois
lugares mandam valores diferentes hoje (`melhoresClipes`, `matchResults`).

### 6. Cliente — cabeçalho e limites

Abaixo do título, uma linha em fonte mono:
`2 de 2 enviados hoje · 5 de 10 no total · mínimo 3 pra rankear`.

Quando um limite estoura, os botões de enviar ficam **desabilitados com o
motivo** ("limite diário atingido" / "limite total atingido") em vez de deixar o
Jogador clicar e tomar o erro do servidor. A validação do servidor continua
existindo e é a que vale — a do cliente é conveniência.

Depois de um envio bem-sucedido o `carregar()` já é chamado, então os contadores
se atualizam sozinhos.

## Testes

**Servidor** (`site/server/test/competicoes.test.js`):
- `/elegiveis` devolve `clipes` e `limites`, com `playedAt`, `kind`, `clipUrl` e
  `clipSnapshotUrl` presentes;
- clipe sem `highlights` correspondente continua na lista, com `kind` nulo
  (regressão do LEFT vs INNER join);
- `contarSubmissoes` conta no fuso de Brasília: uma submissão às 22h de Brasília
  (01h UTC do dia seguinte) conta como **hoje**, não como amanhã;
- `POST /submissoes` continua recusando no limite, usando o mesmo helper.

**Cliente** (`site/client/src/test/SeletorClipesCompeticao.test.jsx`):
- o overlay é renderizado no `document.body`, não dentro do elemento pai;
- `Esc` fecha o modal;
- o breakdown mostra só os componentes que somaram (clipe sem clutch não exibe
  "clutch");
- clipe sem `kind` mostra `N KILLS`;
- abrir o player de um clipe fecha o do outro;
- botão desabilitado com o motivo quando o limite diário está estourado.

## Fora de escopo

- Unificar o painel de clipe de `Partida.jsx` com o `PlayerClipe` compartilhado.
- Qualquer mudança na fórmula de pontuação (`site/server/src/clipesScore.js`).
- Reordenar ou filtrar a lista de elegíveis (segue por `played_at desc`).
- Desfazer um envio já feito.
