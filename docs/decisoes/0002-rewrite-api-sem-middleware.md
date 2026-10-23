# 0002. /api sem middleware, com rewrite da Vercel

**Data:** 2026-10-23. **Status:** aceita.

## Contexto

`site/client/middleware.js` reescrevia `/api/*` para `https://resenhacs.vercel.app`. Cada chamada invocava o middleware no projeto `resenha` e a função no projeto `resenhacs`. No plano free isso conta duas vezes.

A alternativa de o browser chamar a API direto (`VITE_API_URL`, CORS com `credentials`, cookie `SameSite=None; Secure`) quebra o login. O site de produção é `https://resenha-phi.vercel.app` e a API é `https://resenhacs.vercel.app`. `vercel.app` está na lista de sufixos públicos, então são sites diferentes e não dá para compartilhar cookie por domínio pai. O cookie `resenha_token` é host-only e `SameSite=Lax`. Um `fetch` cross-site manda esse cookie como terceiro. Safari, todo browser no iOS (WebKit) e o Firefox bloqueiam. `SameSite=None` não fura esse bloqueio.

O mesmo fluxo depende da origem do site, não da origem da API:

- Steam OpenID volta para `${APP_URL}/api/auth/steam/return` com navegação de topo. O `return_to` tem que bater com `APP_URL`, que é o client.
- O vínculo FACEIT usa `${APP_URL}/api/faceit/callback`.
- O webhook do Allstar posta em `${APP_URL}/api/allstar/webhook`.
- `POST /api/extensao/token` recusa `Sec-Fetch-Site: cross-site`. A extensão em si continua em `https://resenhacs.vercel.app/api/extensao`, com Bearer, sem cookie.
- O service worker não faz fallback de navegação em `/api` e não guarda resposta de API. Os `fetch('/api/...')` do client são relativos.

## Decisão

Rewrite externo no CDN do projeto `resenha`, gerado por `site/client/vercel.mjs` no build. Produção aponta para `https://resenhacs.vercel.app`. Preview e Development só apontam para `PREVIEW_API_URL` se for uma origem `https` sem usuário na URL; senão `/api` responde 503, sem função e sem tocar no banco de produção. `vercel.json` estático não lê env, e middleware lê env pagando invocação. O arquivo `.mjs` roda uma vez no build.

O browser segue em `/api` na origem do site. Cookie, CSP (`connect-src 'self'`), service worker, login, FACEIT, webhook e a entrega do token da extensão não mudam de contrato. Não há `VITE_API_URL`.

Resposta de `/api` sai com `Cache-Control: private, no-store` e o par de headers de CDN da Vercel. Rewrite externo pode cachear; sessão não pode ir parar no cache.

A borda do projeto `resenhacs` substitui `X-Forwarded-For`. `trust proxy` continua 1. O rate limit de quem tem sessão usa o `steamId` do JWT. Anônimo continua por IP. No limite estrito, anônimo inclui o path, para um POST sem cookie não dividir o balde de 10/min com o webhook do Allstar.

## Consequências

- Nenhuma variável nova. `APP_URL` no `resenhacs` continua `https://resenha-phi.vercel.app`. `PREVIEW_API_URL` no `resenha`, se existir, passa a valer no build: mudar o valor pede deploy novo.
- Anônimo no site divide um balde só (o IP de saída do rewrite). Quem está logado não. A extensão, que chama a API direto, continua no IP do Jogador.
- O primeiro deploy do `resenha` com este arquivo é que desliga o middleware. Até lá o comportamento em produção é o antigo.
