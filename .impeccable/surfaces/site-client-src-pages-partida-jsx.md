---
version: 1
slug: "site-client-src-pages-partida-jsx"
primary_target: "site/client/src/pages/Partida.jsx"
related_targets: []
---

## Escopo

Página da Partida (`/partida/:id`), modo Operate. Mundo visual: Studio (docs/produto/DESIGN.md), sem mudança de tokens.

## Público e tarefa

Grupo de ~10 amigos revisando uma Partida de CS2 depois de jogar, no celular e no PC. Quatro tarefas com o mesmo peso: ver quem jogou bem; entender round a round; tirar discussão com um dado exato (dois jogadores, uma arma); assistir (Replay 2D, Highlights, Clipes).

## Restrições

- Mesmos dados e endpoints de hoje; nenhuma rota de API nova obrigatória.
- Deep links atuais continuam: `?highlight=`, `?round=&tick=&frame=`.
- Clicar num round leva ao round no Replay 2D. Sugerir tática vira ação secundária do round.
- Sem scroll horizontal no desktop (≥1280px). No celular o espelho vira lista: um jogador por linha, nick fixo à esquerda, Time A em cima do Time B; os stats rolam.
- Replay 2D pinta por LADO (CT azul, T dourado), pedido explícito do usuário (ReplayViewer.jsx). Não trocar por time A/B.
- Os glifos ↑↓▲▼★ são a convenção do projeto para reforçar o sinal de cor (PRODUCT.md).

## Direction contract

THESIS: A Partida é um confronto, então a tela é um espelho: Time A à esquerda, Time B à direita, e cada rótulo existe uma vez só, no trilho central. Recusa o arranjo padrão da categoria: sete abas, cada uma com duas tabelas iguais empilhadas.

OWN-WORLD: Studio intacto. Fundo #0a0a0b, superfícies em degraus, hairline de 1px, Geist na interface, Geist Mono em todo número, laranja só para ação e seleção, dourado e azul só para time. O trilho central é uma faixa estreita em superficie-alta com rótulos mono de 11px.

STORY: O visitante vê o placar e o MVP, lê os 10 jogadores frente a frente, troca a lente do trilho (Geral, Duelos, Utilitária, Armas) para responder a pergunta da discussão, clica num round e vê o round acontecer no Replay 2D.

FIRST VIEWPORT: Faixa de placar compacta no topo (mapa, data, resultado, placar uma vez só, MVP). Logo abaixo, o espelho: 5 linhas do Time A, trilho de rótulos, 5 linhas do Time B, com o seletor de lente centrado sobre o trilho, na barra do painel (entre os nomes dos times); o topo do trilho guarda o filtro de lado. Na base do viewport começa a faixa de rounds com a economia espelhada (A acima, B abaixo).

FORM: Frente a frente, índice 6 da lista ordenada (dealt lead), seed 33b82b8f. Raise do rw-centre-rail-reference-setting: o trilho central é a única peça que muda; trocar a lente troca os rótulos e as duas colunas respondem juntas.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Decisões em aberto

- Clipes (Allstar, DEMO-SLAP, link externo) viram uma seção única abaixo do Replay; a ordem interna fica para o build.
