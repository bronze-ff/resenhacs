# Referência visual — Táticas estilo csnades (Fase 3)

Data: 2026-07-13. O usuário forneceu 4 prints do csnades.gg (seção de táticas) como
referência do que a aba Táticas deve virar. Este arquivo captura a estrutura observada
pra Fase 3 (spec/plan próprios virão depois; Fase 2 = Granadas está em execução e é
pré-requisito, porque táticas LINKAM granadas da biblioteca curada).

## Listagem (página do mapa)

- Mesmo layout mapa-first da biblioteca de Granadas: sidebar esquerda + grid de cards.
- Sidebar: Trocar mapa (select), Trocar lado (T/CT), **Tipo** (Todas / Execute / Fake /
  Explode / Rush / Split / Setup), **Local** (Todas / A / B / MID), **Armas** (Todas /
  Full / Eco / Force / Pistol). Contador total no rodapé ("5 Táticas").
- Card de tática: thumbnail do radar com os ícones das granadas da tática desenhados
  (nuvens de smoke, raio de flash, fogo de molotov) e as zonas de site destacadas;
  badges no topo (site A/B + tipo, ex. "Execute"/"Split"); badge de quantos jogadores
  a tática exige (ex. "2", "3/4"); ícone de arma (pistol/rifle) e ícone do lado (T/CT);
  título embaixo (ex. "Split B #1", "A Pistol #1", "Default B").

## Detalhe (modal)

- Header: título + badges (tipo "Execute", arma "Pistol", lado "T", nº de jogadores "2"),
  botão de favorito (fora de escopo pra nós) e fechar.
- **Abas: Overview / Jogador 1 / Jogador 2 / ... (uma por papel).**
- Overview: radar à esquerda com TODAS as granadas da tática desenhadas; à direita
  DESCRIÇÃO (objetivo da tática) + JOGADORES: um card por papel com badge
  "necessário" (ou opcional) e o texto do papel ("Player 1 smokes connector and
  optionally throws a flash above ramp...").
- Aba de um jogador: radar mostra SÓ as granadas daquele papel (pontos de arremesso
  amarelos); à direita, a descrição do papel e, aninhado, o DETALHE DA GRANADA linkada
  da biblioteca (título, descrição, badges técnica/botão, abas Vídeo/Passos com player) —
  ou seja, cada papel referencia 0..N lineups da tabela `lineups_curados` (Fase 2).

## Implicações de modelo (Fase 3, a validar no brainstorm)

- `taticas_curadas`: map, lado, tipo (execute/fake/explode/rush/split/setup), local
  (A/B/MID), armas (full/eco/force/pistol), titulo, descricao, criado_por/em.
- `taticas_papeis`: tatica_id FK, ordem (Jogador 1..N), descricao, obrigatorio bool.
- `taticas_papel_granadas`: papel_id FK, lineup_curado_id FK (0..N por papel).
- Card thumbnail: renderizar mini-radar SVG com os marcadores das granadas linkadas
  (reusa MarcadorTipo de RadarGranadas).
- Decidir no brainstorm da Fase 3: o que fazer com a aba Táticas atual (sugestão por
  round de partida real + Replay 2D + aprovação no Admin) — substituir, fundir como
  "ver no replay" dentro da tática curada, ou manter como fluxo de sugestão.
