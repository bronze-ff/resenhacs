# Resenha v3 — planejamento

Reformulação geral pedida em 2026-10-16: o grupo voltou a jogar e quer o site mais completo,
mais fácil de usar e mais "resenha". Referências: Leetify, scope.gg, FACEIT, CSStats,
Allstar, cs2.cam e csnades. Protótipos visuais no canvas de design (telas Feed, Partida,
Perfil, Mapas, Resenha do mês, Clipes 2D, Quadro tático, Navegação).

## O que entra nesta rodada

| Frente | O que muda pra quem usa | Migration |
|---|---|---|
| Dados de kills | Team kill (TK) passa a ficar registrado, com as marcas wallbang, pela smoke, cego e noscope. Base pro clipe do TK de granada, prêmios e conquistas. | 0054 |
| Clipes 2D | Na Partida: lista das suas kills com filtros (HS, granada, TK…), escolha quais quer e grava um clipe ou uma **montagem** em vídeo a partir do Replay 2D, direto no navegador. O clipe do jogo pela Allstar continua. | — |
| Social | **Rivalidades** (carrasco, freguês, melhor e pior dupla) no perfil; página **Resenha do mês/semana** com prêmios automáticos (Carregou, Rei do clutch, Fogo amigo, Baiter, Mão de alface, Mapa maldito…); aviso no **Discord** quando uma partida é processada. | (0057 se precisar) |
| Análise | Página **Mapas** (winrate por mapa e lado, contra o período anterior e a média do grupo); **duelos de abertura e trocas** no perfil e na Partida. | — |
| Granadas automáticas | Biblioteca montada sozinha a partir das demos do grupo e de pro: posição, alvo, **comando de treino** (`setpos`/`setang`) pra copiar e "ver no Replay 2D". Sem precisar cadastrar vídeo. | 0055 |
| FACEIT | Corrige o bug que só procurava partidas do último mês; estatísticas mais completas nas partidas sem demo; nova tentativa automática de baixar a demo quando o acesso for liberado. | 0056 |
| Quadro tático | Modo "sério" (cs2.cam): quadro 2D com jogadores, granadas, setas e passos; salvar e abrir; importar as posições de um momento do Replay 2D. | 0058 |
| Navegação | Menu por intenção (Eu, Grupo, Treinar, Conta), busca rápida (Ctrl+K) e "Primeiros passos" pra quem é novo. | — |

## O que depende de você

1. **FACEIT — pedir acesso à Downloads API** em developers.faceit.com (App Studio → seu app →
   API keys). Sem isso as partidas da FACEIT entram só com estatísticas (sem Replay 2D,
   clipes, granadas). O código já tenta de novo sozinho quando o acesso sair.
2. **Discord** — criar um webhook no canal do grupo e salvar como secret `DISCORD_WEBHOOK_URL`
   no GitHub (Settings → Secrets → Actions). Sem ele o aviso só fica desligado.
3. **Aplicar as migrations** novas no Supabase (0053 se ainda não, e as desta rodada).
4. **Allstar** — no e-mail pendente pra partners@allstar.gg, perguntar se liberam pedido de clipe
   por round (`rounds`) e o preço por clipe. Hoje a API não deixa escolher a kill.

## Próxima rodada (não cabe agora)

- **Clipe real de qualquer kill** (como o "Record clips" do scope.gg): exige rodar o CS2 de
  verdade num PC com Windows (CS Demo Manager + HLAE). Dá pra exportar do site a lista de ticks
  escolhidos pra renderizar no seu PC; render em nuvem esbarra em custo de GPU e risco de ban.
- **Ratings estilo Leetify** (mira, utilitária, posicionamento) e **Focus areas** — precisam de
  dado por tick (velocidade, ângulo de mira), parse mais pesado.
- **Probabilidade de vitória por round** ("o round que a gente jogou fora").
- **Conquistas com raridade** e **card compartilhável** da partida (imagem gerada).
- **Multiround** no Replay 2D (vários rounds sobrepostos) e **heatmap de timings**.
- **Partidas pro** como biblioteca de estudo (filtros por time, mapa, execução).
