# Resenha — Brief do produto

> Decisões da sessão de grilling de 2026-07-09. Termos em negrito estão definidos no [CONTEXT.md](../CONTEXT.md); decisões arquiteturais têm ADR em [docs/adr/](./adr/).

## O que é

Plataforma web fechada, em PT-BR, para um grupo de amigos acompanhar **Partidas**, estatísticas e **Highlights** de CS2. Inspirações: Leetify (stats), Scope.gg (replay 2D / densidade de dados), Allstar.gg (clipes).

## Decisões firmadas

| Tema | Decisão |
|---|---|
| Público | Grupo fechado de amigos (whitelist de Steam IDs) |
| Acesso | Login via Steam (OpenID); só **Jogadores** whitelistados entram |
| Fonte de dados (MVP) | Matchmaking/Premier da Valve via **Share Codes** + Steam API; Faceit/Gamers Club depois, começando por upload manual de .dem |
| Vídeo | A plataforma **não renderiza vídeo**; **Clipes** são links externos (Allstar/Medal/YouTube) anexados por Jogadores |
| Coletor | Python (demoparser2) em GitHub Actions cron, de hora em hora — ADR-0001 |
| Retenção | Todo Demo é arquivado comprimido no Cloudflare R2 — ADR-0002 |
| Site | React + Vite + Tailwind (SPA) servido por Express; hospedagem Railway/Render/Fly |
| Banco | Postgres gerenciado (Supabase) |
| Privacidade | **Participantes** não-Jogadores aparecem só no placar da Partida, sem perfil |
| Design | Delegado ao [taste-skill](https://github.com/Leonxlnx/taste-skill) com Leetify/Scope/Allstar como referências |
| Idioma | PT-BR (jargão de CS mantido em inglês) |

## Escopo da v1 (decisão do dono: inclui Replay 2D)

1. Login Steam + whitelist + onboarding do Jogador (auth code de histórico + último share code)
2. Coletor: descoberta de partidas novas → download do demo → parsing → banco + R2
3. Feed de partidas do grupo
4. Página da **Partida**: placar dos 10 **Participantes**, timeline de rounds, **Momentos Notáveis** (ace, clutch, multi-kill)
5. **Replay 2D** completo da partida (mapa top-down, playback dos rounds)
6. Perfil do **Jogador**: stats essenciais (K/D, ADR, HS%, rating, por mapa)
7. Anexar **Clipes** a Highlights
8. **Sinergia**: com quais teammates cada Jogador mais joga e a winrate de cada dupla

*Risco assumido: o Replay 2D é a peça mais cara da v1 e adia o primeiro release.*

## Fases de implementação da v1 — TODAS CONSTRUÍDAS (2026-07-10)

Cada fase entregue com testes e commit próprio (67 testes ao todo: 43 server, 5 client, 19 coletor):

1. ✅ **Fundação** — repo, site (Express + React/Vite/Tailwind), schema no Supabase (aplicado), login Steam com anti-replay + whitelist, onboarding, shell da UI
2. ✅ **Coletor** — Python: decode de share code, corrente via Steam Web API, transformações (K/D, rating, highlights), escritor idempotente, upload R2, GitHub Actions cron. *Download de demo de MM adiado (ADR-0003); caminho `ingest` manual funciona.*
3. ✅ **Telas de stats** — feed, página da Partida (scoreboard + rounds + highlights + clipes), perfil do Jogador, **Sinergia** ("com quem mais joga" + winrate), anexar Clipes. Data layer verificado contra o Postgres real.
4. ✅ **Replay 2D** — normalização mundo→radar (8 mapas calibrados) + engine de playback (canvas, play/pause/scrub/round/velocidade), verificada visualmente em `/replay-demo`. *Extração de posições precisa de .dem real; radares PNG a cargo do usuário.*

### Pendências externas (só o usuário provê)
- **Segredos**: senha do banco (Session Pooler, IPv4), Steam Web API key, seu SteamID64 (para `seed-admin.js`).
- **Cloudflare R2**: criar bucket + credenciais (ajuda guiada pendente) — necessário para arquivar demos e servir replays.
- **Push do repo no GitHub** + configurar os Secrets do Actions (DATABASE_URL, STEAM_API_KEY, R2_*).
- **Assets**: PNGs de radar dos mapas em `site/client/public/radars/` (opcional; sem eles a engine usa grade).
- **Fase 2b**: conta-bot Steam (Game Coordinator) para baixar demos de MM automaticamente.

## Roadmap pós-v1 (ordem acordada)

1. Evolução temporal + comparação entre Jogadores + rankings internos do grupo
2. Upload manual de .dem (Faceit / Gamers Club)
3. Análise estilo Leetify (aim, utility, trades, entries, clutches) — retroativa graças ao ADR-0002
4. Análise tática estilo Scope (heatmaps, granadas)
5. (Distante/incerto) Renderização local de clipes no PC do Jogador, estilo CS Demo Manager
