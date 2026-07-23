# ADR-0005: Libs de animação (three.js/GSAP/anime.js/Motion) e performance/escalabilidade

**Data:** 2026-07-19
**Status:** Análise — recomendações, não decisão de implementação

## Contexto

Filippe pediu avaliação de quatro bibliotecas de animação/gráficos (three.js, GSAP,
anime.js, Motion) pro Resenha, além de um raio-x geral de performance/escalabilidade.
Novas funcionalidades de produto já têm um roadmap rico e atualizado
(`docs/ROADMAP.md`, Fases A-E) — este documento **não repete essa lista**, foca só no
que é genuinamente novo: avaliação técnica das libs e estado real de performance.

## Estado atual (confirmado por leitura de código, 2026-07-19)

- **Replay 2D** (`ReplayViewer.jsx`): canvas 2D puro, sem nenhuma lib gráfica.
  `requestAnimationFrame` manual, playback com scrubber, velocidade, deep-link pra
  highlight. Funciona bem, mas o JSON de replay é grande (~543KB **por round** no
  arquivo de exemplo — uma partida de 20-30 rounds fica na casa de vários MB) e é
  buscado inteiro antes do playback começar, sem streaming por round.
- **`package.json` do client:** só `react`, `react-dom`, `react-router-dom`, `qrcode`.
  **Nenhuma lib de animação/3D instalada** — ponto de partida limpo, qualquer escolha
  aqui é decisão nova, não substituição.
- **Mobile:** overhaul completo já feito e documentado (`docs/superpowers/plans/2026-07-14-mobile-first-responsivo.md`,
  M1 a M5 + varredura final) — sidebar vira drawer, cards estilo app, nav inferior,
  larguras fixas eliminadas. **Não há trabalho pendente conhecido aqui.**
- **Performance geral:** feed paginado de verdade (`limit`/`offset`), sem N+1 nas rotas
  principais (detalhe da Partida usa `Promise.all` com 6 queries paralelas, não loop),
  bundle do client ~3.7MB total / ~481KB de JS principal não-gzipado, com code-splitting
  por mapa. Escala de uso: grupo fechado de ~10-15 pessoas, centenas de partidas — carga
  muito abaixo do que justificaria preocupação de escalabilidade agora.

## Avaliação das libs

### three.js — NÃO recomendado para o Replay 2D atual

three.js é uma engine 3D (WebGL) — trocar o Replay 2D por ela significaria reconstruir
o mapa em 3D, com modelos, texturas, iluminação. Isso é um projeto grande por si só
(pesquisado em conjunto com o ADR-0004: é exatamente a técnica da alternativa "Replay 3D"
levantada lá como plano B pro caso de clipe em vídeo). **Não é uma troca simples do
Replay 2D atual** — é uma feature nova e cara, com necessidade de assets 3D dos 8 mapas
calibrados hoje. Só faz sentido investir nisso **se** a integração com Allstar não
fechar economicamente (ver ADR-0004) e o grupo quiser um substituto sem custo por clipe.
Não recomendo abrir essa frente agora — mantém como opção registrada, não como trabalho.

### GSAP (gsap-skills), anime.js, Motion (motion.dev) — recomendado, uso pontual

Essas três são bibliotecas de **tweening/easing** (animam valores de propriedades CSS/JS
ao longo do tempo), não engines gráficas — categoria diferente de three.js. Servem pra
polir a interface, não pra substituir o Replay 2D.

**Comparação rápida:**
| Lib | Tamanho | Pontos fortes | Quando usar |
|---|---|---|---|
| **Motion** (motion.dev, sucessora do Framer Motion) | ~18KB core | API declarativa em React (`motion.div`), spring physics, layout animations automáticas | Se a maior parte das animações for em componentes React (cards do Feed/Ranking entrando, modais, transições de rota) |
| **GSAP** | ~30-70KB conforme plugins | Controle fino de timeline, o mais maduro/testado do mercado, ótimo pra sequências coordenadas | Se quiser coreografar múltiplos elementos juntos (ex.: um "highlight reveal" na tela da Partida com vários elementos entrando em sequência) |
| **anime.js** | ~17KB | Leve, API simples, bom p/ animações pontuais isoladas | Casos simples e independentes — um ícone pulsando, um número contando |

**Recomendação:** não adotar as três — **escolher uma** e usar com moderação, só onde
já existe uma necessidade real de polish, não animação "por padrão". Dado que o
Resenha é React puro (sem Framer Motion hoje) e a maioria dos casos de uso prováveis
são de componentes React (entrada de cards, modais de granadas, transição do
placar) — **Motion é o encaixe mais natural** (API pensada pra React, bundle pequeno).

**Onde aplicar, concretamente (exemplos, não backlog fechado):**
- Cards do Feed/Ranking com stagger sutil ao carregar (Motion `staggerChildren`).
- Reveal do MVP/highlight na tela da Partida ao trocar de round na timeline.
- Modais de granadas (`Granadas.jsx`) com transição de entrada/saída em vez de aparecer/sumir abrupto.
- Barra de progresso do upload de demo com easing em vez de jump discreto.

Isso é trabalho de **UI/design**, não arquitetura — não precisa de spec própria;
dá pra tratar como polish incremental quando alguém mexer numa tela específica
(ou como uma sessão dedicada com a skill `impeccable`, se quiser um passe de design
mais amplo em uma tela por vez).

## Performance/escalabilidade — avaliação

**Não há gargalo real hoje.** Pontos que já são bons: paginação no feed, sem N+1,
queries paralelas no detalhe da partida, bundle pequeno, mobile responsivo. Pro
tamanho do grupo (~10-15 usuários, um punhado de partidas por dia), a infra atual
(Vercel serverless + Supabase Postgres) tem folga enorme.

**Único ponto real de atenção, achado nesta análise:** o **JSON de replay não usa
streaming por round** — o client baixa a partida inteira (potencialmente vários MB)
antes de poder tocar o primeiro round. Num celular com conexão ruim (o caso de uso
mais citado no `PRODUCT.md` — "no celular, logo depois de sair de um jogo"), isso
pode significar um espera perceptível antes do Replay 2D abrir. Melhoria futura de
baixo risco: paginar o replay por round (buscar sob demanda conforme o usuário troca
de round), ou pelo menos mostrar o primeiro round assim que ele chegar em vez de
esperar o payload completo. Não é urgente — só vale a pena se aparecer reclamação
real de lentidão no Replay 2D em mobile.

**Não recomendo nenhuma mudança de arquitetura de escalabilidade agora** (ex.: cache,
CDN adicional, mudança de banco) — seria otimização prematura pro volume atual do
grupo. Revisar de novo se o grupo crescer significativamente (dezenas de usuários
ativos simultâneos) ou se a integração de clipes do ADR-0004 avançar (aí sim, o
volume de chamadas de API e clipes exibidos justifica reavaliar).

## Resumo de recomendações

1. **Não adotar three.js agora** — é a técnica certa só como plano B do ADR-0004 (Replay 3D), não pro Replay 2D atual.
2. **Adotar Motion** pra polish pontual de UI (cards, modais, reveals) — pequeno, encaixa no stack React, sem sessão de planejamento própria necessária.
3. **Performance está boa** pro tamanho atual — não investir em infra agora.
4. **Único débito real encontrado:** replay sem streaming por round — registrar no roadmap como item de baixa prioridade, não agir agora.
5. **Mobile: nada pendente** — já foi feito.
6. **Novas funcionalidades:** usar `docs/ROADMAP.md` (Fases A-E) como fonte — já é abrangente e priorizado.
