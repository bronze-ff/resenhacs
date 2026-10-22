# Declaração de uso de dados

Texto para o painel "Práticas de privacidade" da Chrome Web Store. Fonte: contrato da extensão, REVISÃO 2. A seção /privacidade#extensao do site usa o mesmo texto.

## Dados coletados

Marque na loja só estes dois tipos:

- **Informações de autenticação:** o token do ResenhaCS. Ele só serve para enviar Demo, vale 24 horas e é renovado por até 30 dias.
- **Conteúdo do site:** restrito ao link e ao id da Partida do download da Demo FACEIT.

## O que não é coletado

- Histórico de navegação.
- Outros downloads. Só downloads de Demo do CDN da FACEIT são considerados; os outros são ignorados na hora, sem guardar nem enviar.
- Nenhum dado da conta da FACEIT: a extensão não lê cookie, storage nem página da FACEIT.

## Onde os dados ficam

- O token e o histórico das últimas 20 tentativas ficam só no navegador (chrome.storage.local). O histórico guarda o id da Partida, nunca o link da Demo.
- O ResenhaCS recebe o id da Partida e o link da Demo para processar a Demo. O link é descartado quando o processamento termina.

## Certificações (marcar na loja)

- Não vende nem transfere os dados a terceiros, fora dos casos aprovados.
- Não usa nem transfere os dados para fins alheios ao propósito único.
- Não usa nem transfere os dados para avaliar crédito ou para empréstimos.

## Política de privacidade

https://resenha-phi.vercel.app/privacidade#extensao
