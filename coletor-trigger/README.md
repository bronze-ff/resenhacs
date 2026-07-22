# coletor-trigger

Cloudflare Worker que dispara o workflow "Coletor" (`.github/workflows/coletor.yml`)
via `workflow_dispatch` a cada 5 minutos. Existe porque o gatilho `schedule` nativo do
GitHub Actions é "melhor esforço" — medido na prática em 2026-07-21, disparava a cada
92-137 minutos mesmo configurado pra 30. `workflow_dispatch` via API não sofre esse
atraso.

## Deploy (rodar você mesmo — precisa de login interativo na Cloudflare)

1. **Gerar o GitHub token** (fine-grained, só pra esse repositório):
   - https://github.com/settings/personal-access-tokens/new
   - "Repository access" → "Only select repositories" → `bronze-ff/resenhacs`
   - "Permissions" → "Actions" → "Read and write" (é a única permissão necessária)
   - Gerar e copiar o token (começa com `github_pat_`)

2. **Login na Cloudflare e configurar o secret:**
   ```bash
   cd coletor-trigger
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN
   # cola o token do passo 1 quando pedir
   ```

3. **Deploy:**
   ```bash
   npx wrangler deploy
   ```

4. **Conferir que está funcionando** (espera ~5-10 min e olha se apareceu uma run nova
   com `event: workflow_dispatch`):
   ```bash
   gh run list --workflow=coletor.yml --limit 5
   ```

## Trocar o intervalo

Editar `crons` em `wrangler.toml` e rodar `npx wrangler deploy` de novo.
