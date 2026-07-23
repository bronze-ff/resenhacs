# Product

## Register

product

## Users

Um grupo fechado de ~10 amigos que jogam CS2 juntos (matchmaking e partidas pro time). Usam o site pra revisar
as próprias partidas depois de jogar — no celular, logo depois de sair de um jogo, ou no computador mais tarde
pra uma análise mais profunda. O job principal é "entender o que aconteceu naquela partida" em vários níveis:
da visão geral (quem jogou bem) até o detalhe round a round (o que cada um comprou, quem morreu pra quê), e
comparações diretas entre dois jogadores do grupo (Head to Head). Um caso de uso recorrente e concreto: resolver
discussões do grupo ("ele jurou que só jogou de Deagle a partida inteira") indo direto no dado.

## Product Purpose

Uma ferramenta de análise de stats de CS2 só pro grupo — descoberta automática das partidas, replay 2D, economia
por round, comparativos entre jogadores, tudo pensado pra esse grupo específico, não pra escala pública. Sucesso
= o site parecer uma ferramenta profissional de verdade (o tipo de coisa que um analista/coach usaria), mesmo
sendo grátis e fechado pro grupo — sem parecer "projeto de fim de semana".

## Brand Personality

Sério e analítico, com acabamento premium. Dado em primeiro lugar, decoração mínima e deliberada. O tom é de
ferramenta profissional que o grupo leva a sério (mesmo brincando sobre ranks baixos) — confiante, direto,
sem enfeite. Mantém a assinatura visual atual de cantos cortados (diagonal, estilo painel de HUD tático) como
identidade — a mudança é executar isso com mais refinamento (hierarquia, espaçamento, consistência), não abandonar
o motivo.

## Anti-references

Nenhuma referência pontual a evitar — o pedido explícito foi só "não parecer caseiro". Sem intenção de copiar
literalmente nenhum concorrente (Leetify, CSStats, Faceit foram citados como referência de padrões de UX, não
como alvo de cópia visual).

## Design Principles

1. **O corte diagonal (panel-cut) é a identidade do site, não um enfeite** — mantém em todo redesign, executado
   com mais polimento (sombra sutil, hierarquia clara, espaçamento consistente) em vez de removido.
2. **Análise séria em primeiro lugar** — cada tela deve parecer ferramenta de coach profissional: dado sempre
   com contexto de "isso é bom ou ruim" (não número nu), decoração só quando serve a leitura do dado.
3. **Nunca depender só de cor pra significado** — todo indicador bom/ruim/neutro reforça com ícone, seta ou peso
   de fonte além da cor (ninguém no grupo confirmou daltonismo, mas é prática básica de acessibilidade e o custo
   é baixo).
4. **Densidade certa pro contexto, não uma densidade única pro site inteiro** — o Feed é uma superfície de
   escaneamento rápido (lista, cards), a Partida é uma superfície analítica densa (tabelas, comparativos); não
   forçar a mesma densidade visual nas duas.
5. **Respeitar o que já funciona** — o design system atual (paleta, tabular-nums, tooltips por coluna, modais
   com progressive disclosure) já resolve boa parte dos vícios comuns de UI gerada por IA; o redesign é aplicar
   disciplina e consistência em cima disso, não recomeçar do zero.

## Accessibility & Inclusion

Sem requisito formal de WCAG nem confirmação de usuário daltônico no grupo — mas todo par de sinal bom/ruim
(vermelho/verde hoje) ganha reforço visual adicional (ícone ↑/↓, peso de fonte, ou o próprio valor numérico já
visível ao lado) pra não depender só da cor. Contraste de texto deve seguir o mínimo AA (corpo ≥4.5:1) como
prática padrão, sem necessidade de ir além disso agora.
