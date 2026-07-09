# Resenha

Plataforma fechada (interface em PT-BR) para um grupo de amigos acompanhar estatísticas e highlights de partidas de CS2, combinando ideias de Leetify (stats), Scope.gg (análise/replay 2D) e Allstar.gg (clipes).

## Language

**Jogador**:
Um membro do grupo fechado (whitelist de Steam IDs) com perfil, histórico e presença nos rankings.
_Avoid_: usuário, player, member

**Participante**:
Qualquer um dos dez presentes numa Partida; aparece no placar daquela Partida, mas só ganha perfil se for Jogador.
_Avoid_: random, oponente

**Partida**:
Um jogo completo de CS2 registrado na plataforma, fonte de estatísticas e highlights.
_Avoid_: match, game, jogo

**Highlight**:
Um momento notável de uma Partida (ace, clutch, multi-kill) detectado ou registrado na plataforma.
_Avoid_: play, momento épico

**Momento Notável**:
A detecção automática de um Highlight a partir dos dados da Partida (ex.: "ACE no round 14").
_Avoid_: evento, feat

**Replay 2D**:
Visualização interativa top-down de um trecho da Partida no browser, sem vídeo renderizado.
_Avoid_: minimapa, viewer

**Clipe**:
Um vídeo de um Highlight, hospedado externamente (Allstar, Medal, YouTube) e anexado à plataforma por um Jogador.
_Avoid_: vídeo, video clip

**Sinergia**:
A relação estatística entre dois Jogadores que jogam no mesmo time: quantas Partidas juntos e a winrate da dupla.
_Avoid_: química, duo stats

**Demo**:
O arquivo .dem oficial de uma Partida, contendo todos os eventos e posições; fonte primária de dados da plataforma.
_Avoid_: replay, gravação

**Share Code**:
Código da Valve que identifica uma Partida de matchmaking e permite localizar seu Demo.
_Avoid_: match code

**Coletor**:
Processo recorrente que descobre Partidas novas via Share Code, baixa o Demo antes de expirar e extrai os dados.
_Avoid_: crawler, bot, worker

## Relationships

- Uma **Partida** tem dez **Participantes**, dos quais um ou mais são **Jogadores**
- Rankings e histórico agregam apenas **Jogadores**; **Participantes** anônimos existem só no placar da Partida (dados completos ficam guardados para análises futuras)
- Uma **Partida** produz zero ou mais **Highlights**
- Um **Highlight** pode ter um **Replay 2D** (gerado) e/ou **Clipes** (anexados manualmente)
- Um **Momento Notável** é a origem automática de um **Highlight**; um **Clipe** anexado é a origem manual
- Um **Share Code** identifica exatamente uma **Partida** de matchmaking
- O **Coletor** consome **Share Codes**, baixa **Demos** e produz os dados de **Partidas** (demos de Faceit/GC entram por upload manual)

## Example dialogue

> **Dev:** "Quando um **Jogador** faz um ace, o sistema cria o **Clipe** automaticamente?"
> **Especialista:** "Não — o sistema detecta o **Momento Notável** e cria o **Highlight** com **Replay 2D**. O **Clipe** em vídeo só existe se o Jogador anexar o link do Allstar."

## Flagged ambiguities

- "highlight" era usado para significar tanto o momento do jogo quanto o vídeo — resolvido: o momento é **Highlight**, o vídeo é **Clipe**.
- A plataforma **não renderiza vídeo**: vídeo de verdade vem sempre de fora (Allstar etc.) como **Clipe** anexado.
