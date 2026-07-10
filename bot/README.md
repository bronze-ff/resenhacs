# Bot (Fase 2b — download automático de demo)

Node + `steam-user` + `globaloffensive`: conecta como uma conta Steam dedicada ao
Game Coordinator do CS2 pra pedir informação de partida (e, no futuro, a URL de
download do `.dem`) a partir de um share code — sem precisar do jogo instalado.

## Status

- ✅ Login funciona. **Importante**: `accountName` é o **nome de usuário** da Steam
  (ex.: `resenhacs_bot`), **não o e-mail** de cadastro — erro `InvalidPassword` mesmo
  com senha certa geralmente é isso.
- ✅ Conexão ao Game Coordinator funciona (`connectedToGC`), depois que a conta tem
  o CS2 na biblioteca (é grátis: `store.steampowered.com/app/730` → Jogar).
- ⏳ `csgo.requestGame(shareCode)` devolve `matchList` **vazio** mesmo com um share
  code real e recente (~1 dia). Suspeita: contas novas do CS2 têm o Game Coordinator
  restrito até vincular telefone (é assim que a Valve define Trust Factor/Prime) —
  não confirmado ainda, precisa verificar telefone na conta e testar de novo.

## Scripts de teste

- `src/test-login.js` — só login + conexão ao GC.
- `src/test-matchinfo.js <share-code>` — login + GC + pede match info, imprime a
  resposta completa (pra descobrir a estrutura exata quando `requestGame` funcionar).

Ambos rodam com `STEAM_BOT_USER`/`STEAM_BOT_PASS` no `.env` local (git-ignored) ou
nos Secrets do GitHub Actions (já configurados no repo).

## Próximos passos (quando o GC responder de verdade)

1. Extrair a URL do demo da resposta de `matchList` (provavelmente em
   `roundstatsall[].map`, padrão herdado do CS:GO — a confirmar).
2. Baixar o `.dem.bz2`, descomprimir.
3. Handoff pro Coletor Python (`ingest`) — mesmo padrão do upload manual
   (`site/server/src/routes/upload.js`), só que disparado por este bot em vez de um
   humano.
4. Rodar como novo job no `.github/workflows/coletor.yml`, ou como processo
   separado — a decidir conforme a frequência necessária.
