# ADR-0007: Clipe de vídeo das kills escolhidas pela DEMO-SLAP

**Data:** 2026-10-16
**Status:** Aceito. Substitui o Clipe 2D gravado no navegador.

## Contexto

O Jogador quer o clipe de um momento que ele escolhe, por exemplo o TK de granada no amigo, ou uma montagem das kills que ele marcar. E quer vídeo do jogo, não o Replay 2D.

A Allstar não atende. A API de parceiro (ADR-0004, `site/server/src/allstarClip.js`) só tem os modos POTG e BP. Os dois escolhem sozinhos a melhor jogada, sem round, tick ou kill, e não fazem montagem. O que o site da Allstar faz para o usuário final não tem API para terceiros.

## Decisão

Usar a API pública da DEMO-SLAP (https://api-doc.demo-slap.net, v2.5.0):

- `render-custom` grava, num CS2 de verdade, um trecho a partir de `tick`, com `duration` e na visão de `povSteamId`.
- Montagem é um trecho por kill. O `render-fragmovie` recusa trechos do `render-custom` ("No rendered clips found for the supplied videoJobIds", testado em 2026-10-21). Por isso o Coletor junta os trechos com ffmpeg (`juntar-clipes`, no cron do GitHub Actions, de graça porque o repositório é público) e grava o vídeo único no R2. Até ele ficar pronto, a aba toca os trechos em sequência.

Nós já temos o tick de cada kill em `kill_positions`, inclusive TK (migration 0054). O Clipe 2D sai da aba Clipes.

## Alternativas descartadas

- **Rankacy Highlights API:** parece não usar o cliente do jogo, e exige subir o `.dem` em vez de mandar URL.
- **CS Demo Manager (`csdm video`) num PC do grupo:** grátis e real, mas depende de uma máquina ligada com CS2, GPU e Steam logado.
- **GPU na nuvem com CS2:** caro e frágil para o nosso tamanho. GitHub Actions não tem GPU nem sessão Steam.
- **Medal, Leetify, scope.gg:** sem API para isso.

## Consequências

- Custo por crédito: análise de 1 crédito por Partida, mais cerca de 0,1 crédito por segundo de vídeo. Há tetos por pedido e por dia (ver `docs/operacao.md`).
- Sem worker: o pedido avança quando alguém consulta a aba Clipes.
- Modos Fails, Coaching e Cheater analysis (2026-10-21) são o mesmo `render-custom`, com outra câmera ou com `showXRay`. Só Jogador Premium pede, porque cada pedido gasta crédito pago.
- Depende da Demo ainda estar no R2 (14 dias, ADR-0006).
- A DEMO-SLAP aceita a URL assinada do R2: ela baixa a Demo assim que recebe o pedido (confirmado pela equipe no Discord, 2026-10-21). A chave da API sai pelo Discord deles e usa os mesmos créditos do site, inclusive os grátis do dia. Os limites de uso ainda não estão confirmados. O código mostra a recusa deles no próprio clipe.
