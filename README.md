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
