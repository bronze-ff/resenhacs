# Arquitetura

```
Steam GC ──▶ bot/ (Node, subprocesso)
                │
                ▼
GitHub Actions ──▶ coletor/ (Python, demoparser2)
                │  discover · fetch · cleanup · FACEIT · uploads
                ▼
        Supabase Postgres  ◀──  site/server (Express, Vercel resenhacs)
                │                      ▲
        Cloudflare R2                  │  cookie de sessão
        demos, replays, curso          │
                ▲                      │
                └──── site/client (Vite, Vercel resenha)
                      middleware /api/*  →  https://resenhacs.vercel.app
```

O contrato entre o Coletor e o site é o schema em `supabase/migrations`, não um pacote compartilhado. Decisão original: [adr/0001-coletor-python-github-actions.md](adr/0001-coletor-python-github-actions.md).

## Pastas

| Pasta | Runtime | Deploy |
|---|---|---|
| `site/client` | React 19, Vite, Tailwind | Vercel `resenha`, Root Directory `site/client` |
| `site/server` | Express 5, `pg`, função única em `api/index.js` | Vercel `resenhacs`, Root Directory `site/server` |
| `coletor/` | Python 3.12 | GitHub Actions, workflow `Coletor` |
| `bot/` | Node, `steam-user` | Não tem deploy próprio; o Coletor chama `node src/resolve.js` |
| `supabase/migrations` | SQL | Aplicado no projeto Supabase, em ordem |

Esta onda não move essas pastas. O layout `apps/` + `packages/` fica para uma decisão futura, no mesmo momento em que o Root Directory da Vercel for trocado.

## Request do site

O browser fala só com a origem do client. `site/client/middleware.js` reescreve `/api/*` para a API de produção quando `VERCEL_ENV=production`. Preview sem `PREVIEW_API_URL` responde 503, de propósito, para não gravar no banco real.

A API confia em um hop de proxy (`trust proxy` = 1), lê o JWT do cookie e isola por Jogador. O bucket R2 é privado: o server assina ou faz proxy. A URL crua do R2 não vai para o client.

## Coletor

O cron é `*/10 * * * *` em `.github/workflows/coletor.yml`. Um job só (`sincroniza`) descobre, baixa, limpa Demo com mais de 14 dias ([adr/0006](adr/0006-retencao-demos-14-dias.md)), processa fila pro, uploads e FACEIT. A conta-bot só aguenta uma sessão CS2: o `concurrency` do workflow serializa produção e não cancela a run no meio. PR não recebe os secrets; só roda pytest.

O workflow `R2 replays` é manual (`workflow_dispatch`): inventário ou backfill gzip. Não entra na fila do Coletor.

## Observabilidade

Erros do browser, da API e do Coletor vão para projetos Sentry separados. O DSN vem de variável de ambiente. O evento final só conserva a allowlist do topo (cada valor passa pelo scrub; `logger`, `profile` e `debug_meta` saem). O scrub tira header, cookie, body e query, reduz URL a origem + caminho e redige a string inteira se a chave ou o valor tiver palavra sensível ou PII. Tracing desligado (`tracesSampleRate` 0) com `beforeSendSpan` de reserva. O cron `discover` faz check-in no monitor `resenhacs-coletor` só quando o Actions está em produção e o DSN existe.

PostHog fica no client: sem chave, no-op; com chave, contagem sem cookie e `identify` só pelo `steamId` depois do login.

## Decisões

As decisões anteriores a outubro de 2026 estão em [adr/](adr/). As novas ficam em [decisoes/](decisoes/).
