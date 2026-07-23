# Curso de Mira — upload em partes + estado real dos vídeos — Design

## Contexto

O Curso de Mira foi pra produção e dois defeitos apareceram no primeiro uso real:

1. **Upload de arquivo grande derruba a aba do Chrome.** `introducao.mp4` (367 MB) subiu normal;
   `modulo-1-aimbotz.mp4` (2.04 GB) crashou a aba com `STATUS_BREAKPOINT` depois de alguns
   segundos.
2. **O Admin não sabe o que já foi enviado.** Depois de subir a introdução com sucesso, um
   reload da página faz o botão voltar pra "Escolher arquivo", como se nada tivesse sido feito.

## Causa raiz

**Defeito 1 — não é limite do R2 nem do servidor.** O R2 aceita PUT único de até 4.995 GiB
(2.04 GB está bem dentro), e o log de produção confirma `POST /api/curso/upload-url 200` — o
presign funcionou. O crash é inteiramente no navegador: `Admin.jsx` faz
`fetch(uploadUrl, { method: 'PUT', body: arquivo })` com o arquivo inteiro de 2 GB, o que
estoura a memória do processo da aba (`STATUS_BREAKPOINT` é o código de crash do renderer do
Chrome). É um problema conhecido de upload de arquivos multi-GB numa requisição só, e a
solução recomendada é sempre enviar em pedaços.

**Defeito 2.** `Admin.jsx` só tem `statusUpload`, um `useState` que vive enquanto a aba estiver
aberta. Nada consulta o R2 pra saber o que existe de fato. Reload zera.

O defeito 2 esconde um terceiro problema já em produção: os 4 vídeos ainda não enviados
aparecem normalmente em `/curso`, e clicar neles cai no `onError` do `<video>` mostrando
"Vídeo indisponível, recarregue a página" — conselho errado (recarregar não resolve) e com
aparência de site quebrado.

## Escopo

- Trocar o upload de requisição única por **multipart** (arquivo fatiado em partes de 100 MiB),
  com progresso visível e retry por parte.
- `GET /api/curso` passa a informar quais vídeos existem de fato no R2 (`disponivel`).
- Admin mostra o estado real (sobrevive a reload) e para de manter um catálogo duplicado dos 5
  vídeos — passa a usar a lista que o servidor já devolve.
- `/curso` apaga (sem permitir clique) os vídeos ainda não enviados.

Fora de escopo: retomar um upload interrompido depois de fechar a aba (o `uploadId` não é
persistido — recomeça do zero); upload de vídeo por não-super-admin; troca do catálogo fixo por
tabela.

## Arquitetura

**Upload em partes.** Três etapas, todas restritas a super-admin:

1. `POST /api/curso/upload/iniciar` `{slug, partes}` → servidor faz `CreateMultipartUpload` e
   pré-assina uma URL de `UploadPart` por parte → `{uploadId, urls: [...]}` (1 round-trip, não
   um por parte).
2. O navegador envia cada `arquivo.slice(...)` de 100 MiB pra `urls[i]`, sequencialmente, com
   até 3 tentativas por parte. Cada pedaço tem 100 MiB no pior caso — nunca chega perto de
   estourar memória.
3. `POST /api/curso/upload/concluir` `{slug, uploadId}` → servidor faz `ListParts` pra descobrir
   as partes que chegaram e então `CompleteMultipartUpload`.

Se qualquer parte falhar depois das tentativas, o cliente chama
`POST /api/curso/upload/abortar` `{slug, uploadId}` → `AbortMultipartUpload`, pra não deixar
partes órfãs ocupando espaço (o R2 aborta sozinho após 7 dias, mas cobra armazenamento até lá).

**Decisão: o servidor descobre as ETags via `ListParts`, o navegador não as envia.**
No fluxo padrão de multipart, o cliente lê o header `ETag` da resposta de cada parte e manda a
lista no complete. Isso exigiria adicionar `ExposeHeaders: ['ETag']` no CORS do bucket — um
passo manual no painel da Cloudflare, já que a configuração de CORS do R2 não é acessível pelas
ferramentas disponíveis aqui. Usar `ListParts` no servidor elimina esse passo e funciona com o
CORS que já está configurado hoje (comprovadamente, já que o upload de 367 MB passou). Confirmado
na documentação oficial que o R2 suporta `ListParts`.

**Limites (verificados na doc oficial do R2):** partes entre 5 MiB e 5 GiB (exceto a última, que
não tem mínimo), máximo 10.000 partes, objeto até 4.995 TiB via multipart. Com partes de
100 MiB, um arquivo de 2.04 GB vira ~21 partes.

**`partes` é limitado a 1000 no servidor.** `ListParts` pagina em 1000 itens por página; limitar
a 1000 partes mantém a leitura numa página só e evita um bug de correção silencioso (partes
além da primeira página sumiriam do complete). 1000 × 100 MiB = 97 GiB de teto por arquivo —
muito além de qualquer aula.

**Estado real dos vídeos.** `GET /api/curso` passa a fazer `HeadObject` nos 5 objetos (em
paralelo) e devolver `disponivel: boolean` por vídeo. Uma rota só serve os dois consumidores:
o Admin (mostra "Enviado ✓" real) e o `/curso` (apaga os indisponíveis). Sem `r2Client`
configurado, todos vêm `disponivel: false`.

Isso também permite **apagar o catálogo duplicado de 5 vídeos do `Admin.jsx`** — hoje a mesma
lista existe copiada em `routes/curso.js` e em `Admin.jsx`, mantida em sincronia na mão (ponto
levantado na revisão da entrega anterior). O Admin passa a renderizar o que `GET /api/curso`
devolve.

## Componentes

**`site/server/src/r2.js`** (modificar) — funções novas, no mesmo estilo das existentes:
- `iniciarMultipart(client, bucket, key, contentType)` → `uploadId`
- `presignUploadPart(client, bucket, key, uploadId, partNumber, expiresInSeconds)` → URL
- `concluirMultipart(client, bucket, key, uploadId)` → `ListParts` + `CompleteMultipartUpload`
- `abortarMultipart(client, bucket, key, uploadId)`
- `objetoExiste(client, bucket, key)` → `boolean` (`HeadObject`; 404 → `false`)

**`site/server/src/routes/curso.js`** (modificar) — remove `POST /upload-url`; adiciona
`POST /upload/iniciar`, `POST /upload/concluir`, `POST /upload/abortar` (todas
`requireAuth + requireSuperAdmin`); `GET /` ganha `disponivel` por vídeo.

**`site/client/src/pages/Admin.jsx`** (modificar) — carrega a lista de `GET /api/curso`; apaga a
constante `CURSO_VIDEOS`; upload fatiado com progresso ("parte 7/21 — 33%") e retry.

**`site/client/src/pages/Curso.jsx`** (modificar) — vídeo com `disponivel: false` não é clicável
e mostra "ainda não disponível".

## Erros

- Parte falha (rede/5xx) → até 3 tentativas na mesma parte; esgotou → aborta o multipart e
  mostra "Erro, tentar de novo" naquele vídeo, sem afetar os outros.
- `iniciar`/`concluir` falha → mesma mensagem, mesmo isolamento por vídeo.
- `slug` fora do catálogo → 404 `{ erro: 'Vídeo não encontrado' }` (comportamento atual mantido).
- `partes` fora de 1..1000 → 400 `{ erro: 'Número de partes inválido' }`.
- Sem R2 configurado → 503 nas rotas de upload; `disponivel: false` em `GET /api/curso`.

## Testes

- `site/server/test/curso.test.js`: as 3 rotas novas (auth de super-admin, slug inválido → 404,
  `partes` inválido → 400, iniciar devolve N urls, concluir chama complete); `GET /api/curso`
  reflete `disponivel` do `HeadObject` mockado. Mesmo padrão já usado: `vi.mock('../src/r2.js')`
  + `supertest`.
- `site/client/src/test/Admin.test.jsx`: renderiza a lista vinda do servidor; mostra "Enviado ✓"
  pra `disponivel: true`; um arquivo falso de 250 MB gera 3 PUTs de parte + 1 concluir.
- `site/client/src/test/Curso.test.jsx`: vídeo `disponivel: false` aparece como "ainda não
  disponível" e não abre player ao clicar.
