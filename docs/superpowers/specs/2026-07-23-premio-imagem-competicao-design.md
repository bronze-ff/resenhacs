# Imagem e link de mercado no prêmio da competição — Design

**Data:** 2026-07-23

**Origem:** pedido direto do Filippe — no formulário "Nova competição" (admin), o campo
"Prêmio" hoje é só texto livre (`premio_descricao`). Ele quer que o jogador veja uma foto
da skin sorteada e um link pra conferir ela (preço, desgaste, etc.) no mercado da Steam.

## Objetivo

Permitir que o admin, ao criar/editar uma competição, informe também uma imagem da skin
premiada e o link da página dela no mercado da Steam — e que isso apareça no card público
da competição (`Competicoes.jsx`), junto do que já existe hoje (`premioDescricao`).

## Escopo

**Dentro:** dois campos novos (imagem por URL colada, link do mercado da Steam),
obrigatórios ao criar/editar competição, validação de domínio do link, exibição no card
público com preview no form admin.

**Fora (v1):** upload de arquivo (a imagem é sempre um link externo, não sobe pro nosso
storage/R2). Sem esse escopo aqui, não há preocupação com o link parar de existir no ar —
é responsabilidade do admin colar um link válido e estável (ex: a própria imagem do
mercado da Steam, que é servida pela Akamai/CDN da Valve e não expira).

## Modelo de dados

### `competicoes` — duas colunas novas

Nova migration `supabase/migrations/0049_competicao_premio_imagem.sql` (0048 é a última
existente hoje, `0048_matches_tentativas.sql`):

```sql
alter table competicoes
  add column premio_imagem_url text,
  add column premio_mercado_url text;
```

Nullable no banco (competições já existentes ficam com `null` nas duas colunas — não dá
pra fazer backfill de um link que não existe). A obrigatoriedade descrita abaixo é
aplicada na camada de API (mesmo padrão de `nome`/`dataInicio`/`dataFim`, que também são
`not null` só de fato por causa da validação em `POST /admin`, não de uma constraint SQL).

## Backend (`site/server/src/routes/competicoes.js`)

- `mapCompeticao` passa a incluir `premioImagemUrl: c.premio_imagem_url` e
  `premioMercadoUrl: c.premio_mercado_url`.
- `GET /` já seleciona `select *`-like via colunas nomeadas — a query em `router.get('/')`
  precisa listar as duas colunas novas explicitamente (mesmo padrão das já existentes).
- `POST /admin`: desestrutura `premioImagemUrl, premioMercadoUrl` do body. Validação nova,
  junto da checagem de `nome`/`dataInicio`/`dataFim`:
  - `premioImagemUrl` obrigatório (string não vazia).
  - `premioMercadoUrl` obrigatório **e** precisa começar com
    `https://steamcommunity.com/market/` — senão, 400 com
    `{ erro: 'premioMercadoUrl precisa ser um link do mercado da Steam (steamcommunity.com/market/...)' }`.
  - Insert inclui as duas colunas novas.
- `PUT /admin/:id`: mesma validação de `premioMercadoUrl` **só quando o campo vier no
  body** (update é parcial, mesmo padrão de `coalesce` já usado pros outros campos — editar
  só o nome, por exemplo, não deve exigir reenviar imagem/link). Se `premioMercadoUrl` vier
  vazio/não-Steam, 400. Update usa `coalesce($n, premio_imagem_url)` /
  `coalesce($n, premio_mercado_url)` igual aos demais campos.

## Frontend — formulário admin (`FormCompeticao.jsx`)

Dois campos novos, logo abaixo de "Prêmio":

- **Link da imagem da skin** (`premioImagemUrl`, `<input type="url">`). Preview ao vivo:
  se o valor não for vazio, renderiza `<img src={premioImagemUrl} />` abaixo do campo
  (tamanho pequeno, ex: 80×80px) com `onError` escondendo a preview e mostrando
  "não foi possível carregar essa imagem" (não bloqueia o submit — só um aviso visual, a
  validação de "campo obrigatório" é suficiente pro back aceitar).
- **Link no mercado da Steam** (`premioMercadoUrl`, `<input type="url">`).

Submit bloqueado (botão desabilitado ou erro inline, mesmo padrão do `erro` que já existe
no form) se qualquer um dos dois estiver vazio, ou se `premioMercadoUrl` não começar com
`https://steamcommunity.com/market/` — validação espelhada no client pra dar feedback
imediato, mas o back-end é a fonte da verdade (revalida do zero).

Ao editar uma competição existente (`inicial` preenchido), os campos vêm pré-preenchidos
com `inicial.premioImagemUrl` / `inicial.premioMercadoUrl` (mesmo padrão dos outros
campos controlados do form).

## Frontend — exibição pública (`Competicoes.jsx`, `CardCompeticao`)

No topo do card, ao lado do nome/badge do prêmio:

- `<img src={comp.premioImagemUrl}>` — miniatura da skin (renderizada só se o campo não
  for vazio; competições antigas sem o campo preenchido simplesmente não mostram nada
  ali, sem quebrar o layout).
- Um link `<a href={comp.premioMercadoUrl} target="_blank" rel="noreferrer">Ver no
  mercado ↗</a>` — mesmo padrão de link externo que já não existe hoje no arquivo, então
  usa o estilo de botão secundário já padronizado no design system do projeto
  (`panel-cut-sm border border-borda`, mesmo tom dos outros botões secundários do card).

## Erros e casos extremos

- **Link de imagem que não carrega** (URL quebrada, página em vez de imagem direta):
  tratado só no client via `onError` do `<img>` (form admin) — no card público, se a
  imagem não carregar, o navegador mostra o ícone de imagem quebrada; sem tratamento
  especial adicional (fora de escopo esconder graciosamente no público v1, já que o form
  admin avisa o admin no momento de cadastro).
- **`premioMercadoUrl` de outro domínio:** rejeitado com 400 tanto em `POST` quanto em
  `PUT` (quando o campo é enviado).
- **Competição criada antes dessa mudança:** `premioImagemUrl`/`premioMercadoUrl` ficam
  `null` — card público não renderiza a miniatura nem o link "Ver no mercado" pra essas.

## Testes

- **Servidor (`vitest`, arquivo de teste existente de `competicoes.js` — checar se já há
  um, senão criar `competicoes.test.js` seguindo o padrão dos outros routers testados):**
  - `POST /admin` sem `premioImagemUrl`/`premioMercadoUrl` → 400.
  - `POST /admin` com `premioMercadoUrl` de domínio diferente de `steamcommunity.com` →
    400.
  - `POST /admin` com os dois campos válidos → 201, e o registro criado tem as colunas
    preenchidas.
  - `PUT /admin/:id` sem enviar os campos (update parcial de outro campo, ex: `nome`) →
    200, mantém os valores antigos de imagem/link.
  - `PUT /admin/:id` enviando `premioMercadoUrl` inválido → 400.
- **Client (`vitest` + testing-library, `Competicoes.test.jsx` já existe — ver achados da
  exploração):** card renderiza a miniatura e o link "Ver no mercado" quando os campos
  vêm preenchidos na resposta da API; não quebra quando vêm `null` (competição antiga).
