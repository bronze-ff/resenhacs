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

## Fases de implementação da v1

Cada fase é um plano próprio em `docs/superpowers/plans/` e termina com software funcionando:

1. **Fundação** — repo, site (Express + React/Vite/Tailwind), schema no Supabase, login Steam + whitelist, shell da UI
2. **Coletor** — Python + demoparser2, corrente de share codes, download antes de expirar, parsing de stats essenciais + Momentos Notáveis, arquivamento no R2, GitHub Actions cron
3. **Telas de stats** — feed de partidas, página da Partida, perfil do Jogador, Sinergia, anexar Clipes, design via taste-skill, deploy público
4. **Replay 2D** — extração de frames posicionais no Coletor, radars dos mapas, engine de playback

## Roadmap pós-v1 (ordem acordada)

1. Evolução temporal + comparação entre Jogadores + rankings internos do grupo
2. Upload manual de .dem (Faceit / Gamers Club)
3. Análise estilo Leetify (aim, utility, trades, entries, clutches) — retroativa graças ao ADR-0002
4. Análise tática estilo Scope (heatmaps, granadas)
5. (Distante/incerto) Renderização local de clipes no PC do Jogador, estilo CS Demo Manager
