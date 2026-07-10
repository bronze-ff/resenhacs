# Roadmap de funcionalidades — pós-v1.5

Atualizado em 2026-07-10. Ordenado por valor pro grupo ÷ esforço. O critério de corte:
só entra funcionalidade que os dados que JÁ parseamos suportam (ou exigem extração nova
barata de eventos que o demoparser2 já entrega). Nada de renderização de vídeo (ver BRIEF).

## Fase A — Análise por partida (estilo Leetify "Match Details")

1. **Aba Clutches na Partida** — grade por jogador: cada situação 1vX (round, contra
   quantos, kills feitas, VENCEU/PERDEU/SAVED). `transform.clutch_outcomes` já detecta
   tudo; falta persistir o detalhe por round (hoje só agregamos W/tentativas) e a UI.
2. **Aba Duelos (entry) e Trades na Partida** — quem abriu cada round e contra quem,
   round a round; quem trocou/vingou. `entry_duels`/`trade_kills` já devolvem listas
   por round — persistir detalhe + UI.
3. **Utility detalhada por jogador na partida** — flashes jogadas, inimigos cegados,
   tempo total de cegueira causado, flash assists (kill até 3s depois do cegado), dano
   de HE/molotov. Tudo parseável dos eventos que já lemos (`player_blind` tem atacante
   e duração; `weapon_fire` tem flashbang). Não temos economia ($ não gasto fica fora).
4. **MVP da partida + timeline de rounds** — faixa horizontal round a round (vencedor,
   plant, ace) na página da Partida; MVP = maior rating da partida.

## Fase B — Grupo e tempo

5. **Sessions ("Resenhas")** — agrupar partidas da mesma noite: "Resenha de 09/07:
   5 jogos, 3V–2D, destaque da noite: fulano (1.45)". Agrupamento por gap < 2h entre
   partidas; card no topo do feed.
6. **Webhook do Discord** — quando o Coletor ingere partida nova, posta resumo no canal
   do grupo (placar do ponto de vista do grupo, destaque, link). Esforço mínimo, valor
   social enorme. Secret DISCORD_WEBHOOK_URL no Actions.
7. **Forma recente no Ranking** — seta ↑/↓ comparando rating das últimas 5 partidas vs
   média geral do jogador.
8. **Recordes do grupo (hall da fama)** — mais kills numa partida, melhor ADR, maior
   sequência de vitórias do grupo, mais clutches numa noite. Página nova ou seção no
   Ranking.

## Fase C — Arma, lado e mapa

9. **Stats por arma** — kills/HS% por arma por jogador (AWP vs rifle vs pistola). O
   replay JSON já tem `weapon` em cada kill; persistir agregado por partida.
10. **Winrate por lado (CT/TR) por mapa** — "a gente é muito pior de TR na Mirage?".
    Precisa registrar o lado de cada half (parseável do team_num por round).
11. **Heatmap agregado no perfil** — onde o jogador morre/mata somando TODAS as
    partidas (hoje o heatmap é por partida). Persistir posições de kill/morte numa
    tabela leve (x, y, mapa, jogador) no ingest.

## Fase D — Social e polish

12. **Share card** — imagem gerada da partida (placar + destaque) pra colar no grupo.
13. **PWA/mobile polish** — o grupo vê no celular.
14. **Achievements internos** — "Pistoleiro do mês", "Rei do clutch", etc.

## Fora de escopo (decidido)

- Renderização de vídeo estilo Allstar (BRIEF; deep-link no Replay 2D cobre).
- Análise de economia ($ por round) — demoparser2 expõe, mas custo/benefício baixo agora.
- Win rate forecast estilo Leetify — exige modelo/dados que não temos.
