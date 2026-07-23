<div align="center">

<img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=700&size=26&duration=3000&pause=1000&color=E4E4E4&center=true&vCenter=true&width=700&height=50&lines=RESENHA.;Stats+%2B+Replay+2D+%2B+T%C3%A1ticas+de+CS2;do+grupo%2C+pro+grupo;while(alive)+%7B+play();+analyze();+%7D" alt="Resenha" />

<br>

![CS2](https://img.shields.io/badge/COUNTER--STRIKE_2-0d1117?style=for-the-badge&logo=counter-strike&logoColor=F79100)
![Status](https://img.shields.io/badge/EM_PRODU%C3%87%C3%83O-0d1117?style=for-the-badge&labelColor=0d1117&color=1a1a2e)
![License](https://img.shields.io/badge/USO_PESSOAL-0d1117?style=for-the-badge&labelColor=0d1117&color=1a1a2e)

</div>

<br>

<h2 align="center">⌜ O que é ⌟</h2>

**Resenha** é uma plataforma de estatísticas de Counter-Strike 2 feita pra um grupo fechado de amigos — tipo um Leetify caseiro, só que nosso. Cada partida que a galera joga é descoberta automaticamente, a demo é baixada, parseada e vira scoreboard completo, replay 2D, highlights, ranking e análise de economia. Sem instalar nada: logou com a Steam, cadastrou os códigos, jogou — apareceu.

- 🎯 **Ingestão automática** — bot Steam resolve os share codes via Game Coordinator e baixa as demos da Valve
- 📊 **Stats estilo Leetify** — rating, ADR, KAST, entry/trade/clutch, precisão, utilitária, economia por round
- 🗺️ **Replay 2D** — a partida inteira desenhada no radar do mapa, round a round, em canvas
- 🏆 **Ranking do grupo + ranking público** — quem é o craque e quem é o bagre, com provas
- 🎬 **Highlights e clipes** — aces e clutches detectados no parse, com link direto pro momento no replay
- 🧨 **Granadas e táticas** — lineups de smoke/flash/molotov e táticas curadas por mapa
- ⚔️ **Head-to-head** — comparação direta entre dois jogadores, mesmo time ou rivais
- 🎓 **Curso de mira** — player de vídeo interno com progresso por aula
- 🇧🇷 100% em português, mobile-first

<br>

<h2 align="center">⌜ Como funciona ⌟</h2>

```
 Steam GC ──▶ Coletor (GitHub Actions, de hora em hora)
                │  descobre share codes ▸ baixa .dem ▸ parseia (demoparser2)
                ▼
            Supabase (Postgres) ◀── API Express (Vercel serverless)
                │                        ▲
            Cloudflare R2                │  React + Vite + Tailwind (Vercel)
            (demos + replays + vídeos)   └── login Steam OpenID + FACEIT OAuth
```

O **Coletor** roda em GitHub Actions: um bot Steam pega os links das demos no Game Coordinator, baixa, parseia com `demoparser2` e grava tudo no Postgres — stats por jogador, posições de kill, economia por round e o JSON do replay 2D (arquivado no R2). O **site** lê esse banco: grupos isolados, partidas visíveis por participação, e perfil público opcional pra comparar K/D entre grupos.

<br>

<h2 align="center">⌜ ⛧ Stack ⛧ ⌟</h2>

<div align="center">

![Stack](https://skillicons.dev/icons?i=react,vite,tailwind,nodejs,express,postgres,supabase,py,cloudflare,githubactions,vercel,git&theme=dark&perline=6)

<br>

![demoparser2](https://img.shields.io/badge/demoparser2-0d1117?style=for-the-badge&logo=python&logoColor=3776AB)
![steam-user](https://img.shields.io/badge/steam--user_(bot_GC)-0d1117?style=for-the-badge&logo=steam&logoColor=white)
![R2](https://img.shields.io/badge/Cloudflare_R2-0d1117?style=for-the-badge&logo=cloudflare&logoColor=F38020)
![FACEIT](https://img.shields.io/badge/FACEIT_API-0d1117?style=for-the-badge&logoColor=FF5500)

</div>

<br>

<h2 align="center">⌜ Estrutura ⌟</h2>

| Pasta | O que é |
|---|---|
| `site/client` | SPA React + Vite + Tailwind — feed, partida, replay 2D, perfil, ranking, granadas, táticas |
| `site/server` | API Express (serverless na Vercel) — auth Steam/FACEIT, JWT, isolamento por grupo |
| `coletor/` | Python — descoberta, download, parse de demos e sincronização FACEIT |
| `bot/` | Node — bot Steam que resolve share codes no Game Coordinator |
| `supabase/migrations` | Schema versionado do Postgres (contrato entre Coletor e site) |
| `docs/` | Briefs, specs e planos de implementação |

<br>

<h2 align="center">⌜ Rodar em dev ⌟</h2>

<details>
<summary><b>Setup local (PowerShell)</b></summary>

> Um comando por linha — o `&&` não é separador válido no Windows PowerShell 5.1.

1. Preparar o server:
   ```powershell
   cd site/server
   npm install
   copy .env.example .env   # depois preencha o .env
   ```
2. Aplique as migrations de `supabase/migrations/` no projeto Supabase (SQL Editor, em ordem)
3. `node --env-file-if-exists=.env scripts/seed-admin.js <seu SteamID64>`
4. `npm run dev` (API em http://localhost:3001)
5. Em outro terminal:
   ```powershell
   cd site/client
   npm install
   npm run dev   # http://localhost:5173
   ```

**Testes:** `npm test` dentro de `site/server` e de `site/client`; `python -m pytest` dentro de `coletor/`.

</details>

<details>
<summary><b>Deploy na Vercel (2 projetos)</b></summary>

O `site/client` é um site estático (Vite build) e o `site/server` é uma API Express — como a Vercel roda em funções serverless, cada um vira um **projeto Vercel separado**, com o client fazendo proxy de `/api/*` pro domínio da API (mantém tudo same-origin, então o cookie de sessão funciona sem CORS).

**Projeto 1 — API** (`site/server/api/index.js` é o entrypoint serverless; o `vercel.json` já faz o rewrite `/(.*)` → `/api`):
1. Importar do GitHub → Root Directory: `site/server`
2. Environment Variables: `DATABASE_URL` (use o **Transaction Pooler** do Supabase, porta 6543 — recomendado pra serverless), `STEAM_API_KEY`, `JWT_SECRET`, `APP_URL` (o domínio do projeto **client** — é ele que a Steam usa pra validar o `return_to` do login), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
3. Deploy. Anote o domínio gerado.

**Projeto 2 — Client**:
1. Importar do GitHub → Root Directory: `site/client`
2. O proxy de `/api/*` pro domínio da API é feito em `site/client/middleware.js` (Vercel
   Routing Middleware, não `vercel.json` — assim o destino pode variar por ambiente em vez
   de ficar hardcoded). Se o domínio de produção da API mudar, atualize a constante
   `PRODUCTION_API_URL` nesse arquivo.
3. Deploy.

**Importante**: depois do primeiro deploy do client, volte no projeto da API e confirme que `APP_URL` bate com o domínio final do client (o login da Steam falha silenciosamente se não bater).

**Preview Deployments do client**: por padrão, Preview e Development **não** falam com a API
de produção (o `middleware.js` bloqueia com 503) — isso evita que todo PR/branch de teste
acabe lendo/gravando no banco real. Se você tiver um backend de staging, configure a
Environment Variable `PREVIEW_API_URL` no projeto do client na Vercel (Project Settings →
Environment Variables, escopo Preview/Development) apontando pra ele.

**Coletor (GitHub Actions):** configure os Secrets do repositório — `DATABASE_URL`, `STEAM_API_KEY`, `STEAM_BOT_USER`, `STEAM_BOT_PASS`, `R2_*`, `FACEIT_API_KEY` — e o workflow `.github/workflows/coletor.yml` roda sozinho de hora em hora.

</details>

<br>

<h2 align="center">⌜ Docs ⌟</h2>

Domínio e decisões em [CONTEXT.md](CONTEXT.md) · [docs/BRIEF.md](docs/BRIEF.md) · [PRODUCT.md](PRODUCT.md) · [DESIGN.md](DESIGN.md) — specs e planos de cada feature em [docs/superpowers/](docs/superpowers/).

<br>

<div align="center">

---

**Feito com ☕ por [@bronze-ff](https://github.com/bronze-ff)** — pro grupo, com carinho e muito friendly fire.

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d1117,100:1a1a2e&height=120&section=footer" width="100%" />

</div>
