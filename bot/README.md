# Bot (Share Code → link do .dem)

Node + `steam-user` + `globaloffensive`. Conecta como uma conta Steam dedicada ao Game
Coordinator do CS2 e devolve o link de download do `.dem` de cada Share Code. Só o GC
sabe esse link: nenhuma Web API da Steam entrega a URL da Demo de matchmaking.

## Como o Coletor usa

`python -m coletor.main fetch` (passo "Baixar e ingerir Partidas pendentes" do
`.github/workflows/coletor.yml`, a cada 10 min) chama:

```
node src/resolve.js CODE1 CODE2 ...
```

1. O script loga **uma vez** na conta-bot e resolve os códigos em sequência.
2. Imprime em stdout um JSON: `[{ "shareCode", "demoUrl" (ou null), "matchTime" (epoch ou null) }]`.
3. Sai com 0. Erro de login ou GC travado sai com 1 (o stderr leva o motivo).

O Coletor baixa o `.dem.bz2` de `demoUrl`, descomprime e ingere. Se o bot falhar
(Steam fora, `LoggedInElsewhere`, timeout), o fetch registra o erro e termina sem
derrubar os passos seguintes do job; as Partidas continuam pendentes. `demoUrl` nulo
gasta uma tentativa da Partida (3 no total).

## Conta-bot

- `accountName` é o **nome de usuário** da Steam, não o e-mail. `InvalidPassword` com
  senha certa costuma ser isso.
- A conta precisa ter o CS2 na biblioteca (grátis) e telefone verificado.
- Uma sessão por vez: com o CS2 aberto em outro lugar, a Steam derruba com
  `LoggedInElsewhere`. O grupo de concorrência `coletor` do workflow garante um run por vez.

Credenciais: `STEAM_BOT_USER` e `STEAM_BOT_PASS` (ver `.env.example`). No Actions são
secrets do repositório. Local, ficam em `bot/.env` (git-ignored); o Coletor lê esse
arquivo quando as variáveis não estão no ambiente.

## Scripts de diagnóstico

- `src/test-login.js` — só login + conexão ao GC.
- `src/test-matchinfo.js <share-code>` — login + GC + imprime a resposta completa do `requestGame`.

```
node --env-file=.env src/test-login.js
```
