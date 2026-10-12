# AGENTS.md

Regras para Codex, Cursor e Claude neste repositório. Este arquivo é a fonte única. `CLAUDE.md` só aponta para cá.

## Comandos

Na raiz, com dependências já instaladas:

```powershell
npm run verify
```

`verify` é obrigatório antes de abrir PR. Ele roda, nesta ordem: `npm test` e `npm run build` em `site/client`, `npm test` em `site/server`, `python -m pytest -q` em `coletor/`. Trecho só:

```powershell
node scripts/verify.mjs client
node scripts/verify.mjs server
node scripts/verify.mjs coletor
node scripts/verify.mjs bot
```

Não há ESLint nem `tsc` neste repositório. O gate é o `verify`.

Dev, um comando por linha no PowerShell 5.1:

```powershell
cd site/server
npm install
npm run dev
```

```powershell
cd site/client
npm install
npm run dev
```

Coletor: `python -m pytest -q` dentro de `coletor/`. Os testes colocam `src` no `sys.path`.

## Estrutura e onde mexer

| Pasta | Mexa quando |
|---|---|
| `site/client` | Tela, rota, Replay 2D, UI |
| `site/server` | Regra HTTP, sessão, Postgres, R2 |
| `coletor/` | Descoberta, parse de Demo, FACEIT, retenção no R2 |
| `bot/` | Game Coordinator (Share Code → URL do .dem) |
| `supabase/migrations` | Só migration **nova**. Não edite as já aplicadas |
| `docs/` | Comportamento, operação, ADR |

Não renomeie `site/client` nem `site/server`. O Root Directory dos projetos Vercel `resenha` e `resenhacs` aponta para essas pastas. Renomear derruba o deploy.

Glossário: [docs/produto/CONTEXT.md](docs/produto/CONTEXT.md). Use Jogador, Partida, Highlight, Clipe, Replay 2D, Demo, Share Code, Coletor. Não use os sinônimos marcados como Avoid.

## Não faça

- Commitar `.env`, `.env.*` (exceto `.env.example`) ou `.mcp.json`.
- Colocar DSN, token ou chave no código ou no README.
- Renomear pastas ou mudar Root Directory / `vercel.json` / `site/client/middleware.js` sem pedido explícito.
- Editar `supabase/migrations` já aplicada.
- Mudar cron, secrets ou comandos de `.github/workflows/coletor.yml` e `r2-replays.yml` de um jeito que o job agendado deixe de rodar. Variável nova no `env` do job, com no-op se estiver vazia, pode.
- Comentar `@codex review` num PR. O Codex ignora `cursor[bot]`; quem pede o review é o Filippe, quando o PR estiver estável.
- Mergear. O merge é humano, com review limpa e CI verde.
- Abrir issue no Linear ou usar `FIL-xxx` em branch, PR ou doc novo. Issues são GitHub Issues deste repo (`Fixes #n`). `FIL-xxx` que já está no código é id antigo; não traduzir para `#n` sem mapa.

Fluxo de branch e worktree: [docs/WORKFLOW.md](docs/WORKFLOW.md).

## Code Review Rules

O Codex Review barra o PR se encontrar isto.

**P0**

- Segredo, DSN ou chave de PostHog no repositório.
- Evento de Sentry ou PostHog com header, cookie, body, query, senha, token, CPF, CNPJ, telefone, e-mail ou placa. A string inteira que contém a palavra sensível sai; campo de transporte do SDK (`event_id`, `sdk`, `span_id`, `trace_id`) não é reescrito.
- `identify` do PostHog com nick, avatar, e-mail ou Faceit. Só `steamId`.
- SQL montado com interpolação de input, ou rota autenticada sem `requireAuth`.
- Migration já aplicada alterada.
- Rename de `site/client` / `site/server`, ou mudança de Root Directory.
- Quebra do cron do Coletor ou do workflow manual do R2 (comando, path, concurrency da conta-bot).

**P1**

- PR sem `npm run verify` passando no CI.
- Variável nova sem linha no `.env.example` do app que a lê.
- Action do GitHub por tag mutável (`@v4`). SHA fixo.
- DSN lido por `import.meta.env[nome]` ou `process.env[nome]`. Acesso estático.
- SDK de observabilidade inicializado sem DSN (o build e o dev têm que subir sem secret).
- Issue ou doc novo apontando para Linear.

## Observabilidade

Três projetos Sentry, um por parte que sobe sozinha. DSN só por variável de ambiente. Sem DSN o SDK não inicia.

| Parte | SDK | Variável | Projeto Sentry | Onde |
|---|---|---|---|---|
| `site/client` | `@sentry/react` | `VITE_SENTRY_DSN` | `resenhacs-web` | Vercel `resenha` |
| `site/server` | `@sentry/node` | `SENTRY_DSN` | `resenhacs-api` | Vercel `resenhacs` |
| `coletor/` | `sentry-sdk` + Crons | `SENTRY_DSN` | `resenhacs-coletor` | Secret do GitHub |

PostHog só no client, projeto `resenhacs` (host `https://eu.i.posthog.com`). Sem `VITE_POSTHOG_KEY` não há cookie. Com a chave: contagem sem cookie (`persistence: 'memory'`). `identify` só depois do login, e só com o `steamId` (é a chave de `players`). `person_profiles: 'identified_only'`. Sem session replay. Sem nick, avatar ou e-mail.

Tracing do Sentry fica em `tracesSampleRate: 0`. `beforeSendSpan` ainda limpa URL (só origem + caminho) se um span existir. Replay do Sentry desligado.

Source map do client sobe no build da Vercel só se `SENTRY_AUTH_TOKEN` e `SENTRY_ORG` existirem. O CI não recebe esse token. Sem os dois, o build passa e não gera `.map`.

Nunca logar dado pessoal. O scrub está em `site/client/src/observabilidade/scrub.js`, `site/server/src/observabilidade/scrub.js` e `coletor/src/coletor/observabilidade.py`. Detalhe operacional em [docs/operacao.md](docs/operacao.md).

## Revisão

Todo PR passa por Codex Review. Só mergeia com review limpa e CI verde (`ci`, e os workflows que a PR disparar: `Site`, `Coletor`). Não peça o review por comentário se quem abriu o PR foi um agente Cursor.
