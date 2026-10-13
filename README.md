# Resenha — stats, Replay 2D e táticas de CS2 para o grupo

Status: em produção · Stack: React/Vite, Express, Postgres (Supabase), Coletor Python · Dono: [@bronze-ff](https://github.com/bronze-ff)

## Como rodar (dev)

Um comando por linha no Windows PowerShell 5.1 (`&&` não separa comando).

```powershell
cd site/server
npm install
copy .env.example .env
npm run dev
```

A API fica em http://localhost:3001. As migrations de `supabase/migrations/` entram no SQL Editor do Supabase, em ordem. O primeiro admin:

```powershell
node --env-file-if-exists=.env scripts/seed-admin.js <seu SteamID64>
```

Em outro terminal:

```powershell
cd site/client
npm install
copy .env.example .env
npm run dev
```

O site fica em http://localhost:5173 e faz proxy de `/api` para a API.

Antes do PR, na raiz do repositório (com as dependências já instaladas):

```powershell
npm run verify
```

Isso roda o teste e o build do client, o teste da API e o pytest do Coletor.

## Como publicar

Dois projetos na Vercel, sem mudar o Root Directory. O passo a passo, as variáveis e o rollback estão em [docs/operacao.md](docs/operacao.md).

## Estrutura

| Pasta | O que é |
|---|---|
| `site/client` | SPA React + Vite. Projeto Vercel `resenha` |
| `site/server` | API Express. Projeto Vercel `resenhacs` |
| `coletor/` | Python: descoberta, download e parse de Demo |
| `bot/` | Node: resolve Share Code no Game Coordinator |
| `supabase/migrations` | Schema do Postgres |
| `docs/` | Funcionalidades, arquitetura, operação e decisões |

## Documentação

- [docs/funcionalidades.md](docs/funcionalidades.md) — o que cada tela faz
- [docs/arquitetura.md](docs/arquitetura.md) — fluxo de dados e integrações
- [docs/operacao.md](docs/operacao.md) — deploy, variáveis, logs, rollback
- [docs/decisoes/](docs/decisoes/) — decisões novas; as antigas continuam em [docs/adr/](docs/adr/)
- [docs/produto/CONTEXT.md](docs/produto/CONTEXT.md) — glossário (Jogador, Partida, Highlight, Clipe)
- [docs/produto/PRODUCT.md](docs/produto/PRODUCT.md) · [docs/produto/DESIGN.md](docs/produto/DESIGN.md)
- [docs/WORKFLOW.md](docs/WORKFLOW.md) — branches, worktrees e GitHub Issues
