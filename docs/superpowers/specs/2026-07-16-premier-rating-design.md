# Premier Rating (CS Rating) — Design

## Contexto

O grupo quer ver a pontuação de Premier (CS Rating) de cada jogador — igual o csstats mostra —
em dois lugares: no perfil do jogador (pontuação atual) e dentro de cada Partida (pontuação que
o jogador tinha antes daquela Partida específica + quanto ganhou ou perdeu).

## De onde vem o dado

O replay (.dem) do CS2 já guarda, por jogador e por tick, os campos usados pelo próprio jogo pra
mostrar a tela de "atualização de rank" no fim de uma Premier:

- `rank` (entidade `m_iCompetitiveRanking`) — a pontuação atual do jogador naquele tick.
- `rank_if_win` / `rank_if_loss` / `rank_if_tie` (`m_iCompetitiveRankingPredicted_*`) — o valor que
  a pontuação viraria em cada cenário de resultado. O próprio CS2 pré-calcula essas 3 previsões
  durante a partida; não precisamos simular nada, só escolher a previsão certa depois de saber o
  resultado real do jogador naquela Partida (vitória/derrota/empate).
- `comp_rank_type` (`m_iCompetitiveRankType`) — identifica o modo (Premier vs. Wingman vs.
  Competitivo por mapa vs. nenhum). Só gravamos pontuação quando esse campo indica Premier.

Isso significa: **nenhuma API externa, nenhuma chave, nenhum bot logado como amigo de ninguém** —
é um dado que o Coletor já tem disponível assim que baixa e processa a Partida, do mesmo jeito que
já lê X/Y/arma equipada pro Replay 2D.

**Spike necessário antes de implementar de verdade** (não é ambiguidade de design, é verificação
empírica de um valor específico): qual o valor exato de `comp_rank_type` que identifica Premier
(vs. os outros modos), e em que tick da partida esses campos ficam estáveis/corretos pra leitura
(provavelmente perto do fim, quando o resultado já é conhecido pelo motor do jogo — precisa
testar contra um demo real do grupo). Isso vira a primeira tarefa do plano de implementação, com
teste escrito contra um fixture real.

## Onde os dados ficam gravados

Duas colunas novas em `match_players` (nullable — só populadas quando `comp_rank_type` = Premier):

- `premier_rating_before` — pontuação do jogador antes dessa Partida.
- `premier_rating_after` — pontuação do jogador depois dessa Partida (a previsão certa, escolhida
  pelo resultado real: `rank_if_win` se ele venceu, `rank_if_loss` se perdeu, `rank_if_tie` se
  empatou).

O ganho/perda (`+42` / `−38`) é sempre `premier_rating_after - premier_rating_before`, calculado
na hora (não precisa de uma 3ª coluna). "Pontuação atual" no perfil do jogador é o
`premier_rating_after` da Partida de Premier mais recente dele.

## Onde aparece na interface

### Perfil do jogador (`JogadorPerfil.jsx`)

Um badge de pontuação (componente novo, `PremierBadge`) próximo aos stat tiles já existentes —
mesmo padrão visual do `RatingBadge` atual (chip colorido + número), mas com a paleta de faixa do
próprio Premier em vez do verde/vermelho de rating:

| Faixa (CS Rating) | Cor |
|---|---|
| 0–4.999 | cinza |
| 5.000–9.999 | azul claro |
| 10.000–14.999 | azul |
| 15.000–19.999 | roxo |
| 20.000–24.999 | rosa |
| 25.000–29.999 | vermelho |
| 30.000+ | dourado |

(Faixas oficiais do próprio CS2, confirmadas via pesquisa — os cortes exatos podem variar um
pouco por temporada, mas a tabela acima é a referência corrente.) Se o jogador nunca jogou Premier (sem `premier_rating_after` em nenhuma
Partida), o badge não aparece — sem "sem dado" ocupando espaço à toa num lugar que a maioria dos
jogadores do grupo pode nunca ter usado.

### Dentro da Partida (`Partida.jsx`, aba Visão Geral / Scoreboard)

Por jogador, quando a Partida é de Premier: pontuação antes (`premier_rating_before`) + o delta
colorido ao lado (`+42` verde com seta pra cima / `−38` vermelho com seta pra baixo — reforça com
ícone, não só cor, igual à Regra do Sinal Duplo do DESIGN.md). Quando a Partida não é Premier
(Wingman, Casual, Partida Pro), essa informação simplesmente não aparece no placar — sem "sem
dado" cru poluindo a maioria das Partidas do grupo (que são Premier, mas Partidas Pro nunca são).

## Partidas antigas

Como qualquer stat nova extraída do parser, isso só aparece pra Partidas processadas depois do
fix. Backfill das antigas precisa de mais um `reprocessar_tudo=true` do Coletor (mesmo mecanismo já
usado pro KAST) — não é bloqueante, roda numa release separada quando o usuário quiser.

## Fora de escopo (explicitamente adiado)

- Gráfico de evolução de Premier ao longo do tempo (tipo o csstats mostra um histórico) — pode
  vir depois como extensão do `LinhaEvolucao.jsx` já existente, não faz parte desta entrega.
- Premier de jogadores adversários (fora do grupo) — os dados existem no replay igual aos do
  grupo, então tecnicamente dá pra mostrar, mas o pedido original foi sobre perfil/Partida do
  grupo; se quiser estender depois é trivial (mesma coluna, sem trabalho extra de parser).
