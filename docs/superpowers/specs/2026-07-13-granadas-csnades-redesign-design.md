# Redesign da Biblioteca de Granadas (estilo csnades.gg) + Fix CORS do upload

Data: 2026-07-13. Aprovado pelo usuário em conversa (prints do csnades.gg como referência visual direta).

## Contexto e motivação

A página Granadas atual (`site/client/src/pages/Granadas.jsx`) lista lineups auto-extraídos
das demos como cards de texto com mini-radar. O usuário avaliou e rejeitou: "não dá para ver
como que é o jeito certo e o pixel para fazer as utilitárias". A referência aprovada é o
csnades.gg (5 prints fornecidos): navegação mapa-first, radar interativo em tela cheia com
pontos clicáveis, filtro por lado (T/CT) e tipo com contagens, detalhe com vídeo + passos,
e conteúdo **curado manualmente** (cada lineup tem vídeo gravado de propósito — é isso que
ensina o pixel, coisa que dado extraído de demo não tem).

Também nesta entrega: o upload manual de `.rar`/`.dem` na página Partidas Pro falha no
navegador ("erro ao enviar o arquivo") porque o bucket R2 **não tem regra de CORS** — PUT
pré-assinado de browser é bloqueado por padrão no R2. Confirmado: nenhum erro de runtime na
Vercel (a rota de presign funciona; o erro é browser→R2).

## Fases do projeto maior (só a Fase 1+2 nesta spec)

1. **Fase 1**: fix CORS do R2 (nesta spec).
2. **Fase 2**: redesign Granadas estilo csnades (nesta spec).
3. Fase 3 (futura, spec própria): Táticas mapa-first + Prancheta tática (Strategic Board do cs2.cam).
4. Fase 4 (futura, spec própria): Playbook automático (detecção de executes/defaults nas demos).

Decisões do usuário:
- Vídeo por **link do YouTube** com preview embutido (thumbnail no hover, embed no detalhe) — não upload de mp4.
- Lineups auto-extraídos das demos **não somem**: viram "Sugestões" (insight de granadas mais usadas), só admin, alimentando a curadoria.
- Callouts no radar **sim**, com dados prontos da comunidade, toggle Sem/Noob/Pro.
- Quem adiciona/edita lineups curados: **só admin**. Visualização: qualquer logado (mesma `RotaProtegida` do resto do site).

## Fase 1 — CORS no bucket R2

Novo comando `python -m coletor.main configurar-cors` (em `coletor/src/coletor/main.py` +
helper em `coletor/src/coletor/storage_r2.py` usando `put_bucket_cors` do boto3):

```json
[{
  "AllowedOrigins": ["https://resenha-phi.vercel.app", "https://resenhacs.vercel.app", "http://localhost:5173"],
  "AllowedMethods": ["PUT", "GET"],
  "AllowedHeaders": ["content-type"],
  "MaxAgeSeconds": 3600
}]
```

Execução única via GitHub Actions: novo input booleano `configurar_cors` no
`workflow_dispatch` de `.github/workflows/coletor.yml` (mesmo padrão do `reprocessar_tudo`
já existente), step condicional com os mesmos secrets R2. Teste: unitário com client fake
(mesmo padrão de `test_storage_db.py::FakeS3`).

## Fase 2 — Granadas estilo csnades

### Dados (migration `0016_lineups_curados.sql`)

```sql
create table lineups_curados (
  id uuid primary key default gen_random_uuid(),
  map text not null,
  lado text not null check (lado in ('T', 'CT')),
  tipo text not null check (tipo in ('smoke', 'flash', 'he', 'molotov')),
  titulo text not null,
  descricao text,
  video_url text,                -- URL do YouTube (watch/youtu.be/shorts), validada no server
  tecnica text not null default 'normal'
    check (tecnica in ('normal', 'jumpthrow', 'walkthrow', 'runthrow', 'run_jumpthrow')),
  botao text not null default 'esquerdo'
    check (botao in ('esquerdo', 'direito', 'esquerdo_direito')),
  passos jsonb not null default '[]',  -- array de strings, na ordem
  arremesso_x numeric not null,        -- 0..1 no espaço do radar (mesma convenção do replay)
  arremesso_y numeric not null,
  alvo_x numeric not null,
  alvo_y numeric not null,
  criado_por text references players(steam_id64),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index on lineups_curados (map, lado, tipo);
```

A tabela `lineups` (auto-extraída) continua existindo e sendo alimentada pelo coletor, mas
deixa de ser a fonte da página — vira fonte das Sugestões.

### API (`site/server/src/routes/granadas.js`, novo router em `/api/granadas`)

- `GET /` — filtros `map`, `lado`, `tipo` (validados por allowlist/regex, parametrizados);
  qualquer logado. Devolve lista camelCase completa (inclui passos, video_url, posições).
- `GET /contagem` — qualquer logado; devolve `[{map, tipo, total}]` agrupado (pros badges
  dos cards de mapa da landing).
- `POST /` — admin. Valida: map (regex `^[a-z0-9_]+$`), lado/tipo/tecnica/botao (allowlist),
  titulo obrigatório, `video_url` opcional mas se presente precisa casar com regex de
  YouTube (`youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`), passos = array de
  strings, posições numéricas 0..1.
- `PATCH /:id` — admin, mesmos campos/validações, `atualizado_em = now()`.
- `DELETE /:id` — admin.
- `GET /sugestoes?map=` — admin. Agrega a tabela `lineups` (auto-extraída) por
  (tipo, célula de grade de queda — `round(target_x*40)/40` etc.), devolve as mais
  frequentes com contagem, posição média de queda/arremesso e origem (grupo/pro).

Validação SQL: mesma convenção do resto do projeto (allowlist ANTES de montar WHERE,
sempre `params`).

### Frontend

**`Granadas.jsx` reescrita em duas visões** (mesma rota `/granadas`, estado de mapa
selecionado na URL via query param `?map=` pra deep link):

1. **Landing "Explorar por Mapa"** (sem mapa selecionado): grid de cards, um por mapa do
   pool ativo (os 9 de `MAP_CALIBRATION`), imagem `/radars/{map}.png` de fundo com
   overlay escuro, nome do mapa, badges de contagem por tipo (dados de `GET /contagem`).
   Card de mapa sem nenhum lineup fica esmaecido mas clicável.

2. **Página do mapa**: layout de duas colunas.
   - *Sidebar esquerda*: seletor de mapa (volta pra landing ou troca direto), toggle de
     lado T/CT (obrigatório, default T), lista de tipos com contagem (Smoke N / Flash N /
     Molotov N / HE N — tipo sem item fica desabilitado), toggle de callouts
     Sem / Noob / Pro.
   - *Radar principal em SVG* (não canvas — precisa de hover/clique por elemento):
     `<image>` do radar + marcadores na posição de **queda** de cada lineup do filtro
     atual (ícone por tipo: nuvem=smoke, chama=molotov, raio=flash, círculo=HE).
     Hover num marcador: linha tracejada até o ponto de **arremesso** (dot amarelo) +
     card flutuante com título, badge de técnica ("lançar com salto" etc.), botão do
     mouse e thumbnail do YouTube (`img.youtube.com/vi/{id}/mqdefault.jpg`).
     Clique: modal de detalhe — título, badges, descrição, abas **Vídeo** (iframe
     `youtube-nocookie.com/embed/{id}`, carregado só ao abrir a aba) e **Passos**
     (lista ordenada).
   - *Callouts*: JSON estático por mapa em `site/client/src/data/callouts/{map}.json`,
     formato `[{nome, x, y, nivel}]` (x/y 0..1, nivel: "noob" pros principais, "pro"
     pros detalhados). Fonte: dataset público da comunidade (ex.: boltobserv/simple-radar
     no GitHub) adaptado pra nossa calibração — a tarefa de implementação pesquisa e
     converte; se um mapa não tiver dado disponível, entrega vazio (toggle não quebra).
     Renderizados como `<text>` no SVG, Noob mostra só nivel=noob, Pro mostra todos.

3. **Admin — adicionar/editar**: botão "Adicionar granada" (só `isAdmin`) entra em modo
   de marcação: primeiro clique no radar marca ONDE LANÇA, segundo marca ONDE CAI (com
   preview visual e botão de recomeçar), aí abre o form (título, descrição, lado, tipo,
   técnica, botão, URL do YouTube, passos como textarea um-por-linha). Editar/excluir
   pelo modal de detalhe (botões só pra admin).

4. **Sugestões (só admin)**: aba na sidebar mostrando as agregações de
   `GET /sugestoes?map=` — "smoke mais jogada: X vezes (grupo), Y (pro)" com marcador
   próprio no radar; botão "usar como base" pré-preenche o modo de marcação/form com as
   posições médias daquele cluster.

**Navegação (`Shell.jsx`)**: item "Granadas" continua o mesmo, aponta pra mesma rota.

### O que NÃO entra (YAGNI, registrado)

- Upload de vídeo/imagem próprio (decisão: YouTube).
- Imagens nos passos (o vídeo cobre o pixel; texto basta nos passos).
- Callouts editáveis pelo admin (JSON estático versionado no repo).
- Favoritos/likes (existe no csnades, não pedido).
- Página pública sem login.
- Táticas mapa-first / prancheta (Fase 3) e playbook automático (Fase 4).

### Testes

- Server: suíte nova `granadas.test.js` no padrão `appWith(handlers)` — admin-gating
  (403/401), validação de video_url/lado/tipo/posições, contagem, sugestões (agregação
  com mock de rows), CRUD feliz.
- Coletor: teste do `configurar-cors` com client fake.
- Client: `npm run build` + verificação visual no preview (radar, hover, modal, modo
  de marcação admin).

### Riscos/observações

- Reprocessar partida pro fundida (p1+p2) re-parseia só a última parte — pendência
  conhecida registrada, fora do escopo desta spec.
- Datasets de callouts da comunidade podem usar calibração diferente da nossa
  (`MAP_CALIBRATION`); a conversão precisa validar visualmente contra o radar real de
  pelo menos 2 mapas antes de replicar pros 9.
