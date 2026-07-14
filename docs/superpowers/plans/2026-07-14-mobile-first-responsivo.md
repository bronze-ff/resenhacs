# Mobile-first / responsivo no site inteiro — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** o site inteiro utilizável num iPhone (viewport ~390px) sem zoom nem scroll horizontal: navegação por drawer, tabelas com scroll interno, radar/replay dimensionados pela tela, modais full-screen no mobile. Desktop permanece EXATAMENTE como está (mudanças só adicionam breakpoints, nunca alteram o layout ≥lg).

**Contexto observado (prints do usuário, iPhone):** sidebar fixa `w-60` sempre visível (Shell.jsx:33) esmaga o conteúdo; sem ela colapsar, todas as páginas ficam inutilizáveis. Viewport meta já existe e está correto.

## Global Constraints

- Tailwind v4, tokens do projeto (`bg-superficie`, `border-borda`, `text-destaque`, `panel-cut`, `font-display/mono`). Breakpoints: mobile-first (classes sem prefixo = mobile; `lg:` restaura o desktop atual).
- **Regra de ouro:** nenhum `overflow-x` no `body` em 390px; toda tabela/conteúdo largo ganha wrapper `overflow-x-auto` próprio.
- Alvos de toque ≥ 40px de altura em botões/abas no mobile.
- Desktop (≥1024px) визуально idêntico ao atual — zero regressão.
- Sem libs novas.
- Validação por task: `npm run build` limpo + auto-revisão descrevendo o comportamento em 390px de cada tela alterada.

### Task M1: Shell responsivo (drawer) — a fundação

**Files:** `site/client/src/components/Shell.jsx`

- Mobile (<lg): sidebar vira drawer overlay — escondida por padrão (`fixed inset-y-0 left-0 z-40 -translate-x-full transition-transform` + `translate-x-0` quando aberta), botão hamburger (☰) no header (só `lg:hidden`), backdrop `bg-fundo/70` clicável pra fechar, fecha ao navegar (onClick nos links de nav seta o estado). Desktop (lg+): exatamente o layout atual (`lg:static lg:translate-x-0`, hamburger some).
- Header mobile: hamburger à esquerda + logo compacto "RESENHA." + avatar/sair à direita; padding `px-4 lg:px-6`.
- Conteúdo: `main` com `px-4 py-4 lg:px-8 lg:py-6` (confira os paddings atuais e preserve o desktop).
- Build + commit.

### Task M2: Feed (Partidas), Ranking, Jogadores, Comparar

**Files:** `site/client/src/pages/Feed.jsx`, `Ranking.jsx`, `Jogadores.jsx`, `Comparar.jsx` (nomes reais podem variar — localize pelos `<Route>` em App.jsx)

- Feed: carrossel "Resenhas recentes" com `overflow-x-auto snap-x` (já parece横向 — garanta que funciona por toque e não estoura); filtros (período/mapas/vitórias) empilham (`flex-wrap`); linha de partida: placar não pode quebrar layout — em mobile a linha compacta (mapa+data em cima, jogadores truncados `line-clamp-1`, placar à direita sempre visível).
- Ranking/Jogadores: tabelas → wrapper `overflow-x-auto` com `min-w` interno; colunas menos importantes ganham `hidden sm:table-cell` (escolha por juízo: mantenha nick, partidas, rating, K/D sempre visíveis).
- Comparar: os dois painéis lado a lado empilham em mobile (`grid-cols-1 lg:grid-cols-2`).
- Build + commit.

### Task M3: Página da Partida (a mais pesada)

**Files:** `site/client/src/pages/Partida.jsx`, `site/client/src/components/ReplayViewer.jsx`, `MapaCalor.jsx`, e sub-componentes de economia/utilitária dentro de Partida.jsx

- Scoreboard (2 tabelas por time): wrapper `overflow-x-auto`, colunas secundárias `hidden sm:table-cell` (mantenha nick, K, D, A, dano, rating).
- Replay 2D: o canvas já é responsivo por width? Garanta `max-w-[calc(100vh-12rem)]` NÃO — replay precisa caber na LARGURA do mobile: `w-full` com controles (play/velocidade/rounds) em `flex-wrap` e botões ≥40px; kill feed lateral vira bloco abaixo do canvas em mobile (`flex-col lg:flex-row`).
- Linha do tempo de rounds: `overflow-x-auto` com snap.
- Economia (gráfico divergente com avatares): `overflow-x-auto` com `min-w-[640px]` interno (gráfico denso não precisa espremer — scroll horizontal DENTRO do card é aceitável aqui).
- Utilitária (2 tabelas): mesmo padrão do scoreboard.
- Mapa de calor: canvas `w-full` já ok; filtros em `flex-wrap`.
- Build + commit.

### Task M4: Granadas (landing + página do mapa) e modais

**Files:** `site/client/src/pages/Granadas.jsx`, `site/client/src/components/granadas/*.jsx`

- Landing: grid já é `sm:grid-cols-2 lg:grid-cols-3` — confira 1 coluna no mobile com cards ~h-32.
- PaginaMapa: sidebar (`lg:w-56`) empilha ACIMA do radar no mobile (já é `flex-col lg:flex-row` — confira) mas compacta: filtros em linha horizontal com `flex-wrap` (lado/tipos/callouts lado a lado, não uma coluna gigante); radar `w-full` (o cap de `max-w-[calc(100vh-9rem)]` continua valendo só quando a ALTURA é o gargalo — em mobile a largura é menor, então não interfere).
- Hover card do radar não existe em touch: no mobile o primeiro TAP num marcador mostra o card (posição fixa abaixo do radar, não flutuante) e o segundo tap (ou botão "ver detalhes" no card) abre o modal. Implementação: detectar touch via `window.matchMedia('(hover: none)')` uma vez; em touch, `onSelecionar` no primeiro clique vira "destacar + mostrar card", com botão no card pra abrir o modal.
- Modais (DetalheGranada, FormGranada): mobile = `inset-0` sem max-w (tela cheia, `rounded-none`), desktop igual atual (`sm:max-w-2xl` etc.). Vídeo embed mantém `aspect-video`.
- Build + commit.

### Task M5: páginas restantes + varredura final

**Files:** `Perfil/JogadorPerfil.jsx`, `Admin.jsx`, `PartidasPro.jsx`, `EnviarDemo.jsx`, `Taticas.jsx`, `Entrar.jsx` (localize os nomes reais via App.jsx)

- Perfil: grid de stat tiles `grid-cols-2 lg:grid-cols-4`; seções empilham.
- Admin/PartidasPro/EnviarDemo: forms `w-full`, inputs empilham, lista da fila com `truncate` na URL.
- Táticas: cards empilham; o `ReplayViewer` embutido herda o responsivo da M3.
- Entrar: centralizado, já deve ser simples — confira.
- VARREDURA: `grep -rn "w-\[\|min-w-\[\|w-96\|w-80\|w-72\|w-64\|w-60\|w-56" site/client/src` e avalie cada largura fixa achada fora das já tratadas; corrija as que estourariam 390px sem wrapper.
- Build + commit.

### Task M6: verificação (controlador)

- Suites + build; push; deploy; usuário confere no iPhone (não temos como logar via Steam no browser automatizado).
