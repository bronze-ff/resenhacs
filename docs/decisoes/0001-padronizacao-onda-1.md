# 0001. Padronização da onda 1

**Data:** 2026-10-12. **Status:** aceita.

## Contexto

O repositório tinha README longo, regras de agente só no `CLAUDE.md`, docs de produto na raiz e CI separado por pasta (`site.yml` e `coletor.yml`), sem um `verify` único nem observabilidade. O plano de padronização trata este repo como risco alto para rename (`site/client` e `site/server` são Root Directory na Vercel; o Coletor e o R2 têm workflow próprio). A onda 1 é só docs, limpeza, CI e observabilidade.

## Decisão

- Não renomear pastas e não mudar o Root Directory dos projetos Vercel `resenha` (`site/client`) e `resenhacs` (`site/server`).
- `AGENTS.md` é a fonte única de regras. `CLAUDE.md` contém só `@AGENTS.md`.
- `CONTEXT.md`, `PRODUCT.md` e `DESIGN.md` saem da raiz e vão para `docs/produto/`. ADRs antigos permanecem em `docs/adr/`. Decisões novas, começando por esta, ficam em `docs/decisoes/`.
- Issues passam a ser GitHub Issues deste repositório. `FIL-xxx` no código é id histórico do Linear e não vira `#n` sem uma tabela de mapeamento.
- CI rápido em `.github/workflows/ci.yml`: um job, actions por SHA, gitleaks só nos commits do PR, `npm run verify` em todo PR. PR só de docs roda o verify inteiro. Não há merge automático. `coletor.yml`, `site.yml` e `r2-replays.yml` continuam.
- Sentry com o SDK de cada parte (`@sentry/react`, `@sentry/node`, `sentry-sdk`), DSN só por ambiente, no-op sem DSN. Minimização por allowlist desde o início: sem header, cookie, body e query; URL só origem + caminho; tracing desligado e `beforeSendSpan` limpando URL; palavra sensível redige a string inteira e não altera campo de transporte do SDK.
- PostHog só no client. Sem chave, no-op. Com chave, contagem sem cookie; `identify` apenas com `steamId` quando há Jogador logado. URL do evento fica só com origem e caminho. A isenção de transporte vale só no topo do evento (`token`, `distinct_id`, `$session_id`, `$window_id`, `$device_id`, `$insert_id`, `$time`, `$lib`, `$lib_version`, `uuid`). Qualquer outra string com e-mail, CPF, CNPJ, telefone, placa ou `token`/`senha` é redigida por inteiro. `before_send` também apaga atribuição (`$utm_*`, `utm_*`, `$initial_utm_*`, click id, `$session_entry_*`, referrer inicial e `$referring_domain`), inclusive a cópia em `$set` e `$set_once`.
- Source map do client sobe só no build da Vercel. O CI não recebe `SENTRY_AUTH_TOKEN`.
- O cache `.claude/homunculus/` sai do git. Skills em `.claude/skills` e `.agents/skills` ficam.

## Consequências

- O deploy atual não muda de pasta. Quem for renomear para `apps/` tem que trocar o Root Directory no mesmo momento do merge.
- Três projetos Sentry (`resenhacs-web`, `resenhacs-api`, `resenhacs-coletor`) e um PostHog (`resenhacs`, EU) precisam ser criados no painel. Até lá o código não envia nada.
- O cron do Coletor só faz check-in no Sentry depois que o secret `SENTRY_DSN` existir. Sem o secret, o job se comporta como antes.
- `npm run verify` não inclui lint: o repositório não tem ESLint nem TypeScript.
