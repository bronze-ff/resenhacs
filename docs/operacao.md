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

No PostHog, o `before_send` apaga atribuição de campanha: chave que começa com `$utm_`, `utm_` ou `$initial_utm_`, `$session_entry_*`, `$gclid`/`gclid`, `$fbclid`/`fbclid`, `$msclkid`/`msclkid`, `$initial_referrer`, `$initial_referring_domain` e `$referring_domain`. O mesmo vale para a cópia em `$set` e `$set_once`, que saem por inteiro. Fora uma lista fechada no topo do evento (`distinct_id`, `$session_id`, `$window_id`, `$device_id`, `$insert_id`, `$time`, `$lib`, `$lib_version`, `uuid`), qualquer string com e-mail, CPF, CNPJ, telefone, placa ou palavra sensível é redigida por inteiro. A lista é a mesma do Sentry (`palavras.js`): `password`, `passwd`, `pwd`, `secret`, `api_key`/`apikey`, `authorization`, `bearer`, `cookie`, `session`, `credential`, `private_key`, `access_token`, `refresh_token`, `senha`, `token`, `chave`, `segredo`, sem diferenciar maiúsculas e com `_`, `-` ou espaço. O `token` do topo e o `properties.token` só ficam se o valor for exatamente `VITE_POSTHOG_KEY`; sem esse campo a ingestão rejeita o evento. Qualquer outro `token` passa pela limpeza. `$session_id` do topo fica; a cópia aninhada sai, porque a chave casa `session`. `Date` e instância que não é objeto plano saem intactos.

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

Erro de Sentry não é lugar de guardar dado pessoal. O evento final só conserva a allowlist do topo (`event_id`, `timestamp`, `start_timestamp`, `level`, `platform`, `release`, `environment`, `exception`, `message`, `logentry`, `breadcrumbs`, `tags`, `contexts` só com `trace`, `sdk`, `request`, `user`, `transaction`, `type`, `fingerprint`). Cada valor passa pelo scrub. `logger`, `profile`, `debug_meta` e qualquer outra chave são descartados. A palavra sensível redige a string inteira, na chave ou no valor, sem diferenciar maiúsculas e aceitando `_`, `-` ou espaço: `password`, `passwd`, `pwd`, `secret`, `api_key`/`apikey`, `authorization`, `bearer`, `cookie`, `session`, `credential`, `private_key`, `access_token`, `refresh_token`, `senha`, `token`, `chave`, `segredo`. A lista mora em `palavras.js` (a mesma cópia em `site/client` e `site/server`, porque cada projeto da Vercel só publica o próprio Root Directory; o teste exige que os dois arquivos sejam iguais) e em `coletor/src/coletor/palavras.py`. A marca `resenha` não conta como `senha`. Também redige CPF, CNPJ, telefone (qualquer sequência de 8 a 13 dígitos, com espaço, ponto, hífen, parênteses ou `+`, inclusive 0800/0300/0500/0900; SteamID de 17 dígitos, data ISO e placar curto ficam de fora), e-mail e placa. URL (absoluta ou caminho relativo) fica só com origem e caminho, e essa limpeza acontece antes da regra da palavra. A regex de placa antiga também casa com códigos no formato `ADR-0006`.

## FACEIT

O passo `Sincronizar partidas FACEIT` do workflow `Coletor` roda `python -m coletor.main sincronizar-faceit` a cada execução. A lógica está em `coletor/src/coletor/faceit_sync.py`.

1. **Descoberta.** Para cada Jogador com FACEIT vinculada, pede `/players/{id}/history?game=cs2` com `from` e `to`. Sem `from`, a FACEIT só devolve o último mês; foi por isso que o log ficou meses em "0 partida(s) processada(s)". Na primeira varredura, `from` é o lançamento do CS2 (histórico inteiro). Depois, é a Partida FACEIT mais recente que já conhecemos desse Jogador menos 3 dias. Pagina até o fim. Log por Jogador, sem SteamID nem id FACEIT: `descoberta #abcd1234 (desde 2026-10-01): 12 na API / 11 já conhecida(s) / 1 nova(s)`. A hora da última descoberta sem erro fica em `players.faceit_sincronizado_em` e aparece em Minha conta.
2. **Fila.** Até 10 Partidas por rodada, as mais recentes primeiro. Se a Demo baixa, a Partida passa pelo pipeline completo. Se não baixa, entra na hora com as estatísticas da API: placar, K/D/A, HS, dano (ADR × rounds quando só vem ADR), MVPs, Triple/Quadro/Penta, aberturas, clutch 1v1/1v2, flashes e dano de utilitária. KAST, rating, economia e Replay 2D só vêm da Demo.
3. **Re-tentativa da Demo.** A Partida que entrou sem Demo fica em `faceit_pendentes.proxima_tentativa_demo`. O Coletor tenta de novo depois de 1 h, 6 h e, daí em diante, 1 vez por dia, por até 4 semanas da data da Partida (a FACEIT apaga a Demo depois disso). Até 3 por rodada. Quando o download passa, a Demo é gravada na mesma Partida, com a mesma validação do envio manual (mapa, os 10 Jogadores e placar).

Quando a chave não tem acesso à Downloads API, o log mostra uma vez por rodada:

```
sincronizar-faceit: Downloads API sem acesso (403) — a FACEIT_API_KEY não tem a aprovação pra baixar Demos. ...
```

Outro erro de Demo aparece por Partida, com o id trocado por `#hash`.

### Pedir acesso à Downloads API

A Data API (histórico, partida, stats, ELO) vem com qualquer chave. O download de Demo é uma aprovação separada da FACEIT.

1. Entre em https://developers.faceit.com com a conta dona do app.
2. Abra o **App Studio** e escolha o app de onde saiu a `FACEIT_API_KEY` (a chave server-side, não a do vínculo OAuth).
3. Na página do app, procure a área da **Downloads API** e use o pedido de acesso. Se não houver botão, siga a página "Downloads API" da documentação em https://docs.faceit.com, que leva ao formulário.
4. No pedido, descreva o uso: app de estatísticas de um grupo fechado de cerca de 10 amigos, baixa a Demo só das Partidas 5v5 de CS2 dos membros vinculados, poucas por dia, para estatística e Replay 2D. Sem redistribuir o arquivo.
5. Aguarde o e-mail de aprovação. A chave não muda; o secret `FACEIT_API_KEY` do GitHub continua o mesmo.

### Conferir se o acesso saiu

- No GitHub, rode o workflow `Coletor` manualmente (Run workflow, sem marcar nada) e abra o passo `Sincronizar partidas FACEIT`. Com acesso: a linha "Downloads API sem acesso (403)" some, aparecem linhas `#hash: ok com Demo` ou `#hash: Demo recuperada na tentativa N`, e o resumo final conta "N Demo(s) recuperada(s)".
- No banco: `select count(*) from faceit_pendentes where proxima_tentativa_demo is not null;` cai à medida que as Demos chegam, e `select erro_demo from faceit_pendentes where erro_demo is not null order by sem_demo_desde desc limit 5;` deixa de mostrar 403.
- No site: a Partida perde o aviso "Partida da FACEIT sem demo — estatísticas básicas" e ganha Replay 2D.

Partidas com mais de 4 semanas não têm mais Demo na FACEIT. Para elas, só o envio manual na própria Partida ("Enviar demo desta partida").

## Clipe de vídeo das kills (DEMO-SLAP)

Na aba Clipes da Partida, o Jogador marca uma kill (vira um clipe) ou várias (vira uma montagem num vídeo só) e escolhe a visão de quem matou ou de quem morreu. Quem grava é a DEMO-SLAP, num CS2 de verdade, a partir da Demo no R2. A Allstar não faz isso: a API de parceiro dela só escolhe sozinha a melhor jogada (ver `site/server/src/allstarClip.js`).

Ligar:

1. Criar conta em https://demo-slap.net e pedir a chave da API pelo Discord deles (link no topo de https://api-doc.demo-slap.net). No fórum `help`, a equipe pede o SteamID64 da conta por DM e manda a chave de volta.
2. Pôr a chave em `DEMOSLAP_API_KEY` no projeto Vercel `resenhacs` (Production). Sem ela, a aba Clipes mostra "Clipe de vídeo ainda não configurado".
3. Aplicar as migrations `0059_clipes_reais.sql`, `0060_clipes_reais_video_unico.sql` e `0061_clipes_reais_modos_e_liberacao.sql`.
4. Pôr a mesma chave no secret `DEMOSLAP_API_KEY` do GitHub (repositório `bronze-ff/resenhacs`). Sem ele, o `juntar-clipes` é no-op e a montagem fica em trechos.
5. No R2, criar uma regra de ciclo de vida que apaga o prefixo `clipes/` depois de 90 dias (o mesmo prazo da DEMO-SLAP).

Quem pode pedir: só Jogador Premium e super admin. O admin marca quem é Premium em Admin → Jogadores Premium. Premium também ganha a badge ao lado do nick (topo do site e Perfil do Jogador). Quem não é Premium vê os clipes já gerados, mas não pede.

Modos (escolhidos na aba Clipes):

| Modo | O que grava | Câmera |
|---|---|---|
| Clipe | As kills marcadas | Quem matou ou quem morreu, à escolha |
| Fails | As mortes marcadas do Jogador | Quem morreu |
| Coaching | Cada morte marcada, duas vezes | Quem morreu, depois quem matou (custa o dobro) |
| Cheater analysis | As kills marcadas de um suspeito | Quem matou, com X-Ray (`showXRay`) |

Antes de pedir, a aba mostra o custo em créditos e em reais. O valor vem do `custom-credits-calc` da DEMO-SLAP (não gasta crédito), mais 1 crédito se a Demo ainda não foi lida. Os reais usam `DEMOSLAP_REAIS_POR_CREDITO` (padrão 0,19: pacote XS com o euro a ~R$ 6,30).

Como funciona:

- A primeira vez que alguém pede clipe de uma Partida, a API manda a Demo para análise (1 crédito). As próximas reaproveitam a mesma análise.
- Cada trecho custa por segundo (cerca de 0,1 crédito/s, com mínimo de 1 crédito por trecho). O pedido sai sem alta resolução e sem marca d'água (×1,5 cada uma): 1,5 crédito por trecho de até 10 s, com arredondamento para cima por pedido. Montagem de 7 kills: ~11 créditos + 1 da análise. Kill sozinha: 4 s antes e 3 s depois. Montagem: 3 s antes e 2 s depois de cada kill.
- Vídeo único da montagem: o `render-fragmovie` recusa trechos do `render-custom`, então quem junta é o Coletor. O comando `juntar-clipes` roda no cron (10 em 10 min), baixa os trechos, junta com ffmpeg e grava `clipes/<id>.mp4` no R2. Até lá, a aba toca os trechos em sequência. Depois de 1 dia sem conseguir juntar, o Coletor desiste e ficam os trechos.
- Não há worker. O pedido avança quando alguém está com a aba Clipes aberta (ela consulta a cada 10 s). Se ninguém olhar, o clipe fica parado e continua de onde parou na próxima visita.
- Tetos: 10 kills por pedido e 10 pedidos por Jogador por dia.
- Só dá para pedir enquanto a Demo está no R2 (14 dias, ADR-0006). A DEMO-SLAP apaga os vídeos dela em 90 dias.
- A recusa da DEMO-SLAP (por exemplo, "Not enough credits") aparece no próprio clipe, com a mensagem deles.

## Rollback

Vercel: no projeto afetado, Promote do deployment anterior. O client e a API são independentes; voltar um não volta o outro.

Coletor: o cron usa o que está em `main`. Reverter é reverter o commit em `main`. Uma run no meio não é cancelada (`cancel-in-progress: false` no grupo `coletor`) para não derrubar a sessão da conta-bot.

Demo no R2: a limpeza apaga o `.dem` bruto com mais de 14 dias e mantém `replay.json`. Não há restore automático. O workflow de gzip não apaga objeto; o dry-run é o padrão.

## CI

`.github/workflows/ci.yml` é o gate rápido: gitleaks só no intervalo de commits do PR, `npm run verify` em todo PR (se a mudança não toca client, API, Coletor nem bot, roda o verify inteiro), osv se o lockfile mudou, zizmor se `.github/` mudou. Actions pinadas por SHA. Não há merge automático. Os workflows `Coletor`, `Site` e `R2 replays` continuam. `Site` ainda roda os testes de client e server quando `site/**` muda.

Issues: GitHub Issues deste repositório. Templates em `.github/ISSUE_TEMPLATE/`.
