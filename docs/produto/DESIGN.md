---
name: Resenha
description: Ferramenta de análise de stats de CS2 para um grupo fechado de amigos
direction: Studio (2026-10)
colors:
  destaque-laranja: "#ff6a1a"
  destaque-laranja-forte: "#ff8240"
  sobre-destaque: "#1c0a00"
  time-a-dourado: "#e9b949"
  time-b-azul: "#5aa9ff"
  sucesso-verde: "#3ddc97"
  perigo-vermelho: "#f2555a"
  ranking-ouro: "#facc15"
  ranking-prata: "#cbd5e1"
  ranking-bronze: "#d97706"
  aviso-ambar: "#fbbf24"
  fundo: "#0a0a0b"
  superficie: "#111113"
  superficie-alta: "#18181b"
  superficie-topo: "#212125"
  borda: "#232327"
  borda-forte: "#303036"
  texto: "#ededef"
  texto-fraco: "#8a8a93"
typography:
  sans: "Geist, Inter, system-ui, sans-serif"
  mono: "Geist Mono, ui-monospace, monospace"
radius:
  pequeno: "6px"
  medio: "8px"
  grande: "12px"
---

# Design System: Resenha — "Studio"

## 1. Overview

**North Star: ferramenta de análise profissional.** O Resenha é onde o grupo senta depois do jogo pra entender o
que aconteceu. A direção "Studio" trata o site como um software de verdade, no espírito de Linear, Vercel e
scope.gg: neutro escuro, hairlines, um único acento, tipografia limpa e números sempre em mono. Nada de enfeite
"gamer" (neon, glow, cantos cortados, CAIXA ALTA em tudo). O jogo aparece no dado, não na decoração.

Substituiu em 2026-10 a direção anterior ("HUD tático": cantos cortados, vermelho, Rajdhani/JetBrains Mono,
títulos em caixa alta). Referências pesquisadas: scope.gg (escala de superfícies, um acento só), Leetify
(julgamento bom/ruim em todo stat), Blitz.gg (botões e abas), shots de dashboards de esports no
Dribbble/Pinterest.

**Características:**
- Neutro primeiro. Cor só quando significa algo: ação (laranja), time (dourado/azul), julgamento (verde/vermelho).
- Hairlines de 1px e degraus de superfície no lugar de sombra.
- Caixa de frase em todo título, botão, aba e rótulo. Caixa alta só em sigla (ADR, HS%, MVP, FACEIT).
- Geist pra interface, Geist Mono pra número, data, placar e ID.
- Cantos levemente arredondados: 6px em controle, 8px em grupo de controles, 12px em painel.

## 2. Cores

### Acento
- **Laranja** (`destaque`, `#ff6a1a`): ação e seleção — botão primário, link, foco, item ativo do menu.
  **Regra do Acento Único:** se dois elementos na mesma tela estão laranja por motivos diferentes, um está
  errado. Laranja nunca marca categoria, tag ("grupo", "seu time"), plataforma nem "isso é importante".
- Texto sobre laranja cheio usa `sobre-destaque` (`#1c0a00`).

### Times
- **Time A** dourado (`#e9b949`) e **Time B** azul (`#5aa9ff`). **Regra do Time Real:** a cor segue o time de
  verdade do jogador mostrado, nunca a posição na tela. O dourado é amarelado de propósito, pra não competir com
  o laranja do acento.

### Julgamento
- **Sucesso** `#3ddc97` / **Perigo** `#f2555a`: só pra bom/ruim (rating ≥ 1.0, vitória/derrota, fogo amigo).
- **Regra do Sinal Duplo:** nenhum julgamento depende só da cor — sempre com seta, ícone ou o valor ao lado.

### Ranking e aviso
- Ouro/prata/bronze só nas 3 primeiras posições. Aviso (`#fbbf24`) pra aviso não crítico.

### Neutros (4 degraus)
| Token | Hex | Uso |
|---|---|---|
| `fundo` | `#0a0a0b` | Página, menu lateral |
| `superficie` | `#111113` | Painel, card, campo |
| `superficie-alta` | `#18181b` | Hover de linha, popover, botão secundário |
| `superficie-topo` | `#212125` | Item ativo (aba, menu), hover dentro de popover |
| `borda` / `borda-forte` | `#232327` / `#303036` | Hairline / contorno de controle e flutuante |
| `texto` / `texto-fraco` | `#ededef` / `#8a8a93` | Texto / rótulo, metadado |

Hex que precisa existir em JS (canvas do Replay 2D, mapa de calor) fica espelhado em
`site/client/src/lib/colors.js` e `lib/replayEngine.js`. Mudou aqui, muda lá.

## 3. Tipografia

- **Geist** (400–700) pra toda a interface. Títulos: peso 600, tracking −0.02em.
- **Geist Mono** pra todo dado: placar, K/D/A, ADR, rating, data, ID. **Regra do Número Tabular:** coluna
  numérica é mono + `tabular-nums` + alinhada à direita. A classe `.tabular-nums` já aplica a fonte mono.

| Papel | Tamanho / peso |
|---|---|
| Título de página (`CabecalhoPagina`) | 28px / 600 |
| Título de seção (`SectionHeader`) | 16px / 600 |
| Corpo | 14px / 400 |
| Rótulo (`rotulo`) | 12px / 500, `texto-fraco` |
| Número de destaque | mono 24–64px / 500 |

## 4. Elevação

Chapado em repouso. Profundidade vem dos degraus de superfície e de `realce-topo` (1px de luz no topo do
painel). `shadow-flutuante` só em modal, popover, dropdown e tooltip. Sombra em card parado é bug.

## 5. Componentes

Tudo em `site/client/src/components/ui` (barrel `index.js`). Tela nova não escreve casca de botão, modal, aba
ou campo à mão.

- **Button / classesBotao** — `variante`: `primario` (laranja, uma por área), `secundario` (default),
  `contorno` (ação de marca secundária, ex. Apoie), `fantasma` (ações de linha/toolbar), `perigo`
  (destrutiva). `tamanho`: `xs`, `sm`, `md`, `lg`, `icone`. `carregando` mostra spinner.
- **Modal** — portal, Escape fecha só o modal do topo, trava o scroll, folha de baixo no mobile. Usar com
  `useTransicaoModal()`. Cabeçalho com título + X, corpo rolável, `rodape` com ações (primária à direita).
- **Abas** — `segmentado` pra filtro curto (trilho com item ativo em `superficie-topo`); `sublinhado` pra seções
  da página (sublinhado laranja de 2px). Setas ←/→ navegam. `title` opcional por item.
- **Input / Textarea / Campo / classeEntrada** — mesma casca do `Select`. Foco = borda laranja + anel suave.
- **Select** — dropdown próprio (não nativo), painel em portal com `shadow-flutuante`.
- **Skeleton / SkeletonLista / EstadoVazio / EstadoErro** — carregando, vazio (ícone + título + uma frase +
  uma ação) e erro. Nunca "Carregando…" solto.
- **CabecalhoPagina** — eyebrow + título + descrição + ações. **SectionHeader** — título de seção.
- **Card**, **Badge** (4 tons: destaque, sucesso, perigo, neutro), **Chip**, **StatTile**, **DataTable**,
  **Avatar**, **ResultChip**, **MapIcon** e os badges de Premier/FACEIT/rating/plataforma.

Os utilitários `panel-cut`, `panel-cut-sm` e `panel-cut-tr` continuam existindo por compatibilidade, mas hoje
são só raio (12px / 6px / 6px). Código novo usa `rounded-[var(--radius-*)]`.

### Navegação
Menu lateral no fundo da página, agrupado (Análise, Comunidade, Biblioteca, Conta, Admin); item ativo em
`superficie-topo` com ícone laranja. Header fixo com blur. No mobile, barra inferior com 4 rotas + "Mais".

### Tabela de dados
Cabeçalho 12px `texto-fraco` sem caixa alta, hairline entre linhas, sem zebra, hover em `superficie-alta`,
números mono à direita. Detalhe atrás de clique (linha expansível ou modal), nunca tudo na tabela principal.

## 6. Do / Don't

**Do**
- Caixa de frase em tudo que não é sigla.
- Uma ação primária laranja por área; o resto secundário ou fantasma.
- Seta/ícone junto de todo verde/vermelho.
- Densidade por contexto: Feed arejado, Partida densa.

**Don't**
- Laranja pra tag, categoria ou destaque genérico.
- Sombra, glow ou gradiente em conteúdo parado; gradiente em texto.
- Card dentro de card. Side-stripe colorido em card/alerta.
- Corte diagonal, CAIXA ALTA com tracking largo, mono em prosa.

## 7. Motion

- Interação (hover, foco): `duration-150`. Abertura/fechamento de painel e modal: 200ms (`useTransicaoModal`),
  curva `--ease-saida`.
- Flutuantes entram com fade + leve scale/translate; saem do DOM sem animação de saída (exceto modal).
- `prefers-reduced-motion` zera tudo globalmente em `index.css`.
- **Regra do Movimento Funcional:** se a animação não comunica hover, foco, abertura ou entrada, ela sai.
