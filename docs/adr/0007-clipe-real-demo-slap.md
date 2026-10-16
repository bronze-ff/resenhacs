# ADR-0007: Clipe de vídeo das kills escolhidas pela DEMO-SLAP

**Data:** 2026-10-16
**Status:** Aceito. Substitui o Clipe 2D gravado no navegador.

## Contexto

O Jogador quer o clipe de um momento que ele escolhe, por exemplo o TK de granada no amigo, ou uma montagem das kills que ele marcar. E quer vídeo do jogo, não o Replay 2D.

A Allstar não atende. A API de parceiro (ADR-0004, `site/server/src/allstarClip.js`) só tem os modos POTG e BP. Os dois escolhem sozinhos a melhor jogada, sem round, tick ou kill, e não fazem montagem. O que o site da Allstar faz para o usuário final não tem API para terceiros.

## Decisão

Usar a API pública da DEMO-SLAP (https://api-doc.demo-slap.net, v2.5.0):

- `render-custom` grava, num CS2 de verdade, um trecho a partir de `tick`, com `duration` e na visão de `povSteamId`.
- `render-fragmovie` junta os trechos gravados num vídeo só.

Nós já temos o tick de cada kill em `kill_positions`, inclusive TK (migration 0054). O Clipe 2D sai da aba Clipes.

## Alternativas descartadas

- **Rankacy Highlights API:** parece não usar o cliente do jogo, e exige subir o `.dem` em vez de mandar URL.
- **CS Demo Manager (`csdm video`) num PC do grupo:** grátis e real, mas depende de uma máquina ligada com CS2, GPU e Steam logado.
- **GPU na nuvem com CS2:** caro e frágil para o nosso tamanho. GitHub Actions não tem GPU nem sessão Steam.
- **Medal, Leetify, scope.gg:** sem API para isso.

## Consequências

- Custo por crédito: análise de 1 crédito por Partida, mais cerca de 0,1 crédito por segundo de vídeo. Há tetos por pedido e por dia (ver `docs/operacao.md`).
- Sem worker: o pedido avança quando alguém consulta a aba Clipes.
- Depende da Demo ainda estar no R2 (14 dias, ADR-0006).
- Ainda falta confirmar com a DEMO-SLAP se ela aceita a URL assinada do R2 e quais são os limites de uso. O código mostra a recusa deles no próprio clipe.
