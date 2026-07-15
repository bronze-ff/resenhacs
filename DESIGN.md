---
name: Resenha
description: Ferramenta de análise de stats de CS2 para um grupo fechado de amigos
colors:
  destaque-vermelho: "#ff2e43"
  destaque-vermelho-fraco: "#4a1219"
  time-a-ambar: "#f5a524"
  time-b-azul: "#4fb6ff"
  sucesso-verde: "#24d17e"
  perigo-vermelho: "#ff3b4e"
  fundo-quase-preto: "#0a0a0c"
  superficie: "#141419"
  superficie-alta: "#1d1d24"
  borda: "#2a2a32"
  texto: "#f1f2f4"
  texto-fraco: "#8b8b96"
typography:
  display:
    fontFamily: "Rajdhani, system-ui, sans-serif"
    fontWeight: 600
    letterSpacing: "0.02em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontWeight: 400
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    letterSpacing: "0.05em"
rounded:
  none: "0px"
spacing:
  panel-cut-lg: "14px"
  panel-cut-sm: "8px"
components:
  card:
    backgroundColor: "{colors.superficie}"
    rounded: "{rounded.none}"
  badge-destaque:
    backgroundColor: "{colors.destaque-vermelho}"
    textColor: "{colors.destaque-vermelho}"
  badge-sucesso:
    backgroundColor: "{colors.sucesso-verde}"
    textColor: "{colors.sucesso-verde}"
  badge-perigo:
    backgroundColor: "{colors.perigo-vermelho}"
    textColor: "{colors.perigo-vermelho}"
---

# Design System: Resenha

## 1. Overview

**Creative North Star: "Debriefing pós-partida"**

O Resenha é a sala onde o grupo se senta depois do jogo pra entender o que aconteceu de verdade — não um app de
entretenimento, uma mesa de análise. Cada tela deve parecer o painel de um analista revisando a fita: dado em
primeiro lugar, decoração só quando serve a leitura, tom sério mesmo quando o assunto é brincadeira entre amigos.
A identidade visual herdada — cantos cortados diagonalmente, tipografia monoespaçada pra tudo que é número,
paleta escura e contida — já aponta nessa direção; o trabalho de redesign é executar essa direção com mais
disciplina e consistência, não abandoná-la por um dashboard SaaS genérico.

Rejeita explicitamente: cantos arredondados como default, cards aninhados dentro de cards, gradiente em texto,
qualquer coisa que pareça "template de fim de semana" em vez de ferramenta com identidade própria.

**Key Characteristics:**
- Corte diagonal (panel-cut) como assinatura, não enfeite — aparece em praticamente todo container.
- Um único acento de cor "principal" (vermelho/coral), usado com moderação — o resto da paleta é neutro ou
  semântico (bom/ruim/times).
- Tipografia mono pra todo dado tabular/numérico; display condensado pra títulos e números grandes; sans só pra
  prosa corrida (que é rara nesse produto).
- Chapado por padrão — sem sombra em superfícies de repouso; profundidade vem do corte + contraste entre camadas
  de fundo.

## 2. Colors

Paleta escura e contida: um acento quente único, dois tons de time (âmbar/azul) que nunca competem com o acento,
e dois semânticos (sucesso/perigo) reservados só pra julgamento de performance.

### Primary
- **Vermelho de Destaque** (`#ff2e43`): o único acento "de ação" do sistema — CTAs, links, seleção ativa, foco,
  hover de interativos. **A Regra do Acento Único**: se dois elementos na mesma tela usam vermelho de destaque
  por motivos diferentes, um dos dois está errado — essa cor significa "aja aqui" ou "isso está selecionado",
  nunca "isso é importante" em geral.
  - *Nota de decisão*: o comentário antigo no CSS descrevia a intenção original como "âmbar decisivo", mas a
    implementação real sempre foi esse vermelho/coral — já consolidado em botões, seleção de texto, hover, links
    há várias sessões de desenvolvimento. Mantém-se o vermelho como fonte de verdade; o comentário desatualizado
    é corrigido, a cor não muda.
- **Vermelho de Destaque (fraco)** (`#4a1219`): variante escura do acento, usada como fundo sutil atrás de texto/
  ícone na cor cheia (nunca como acento isolado).

### Secondary
- **Âmbar do Time A** (`#f5a524`) / **Azul do Time B** (`#4fb6ff`): identificam de qual lado um jogador/dado é,
  em qualquer tela que compare os dois times (placar, economia, replay 2D, Head to Head). **A Regra do Time
  Real**: a cor segue o time de verdade do jogador sendo mostrado, nunca uma posição fixa na tela — alguém do
  Time B nunca deve ver os próprios números pintados de âmbar só porque "sempre foi a cor da esquerda".

### Tertiary
- **Verde de Sucesso** (`#24d17e`) / **Vermelho de Perigo** (`#ff3b4e`): julgamento de bom/ruim — rating acima/
  abaixo de 1.0, vitória/derrota, fogo amigo. Reservados exclusivamente pra esse julgamento; nunca usados como
  decoração ou pra identificar time.

### Neutral
- **Fundo** (`#0a0a0c`): quase preto, fundo de página inteira.
- **Superfície** (`#141419`): fundo de painéis/cards — um degrau acima do fundo.
- **Superfície Alta** (`#1d1d24`): hover de linha, popovers — um degrau acima da superfície.
- **Borda** (`#2a2a32`): hairlines entre linhas, contorno de painéis, scrollbar.
- **Texto** (`#f1f2f4`): texto principal, quase branco.
- **Texto Fraco** (`#8b8b96`): rótulos, texto secundário, metadado.

### Named Rules
**A Regra do Sinal Duplo.** Nenhum julgamento de bom/ruim depende só da cor verde/vermelho — todo indicador
carrega também um ícone, seta, ou o próprio valor numérico visível ao lado. Ninguém no grupo confirmou
daltonismo, mas o custo de reforçar é baixo e a prática é padrão.

## 3. Typography

**Display Font:** Rajdhani (com fallback `system-ui, sans-serif`)
**Body Font:** Inter (com fallback `system-ui, sans-serif`)
**Label/Mono Font:** JetBrains Mono (com fallback `ui-monospace, monospace`)

**Character:** Rajdhani condensado dá peso técnico aos títulos e números grandes sem parecer decorativo; JetBrains
Mono trata todo dado tabular como informação de instrumento, não como texto comum; Inter fica reservado pra prosa
corrida, que é rara nesse produto — a maior parte da tela é rótulo + número, não parágrafo.

### Hierarchy
- **Display** (peso 600-700, Rajdhani, tracking +0.02em): títulos de seção, placar da partida, valores grandes
  de destaque (rating, contagens). Números de display grandes usam `.display-tight` (tracking -0.01em) pra
  compensar o tracking positivo do Rajdhani em tamanhos maiores.
- **Label/Mono** (JetBrains Mono, `text-[10px]` a `text-sm`, uppercase, tracking +0.05em quando é rótulo de
  coluna/badge): todo dado tabular — placares, K/D/A/ADR/Rating, datas, IDs. **A Regra do Número Tabular**: se o
  valor é comparado por magnitude com outro na mesma coluna, ele é mono + `tabular-nums`, alinhado à direita.
  Datas, códigos e IDs não são comparados por magnitude e alinham à esquerda mesmo em mono.
- **Body** (Inter, peso 400): prosa corrida — textos de ajuda, descrições, mensagens de erro/vazio. Máximo de
  65-75ch quando for parágrafo de verdade (raro nesse produto).

### Named Rules
**A Regra do Mono Automático.** Dado tabular nunca escolhe a fonte manualmente — herda de uma classe utilitária
(`.tabular-nums`) aplicada uma vez no elemento pai. Se uma coluna numérica nova nascer sem essa classe, é bug de
implementação, não uma exceção de design.

## 4. Elevation

Chapado por padrão em toda superfície de repouso — sem sombra em cards, painéis ou linhas de tabela. Profundidade
vem de duas fontes só: o corte diagonal (que já cria uma silhueta não-retangular, dispensando sombra pra "separar"
o painel do fundo) e o contraste entre as três camadas de superfície (fundo → superfície → superfície-alta).
Elementos **transitórios e flutuantes** (modal, popover, tooltip, dropdown aberto) ganham uma sombra ambiente
sutil — não pra parecer "cartão elevado", mas pra reforçar que aquele elemento está temporariamente por cima do
resto da tela, já que ele quebra o fluxo normal de camadas.

### Shadow Vocabulary
- **Flutuante** (`box-shadow: 0 8px 32px rgba(0,0,0,0.45)`): modais, popovers, dropdowns abertos, tooltip
  flutuante do Replay 2D/Head to Head. Nunca aplicada a conteúdo em repouso no fluxo normal da página.

### Named Rules
**A Regra do Chapado-Por-Padrão.** Se uma sombra está sendo aplicada a algo que não se move/sobrepõe (um card
normal, uma linha de tabela, um badge), ela está errada — volte pro corte diagonal + contraste de camada.
Sombra é reservada pra quando algo genuinamente flutua por cima do resto.

## 5. Components

Cada componente carrega o corte diagonal como silhueta padrão — a exceção (retângulo reto) precisa de motivo
explícito (modal fullscreen mobile, onde o corte exporia o backdrop).

### Buttons
- **Shape:** corte diagonal `panel-cut-sm` (canto de 8px cortado), nunca border-radius.
- **Primary:** fundo vermelho de destaque cheio, texto no tom de fundo (`#0a0a0c`), peso 600, uppercase,
  tracking largo — mono ou display conforme o contexto.
- **Hover / Focus:** primary escurece levemente; secundário/ghost ganha borda vermelho-destaque e texto muda pra
  destaque no hover.
- **Secondary / Ghost:** borda neutra (`borda`), texto `texto-fraco`, sem fundo — vira destaque só no hover/foco.

### Chips (Badge)
- **Style:** corte `panel-cut-sm`, fórmula fixa border 40% + fundo 10-15% + texto na cor cheia do tom.
- **State:** 4 tons semânticos fixos — destaque (metadado/categoria, ex. "AUTO"/"PRO"), sucesso, perigo, neutro.
  Nunca um 5º tom ad-hoc; se nenhum dos 4 serve, o dado não deveria ser um badge.

### Cards / Containers
- **Corner Style:** corte diagonal `panel-cut` (14px) em containers grandes, `panel-cut-sm` (8px) em elementos
  pequenos (badge, avatar-fallback, ícone de mapa).
- **Background:** `superficie`, um degrau acima do `fundo` da página.
- **Shadow Strategy:** nenhuma em repouso (ver Elevation) — só se o card for, ele mesmo, um modal/popover
  flutuante.
- **Border:** hairline 1px `borda` em quase todo container.
- **Internal Padding:** compacto (`p-3`/`p-4`), nunca o respiro generoso de um card de marketing.

### Inputs / Fields (Select)
- **Style:** dropdown customizado (não `<select>` nativo) — botão trigger idêntico ao antigo (borda `borda`,
  fundo `superficie`, seta SVG), painel de opções em portal pro `<body>` com `panel-cut-sm`, sombra flutuante
  e `position: fixed` calculado a partir do trigger (nunca `absolute` dentro de um container com `panel-cut`,
  que quebraria o posicionamento — mesmo bug já visto no modal de detalhe por round).
  - *Nota de decisão*: a primeira versão deste sistema usava `<select>` nativo de propósito (teclado/leitor de
    tela/picker mobile de graça). Feedback direto de uso mostrou que o popup nativo (fundo branco, destaque azul
    do SO) destoava do resto do produto — "muito amador". A versão customizada reimplementa navegação por
    teclado (setas, Enter/Espaço, Escape, fecha ao clicar fora) e `role="listbox"`/`role="option"` à mão para
    não perder acessibilidade ao trocar de abordagem.
- **Focus/Hover:** borda muda pra destaque/60% no hover, destaque cheio quando aberto; seta acompanha a cor e
  gira 180° aberto.
- **Opção selecionada:** texto na cor de destaque + ícone de check; opção em foco/hover por teclado ou mouse
  ganha fundo `superficie-alta`.
- **Disabled:** opacidade reduzida, cursor `not-allowed`.

### Navigation
- Sidebar fixa à esquerda (desktop) com item ativo marcado por borda esquerda fina + fundo destaque a 10% — a
  única exceção tolerada à "Regra do sem side-stripe", porque aqui é indicador de estado de navegação (como uma
  aba ativa), não decoração de card/alerta. Barra inferior fixa no mobile (estilo app), com "Mais" abrindo um
  drawer com o restante do menu.

### Tabela de Dados (componente-assinatura)
- Cabeçalho mono uppercase `text-[10px]`, texto-fraco; hairline entre linhas (nunca zebra — as tabelas do
  produto são interativas, hover + clique abrem detalhe, e zebra some com esse tipo de estado); hover de linha
  = `superficie-alta`; toda coluna numérica right-align + tabular-nums; linhas expansíveis (clique abre
  detalhe/modal) são o padrão de "progressive disclosure" do produto — a tabela principal fica enxuta, o
  detalhe fica atrás de um clique, nunca na tabela principal.

## 6. Do's and Don'ts

### Do:
- **Do** usar corte diagonal (`panel-cut`/`panel-cut-sm`) como silhueta padrão de qualquer container novo.
- **Do** reforçar todo indicador bom/ruim com ícone/seta além da cor verde/vermelho (Regra do Sinal Duplo).
- **Do** manter a cor de time seguindo o time real do jogador mostrado, nunca uma posição fixa na tela.
- **Do** aplicar `tabular-nums` + mono + right-align em toda coluna numérica nova, sem exceção.
- **Do** reservar sombra só pra elementos flutuantes/transitórios (modal, popover, tooltip) — nunca em repouso.
- **Do** ajustar a densidade por contexto: superfície de escaneamento rápido (Feed) fica mais espaçada, superfície
  analítica densa (Partida) cabe mais colunas — não forçar a mesma densidade em todo o site.

### Don't:
- **Don't** usar border-radius arredondado como default — o corte diagonal é a linguagem geométrica do produto.
- **Don't** usar side-stripe (`border-left`/`border-right` colorido) em cards/alertas/listas — exceção única e
  já registrada: item ativo da navegação lateral, que é indicador de estado, não decoração.
- **Don't** aninhar cards dentro de cards.
- **Don't** aplicar gradiente em texto (`background-clip: text`) — ênfase é peso/tamanho, nunca gradiente.
- **Don't** aplicar zebra striping em tabelas — são interativas (hover/clique), zebra cria ruído visual com esse
  tipo de estado; hairline é a escolha já feita.
- **Don't** deixar um dado de julgamento (bom/ruim) depender só da cor — sempre par com ícone/seta/peso.
- **Don't** parecer "projeto de fim de semana" — é a única anti-referência explícita do produto (PRODUCT.md).
