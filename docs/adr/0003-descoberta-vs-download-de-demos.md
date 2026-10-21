# Descoberta de Partidas via Web API, download de demo manual (GC adiado)

> **Substituído:** a Fase 2b foi feita. O `fetch` do Coletor baixa a Demo de matchmaking automaticamente, com o link resolvido pela conta-bot em `bot/src/resolve.js` (ver `coletor/README.md`). O texto abaixo registra a decisão original.


A corrente de share codes é descoberta automaticamente pela Steam Web API
(`GetNextMatchSharingCode`), mas o **download do .dem de matchmaking** exige o Game
Coordinator da Valve — só acessível por uma conta-bot Steam (ValvePython/csgo) ou por
um cliente Steam rodando (boiler-writer). Nada disso roda no GitHub Actions gratuito.
Decidimos, na Fase 2, separar as duas coisas: o Coletor **descobre** Partidas (status
`pending`) automaticamente, e o **ingest** de demo é manual (`.dem` baixado pelo
jogador/admin, inclusive de Faceit/GC que dão download direto). A resolução automática
via conta-bot fica como Fase 2b, com o ponto de integração já isolado em `ingest_demo()`.

## Consequences

- Partidas de MM aparecem no site como "demo pendente" até alguém rodar o `ingest`.
- Zero dependência de conta-bot/infra persistente na v1 — condizente com projeto de amigos.
- Faceit/Gamers Club entram pelo mesmo `ingest` manual sem trabalho extra.
