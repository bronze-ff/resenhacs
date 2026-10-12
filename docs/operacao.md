# Operação

## Deploy

Dois projetos Vercel no time do Filippe. Não mudar o Root Directory nesta onda.

| Projeto Vercel | Root Directory | O que publica | Domínio de produção |
|---|---|---|---|
| `resenha` | `site/client` | SPA Vite | `https://resenha-phi.vercel.app` |
| `resenhacs` | `site/server` | API Express (`api/index.js`, rewrite `/(.*)` → `/api`) | `https://resenhacs.vercel.app` |

O client faz proxy de `/api/*` para `https://resenhacs.vercel.app` em produção (`PRODUCTION_API_URL` em `site/client/middleware.js`). Preview e Development só chamam a API se `PREVIEW_API_URL` existir no projeto `resenha`. Sem ela, o middleware responde 503.

`APP_URL` no projeto `resenhacs` tem que ser a origem do client (`https://resenha-phi.vercel.app`). A Steam recusa o login se o `return_to` não bater.

Coletor e backfill de replay: workflows `Coletor` e `R2 replays`. O cron do Coletor é a cada 10 minutos. Não há servidor próprio.

Node na Vercel está em 24.x. O CI usa Node 22 (`.nvmrc`) e Python 3.12 (`.python-version`), o mesmo par dos workflows atuais. Esta onda não altera a versão da Vercel.

## Variáveis novas

Crie os projetos no Sentry e no PostHog antes de preencher. Sem as variáveis, o site, a API e o Coletor sobem e simplesmente não enviam evento.

| Variável | Onde | Projeto |
|---|---|---|
| `VITE_SENTRY_DSN` | Vercel `resenha` (Production e Preview) | Sentry `resenhacs-web` |
| `VITE_SENTRY_ENVIRONMENT` | Opcional no mesmo projeto. O build preenche por `VERCEL_ENV` se estiver vazia | — |
| `VITE_SENTRY_RELEASE` | Opcional. O build usa `VERCEL_GIT_COMMIT_SHA` se estiver vazia | — |
| `VITE_POSTHOG_KEY` | Vercel `resenha` | PostHog `resenhacs`, host EU |
| `VITE_POSTHOG_HOST` | Vercel `resenha`. Valor: `https://eu.i.posthog.com` | o mesmo projeto PostHog |
| `SENTRY_AUTH_TOKEN` | Vercel `resenha` (build). Não entra no CI | org do Sentry, projeto `resenhacs-web` |
| `SENTRY_ORG` | Vercel `resenha` (build), ao lado do token | slug da organização Sentry |
| `SENTRY_PROJECT` | Vercel `resenha` (build). Valor: `resenhacs-web` | Sentry `resenhacs-web` |
| `SENTRY_DSN` | Vercel `resenhacs` | Sentry `resenhacs-api` |
| `SENTRY_ENVIRONMENT` | Opcional na Vercel `resenhacs`. Se vazia, `VERCEL_ENV` vira `producao` ou `homologacao` | — |
| `SENTRY_DSN` | Secret do repositório GitHub `bronze-ff/resenhacs` | Sentry `resenhacs-coletor` |
| `SENTRY_ENVIRONMENT` | Não é secret. O job `sincroniza` do `coletor.yml` e o job do `r2-replays.yml` definem `producao` | — |
| `SENTRY_RELEASE` | Opcional no ambiente do Coletor. Se vazia, o SDK usa `GITHUB_SHA` no Actions | Sentry `resenhacs-coletor` |

O DSN do Coletor e o da API são secrets diferentes: cada um aponta para o projeto Sentry da sua parte. Não reutilize o DSN do browser no servidor.

Source map: o upload é só no build da Vercel (`resenha`). O CI, inclusive `pull_request`, não recebe `SENTRY_AUTH_TOKEN`. O plugin do Vite só roda se `SENTRY_AUTH_TOKEN` e `SENTRY_ORG` existirem juntos. Faltando um dos dois, o build segue e não publica `.map`. A API é JavaScript sem bundle; o stack já tem linha, não há upload.

No PostHog, o `before_send` apaga atribuição de campanha: chave que começa com `$utm_`, `utm_` ou `$initial_utm_`, `$session_entry_*`, `$gclid`/`gclid`, `$fbclid`/`fbclid`, `$msclkid`/`msclkid`, `$initial_referrer`, `$initial_referring_domain` e `$referring_domain`. O mesmo vale para a cópia em `$set` e `$set_once`, que saem por inteiro. Fora uma lista fechada no topo do evento (`distinct_id`, `$session_id`, `$window_id`, `$device_id`, `$insert_id`, `$time`, `$lib`, `$lib_version`, `uuid`), qualquer string com e-mail, CPF, CNPJ, telefone, placa ou `token`/`senha` é redigida por inteiro. O `token` do topo só fica se for exatamente `VITE_POSTHOG_KEY`. Qualquer outro valor, inclusive `token` aninhado, passa pela limpeza.

No painel do Sentry, em cada projeto: Data Scrubber ligado, Scrub IP addresses ligado, e regras de scrub para CPF, CNPJ, telefone, e-mail e placa. No PostHog: Discard client IP data ligado. Isso é proteção extra; o SDK já não manda header, cookie, body nem query.

## O que já existia

API (`resenhacs`): `DATABASE_URL` (pooler, porta 6543 na Vercel), `STEAM_API_KEY`, `JWT_SECRET`, `APP_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `FACEIT_CLIENT_ID`, `FACEIT_CLIENT_SECRET`, `ALLSTAR_API_KEY`, `ALLSTAR_STEAM_IDS`, `ALLSTAR_WEBHOOK_AUTH`.

Client (`resenha`): `PREVIEW_API_URL` só em Preview/Development, se houver API de staging.

GitHub Actions (Coletor): `DATABASE_URL`, `STEAM_API_KEY`, `STEAM_BOT_USER`, `STEAM_BOT_PASS`, `R2_*`, `FACEIT_API_KEY`, `APP_URL`.

Lista completa de exemplo: `site/server/.env.example`, `site/client/.env.example`, `coletor/.env.example`.

## Logs

- API e client: runtime logs do projeto correspondente na Vercel. O error handler da API responde `{ erro: "Erro interno" }` e manda o erro ao Sentry, se houver DSN.
- Coletor: log do workflow `Coletor` no GitHub. Falha não tratada vai ao Sentry `resenhacs-coletor`. O monitor `resenhacs-coletor` (crontab `*/10 * * * *`, margem de 10 minutos) avisa se o `discover` de produção não faz check-in. O check-in só acontece com DSN e `SENTRY_ENVIRONMENT=producao` dentro do Actions.
- R2 replays: log do workflow manual. O mesmo DSN do Coletor, se o secret existir.

Erro de Sentry não é lugar de guardar dado pessoal. O scrub redige a string inteira quando ela contém `senha`, `token`, `authorization`, `cookie`, CPF, CNPJ, telefone (fixo ou celular, com ou sem `+55`), e-mail ou placa. A marca `resenha` não conta como `senha`. `access_token` conta. URL (absoluta ou caminho relativo) fica só com origem e caminho, e essa limpeza acontece antes da regra da palavra. Campos de transporte do SDK não são reescritos. A regex de placa antiga também casa com códigos no formato `ADR-0006`.

## Rollback

Vercel: no projeto afetado, Promote do deployment anterior. O client e a API são independentes; voltar um não volta o outro.

Coletor: o cron usa o que está em `main`. Reverter é reverter o commit em `main`. Uma run no meio não é cancelada (`cancel-in-progress: false` no grupo `coletor`) para não derrubar a sessão da conta-bot.

Demo no R2: a limpeza apaga o `.dem` bruto com mais de 14 dias e mantém `replay.json`. Não há restore automático. O workflow de gzip não apaga objeto; o dry-run é o padrão.

## CI

`.github/workflows/ci.yml` é o gate rápido: gitleaks só no intervalo de commits do PR, `npm run verify` em todo PR (se a mudança não toca client, API, Coletor nem bot, roda o verify inteiro), osv se o lockfile mudou, zizmor se `.github/` mudou. Actions pinadas por SHA. Não há merge automático. Os workflows `Coletor`, `Site` e `R2 replays` continuam. `Site` ainda roda os testes de client e server quando `site/**` muda.

Issues: GitHub Issues deste repositório. Templates em `.github/ISSUE_TEMPLATE/`.
