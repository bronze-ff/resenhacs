# Resenha

Stats e highlights de CS2 para o grupo. Docs do domínio em [CONTEXT.md](CONTEXT.md) e [docs/BRIEF.md](docs/BRIEF.md).

## Rodar em dev

> Comandos em PowerShell — um por linha (o `&&` não é separador válido no Windows PowerShell 5.1).

1. Preparar o server:
   ```powershell
   cd site/server
   npm install
   copy .env.example .env   # depois preencha o .env
   ```
2. Aplique `supabase/migrations/0001_schema_inicial.sql` no projeto Supabase (SQL Editor)
3. `node --env-file-if-exists=.env scripts/seed-admin.js <seu SteamID64>`
4. `npm run dev` (API em http://localhost:3001)
5. Em outro terminal:
   ```powershell
   cd site/client
   npm install
   npm run dev   # http://localhost:5173
   ```

## Testes

`npm test` dentro de `site/server` e de `site/client`.

## Estrutura

- `site/server` — API Express (auth Steam, JWT, Postgres via pg)
- `site/client` — SPA React + Vite + Tailwind
- `supabase/migrations` — schema versionado (contrato com o Coletor)
- `coletor/` — (Fase 2) Python + demoparser2 via GitHub Actions

## Deploy na Vercel

O `site/client` é um site estático (Vite build) e o `site/server` é uma API Express —
como a Vercel roda em funções serverless, cada um vira um **projeto Vercel separado**,
com o client fazendo proxy de `/api/*` pro domínio da API (mantém tudo same-origin,
então o cookie de sessão funciona sem CORS).

**Projeto 1 — API** (`site/server/api/index.js` é o entrypoint serverless; o `vercel.json` já faz o rewrite `/(.*)` → `/api`):
1. Importar do GitHub → Root Directory: `site/server`
2. Environment Variables (Settings → Environment Variables): `DATABASE_URL` (use o
   **Transaction Pooler** do Supabase, porta 6543 — é o recomendado pra serverless,
   já que cada invocação pode abrir conexão nova), `STEAM_API_KEY`, `JWT_SECRET`,
   `APP_URL` (o domínio do projeto **client**, ex. `https://resenha.vercel.app` —
   é ele que a Steam usa pra validar o `return_to` do login), `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
3. Deploy. Anote o domínio gerado (ex. `https://resenha-api.vercel.app`).

**Projeto 2 — Client**:
1. Importar do GitHub → Root Directory: `site/client`
2. Criar `site/client/vercel.json` com o domínio real da API do passo anterior:
   ```json
   {
     "rewrites": [
       { "source": "/api/:path*", "destination": "https://SEU-DOMINIO-DA-API/api/:path*" },
       { "source": "/(.*)", "destination": "/index.html" }
     ]
   }
   ```
3. Deploy.

**Importante**: depois do primeiro deploy do client, volte no projeto da API e
confirme que `APP_URL` bate com o domínio final do client (o login da Steam falha
silenciosamente se não bater).
