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

## Fase E — Social e gamificação (não estava na lista original — ideias novas)

Essas não são cópia de nenhuma ferramenta de mercado — pensadas especificamente pra um
grupo fechado de amigos, onde o motivo de usar o sistema é reforçar a resenha, não só
métricas frias.

15. **Nemesis & vítima favorita** — "quem mais te mata" e "quem você mais mata", por
    jogador, cruzando com jogadores de FORA do grupo também (todo `player_death` já é
    parseado; só falta persistir agregado por par de steamId). Aparece no perfil como
    "sua rivalidade" — bom gancho de zoeira no grupo.
16. **Badges automáticos** — conquistas que desbloqueiam sozinhas no ingest: primeiro
    ACE, primeiro 1v5, 100ª partida, sequência de 5 vitórias, "clutch de 1v4 salvando
    o mapa". Sem esforço de UI pesado (um grid de ícones no perfil) e dá recompensa
    imediata visível pra quem jogou bem ontem.
17. **Classificação de estilo de jogo** — regras simples sobre métricas que já calculamos
    (entry rate alto + ADR alto → "Entry Fragger"; utility damage alto + poucas kills →
    "Support"; % de kills com AWP → "AWPer"; posição média no heatmap longe do bombsite
    → "Lurker"). Vira uma tag no perfil, tipo "time da FIFA".
18. **"Resenha da semana" — resumo automático** — todo domingo (cron novo), gera um
    resumo textual da semana (partidas, V/D do grupo, destaque, recorde quebrado) e
    posta no Discord (junto com o webhook do item 6) ou fica fixado no topo do Feed.
19. **Progresso pessoal "eu vs eu"** — no perfil, comparação automática do mês atual
    contra o mês anterior (rating, HS%, clutch%) com seta de tendência — sem precisar
    mexer manualmente no filtro de período pra descobrir se está melhorando.
20. **Comentário/reação em partida** — campo de texto simples (ou emoji) por Partida,
    pros próprios membros comentarem ("perdemos de bobeira no 15", "clutch insano do
    Bronze"). Vira mural social embutido na página da Partida, sem precisar sair pro
    Discord pra comentar o jogo.
21. **Duo/trio ideal** — expandir a Sinergia (que já existe, só pares) pra trios: quais
    3 jogadores do grupo têm o melhor winrate jogando juntos, útil pra montar time.

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

## Dívida técnica conhecida (auditoria 2026-07-10)

Três agentes auditaram server/client/coletor+bot em paralelo. Os achados críticos (XSS
de clipe, crash de stream do R2, empate contado como derrota, crashes do MapaCalor/
Partida, correlação errada de resposta do GC no bot) já foram corrigidos e estão em
produção. O que ficou pra depois, por ordem de risco:

- **Último round da partida some da tabela `rounds`** — só é derivado de
  `round_officially_ended`, que tipicamente não dispara no round que fecha a partida
  (ela termina antes, no `cs_win_panel_match`). Efeito: o clutch/entry do round decisivo
  (o mais memorável) é sempre computado como perdido. `parse.py`.
- **Dois algoritmos de clutch divergentes** — `replay.py.detect_clutch` (usado nos
  Highlights) não olha quem ganhou o round; `transform.py.clutch_outcomes` (usado no
  Ranking/perfil) exige vitória do round. Podem discordar sobre a mesma partida.
- **Download truncado passa em silêncio** — se a CDN da Valve cortar a conexão no meio,
  o `.dem` parcial é parseado "com sucesso" e grava stats errados. `main.py`.
- **Upload manual sobe o `.dem` sem comprimir** sob a chave `demos/{id}.dem.bz2`
  (extensão mente sobre o conteúdo) — custo de storage 3-5x maior que o necessário.
- ~~**Lote do `fetch` sem limite**~~ — **resolvido 2026-07-18**: processa em lotes de 15
  por run (mais recentes primeiro), commitando cada partida. Runs de 30/60min drenam
  o resto sem estourar o timeout.
- ~~**Revogação de acesso/admin demora até 7 dias**~~ — **já resolvido antes desta entrada
  ser escrita** (código desatualizou o roadmap): `createRequireSuperAdmin`
  (`site/server/src/auth/middleware.js`) já reconsulta `players.is_super_admin` no banco
  a cada request quando o claim do JWT diz `true` — rebaixar um admin tem efeito
  imediato. O claim `isSuperAdmin` do cookie do usuário rebaixado continua "mentindo"
  por até 7 dias, mas é inofensivo (não concede privilégio nenhum, só serve de
  pré-filtro pra evitar tocar o banco quando já é `false`). Não há hoje nenhum
  mecanismo geral de "revogar acesso" de usuário comum no schema — só admin (coberto)
  e convite de grupo (`revogado_em`, já revalidado a cada request via
  `createRequireGroupMember`).
- **Re-ingest não limpa jogador/round órfão** — se um fix no parser reduzir rounds ou
  remover um sid espúrio, a linha antiga fica pra trás em vez de ser removida.
- **Replay 2D sem streaming por round** (achado em `docs/adr/0005-libs-animacao-e-performance.md`)
  — o client baixa o JSON da partida inteira (vários MB) antes do primeiro round tocar;
  em mobile com conexão ruim pode significar espera perceptível. Baixa prioridade — só
  agir se virar reclamação real.

## Fora de escopo (decidido)

- ~~Renderização de vídeo estilo Allstar~~ — **reaberto 2026-07-19**: construir a
  renderização por conta própria continua fora de escopo (risco de ban de conta Steam,
  ver `docs/adr/0004-viabilidade-clipes-video-real.md`), mas **integrar com a API de
  clipes do Allstar** (conta de parceiro já criada) está em avaliação — só falta o
  preço deles pra decidir com o grupo.
- Análise de economia ($ por round) — demoparser2 expõe, mas custo/benefício baixo agora.
- Win rate forecast estilo Leetify — exige modelo/dados que não temos.
