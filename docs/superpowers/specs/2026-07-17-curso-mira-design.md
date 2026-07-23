# Curso de Mira — Design

## Contexto

O Filippe comprou um curso de mira em CS2 (5 vídeos .mp4, ~7GB total, hoje no Google Drive) e
quer disponibilizá-lo dentro do Resenha pro grupo assistir, sem sair do site e sem baixar o
arquivo (o player fica embutido na página). Custo de armazenamento/tráfego no R2 já verificado
como praticamente nulo (egress sempre grátis, 10GB de storage grátis por mês).

## Escopo

- Uma página `/curso`, visível a qualquer membro do grupo, listando os 5 vídeos em ordem fixa,
  cada um com um player `<video>` nativo embutido.
- Progresso por usuário: posição de reprodução salva (retomar de onde parou) e marcação
  automática de "concluído" quando o vídeo termina.
- Upload dos 5 vídeos: ação única e pontual do super-admin (Filippe), direto do navegador pro
  R2, sem passar pela função serverless (arquivos de até ~2,5GB cada).
- Acesso: mesmo nível de qualquer conteúdo do Resenha — todo membro do grupo ativo vê o curso,
  sem lista de permissão adicional.

Fora de escopo: catálogo de múltiplos cursos (só existe este um, fixo no código), botão manual
de "marcar como concluído" (a conclusão é automática ao terminar o vídeo), transcrição/legendas,
qualquer edição da lista de vídeos por uma UI (é uma lista fixa de 5 itens).

## Catálogo (fixo no código, sem tabela)

| slug | título | ordem |
|---|---|---|
| `introducao` | Introdução | 1 |
| `modulo-1-aimbotz` | Módulo 1 — AimBotz | 2 |
| `modulo-2-dm` | Módulo 2 — Deathmatch | 3 |
| `modulo-3-mecanicas` | Módulo 3 — Mecânicas | 4 |
| `consideracoes-finais` | Considerações finais | 5 |

Chave no R2 de cada vídeo: `curso-mira/{slug}.mp4`.

## Arquitetura

**Assistir — URL assinada direta do R2 pro `<video>` do navegador.** O servidor confere sessão
+ grupo, gera uma URL assinada de GET (validade 2h — folga confortável acima da duração de
qualquer aula) pro objeto `curso-mira/{slug}.mp4` e devolve só essa URL. O elemento `<video>`
aponta pra essa URL diretamente — os bytes nunca passam pela função serverless da Vercel, e o
R2 já suporta os pedidos parciais (Range) que o player usa sozinho pra avançar/retroceder.

**Upload — URL assinada de PUT, mesmo padrão do Enviar Demo.** Uma seção nova dentro da página
`Admin.jsx` já existente (não uma página nova), com um botão de upload por vídeo. O navegador
sobe o arquivo direto pro R2 via `presignUpload` (já existe em `site/server/src/r2.js`), sem
passar pelo corpo da função serverless.

**Progresso.** Tabela nova `curso_progresso` (uma linha por jogador × vídeo). O client salva a
posição a cada ~10s de reprodução (via evento `timeupdate` do `<video>`, throttled) e ao pausar
(`pause`), e marca `concluido = true` automaticamente no evento `ended`.

## Modelo de dados

**Migration `0031_curso_progresso.sql`:**

```sql
create table curso_progresso (
  steam_id64 text not null references players(steam_id64),
  video_slug text not null,
  concluido boolean not null default false,
  posicao_segundos integer not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (steam_id64, video_slug)
);
```

Sem `group_id`: o acesso ao curso já é gated por `requireGroupMember` na rota; o progresso em
si é uma preferência pessoal do jogador, não um dado do grupo (evita duplicar a mesma
informação de progresso caso o jogador pertença a mais de um grupo — cenário raro, mas a coluna
extra não traria benefício real).

## API do servidor (`site/server/src/routes/curso.js`, novo)

- `GET /api/curso` (auth + `requireGroupMember`) — devolve os 5 vídeos do catálogo (fixo, do
  código) com o progresso do jogador logado (`concluido`, `posicaoSegundos`) via LEFT JOIN em
  `curso_progresso`, na ordem definida.
- `GET /api/curso/:slug/url` (auth + `requireGroupMember`) — 404 se `slug` não está no
  catálogo fixo; senão devolve `{ url }` com a URL assinada de GET (2h de validade).
- `PUT /api/curso/:slug/progresso` (auth + `requireGroupMember`) — body
  `{ posicaoSegundos, concluido }`; upsert em `curso_progresso` pro `steam_id64` do jogador
  logado. 404 se `slug` não está no catálogo.
- `POST /api/curso/upload-url` (auth + `requireSuperAdmin`) — body `{ slug }`; 404 se `slug`
  não está no catálogo; devolve `{ uploadUrl }` via `presignUpload` (mesmo helper já usado por
  `/api/upload/upload-url`) com a key `curso-mira/{slug}.mp4` e content-type `video/mp4`.

`site/server/src/r2.js` ganha uma função nova, `presignDownload(client, bucket, key,
expiresInSeconds)`, espelhando a já existente `presignUpload` mas com `GetObjectCommand` no
lugar de `PutObjectCommand`.

## Client

**`site/client/src/pages/Curso.jsx`** (novo, rota `/curso`, protegida como as demais páginas
internas): lista os 5 vídeos em ordem (`GET /api/curso` no mount). Cada item mostra título,
um ✓ se `concluido`, ou "continuar de M:SS" se `posicaoSegundos > 0` e não concluído. Clicar
num vídeo busca a URL assinada (`GET /api/curso/:slug/url`) e mostra
`<video controls src={url}>` num `Card`, posicionado em `posicaoSegundos` via
`onLoadedMetadata` (`video.currentTime = posicaoSegundos`). `onTimeUpdate` (throttled a cada
10s) e `onPause` fazem `PUT /api/curso/:slug/progresso` com a posição atual; `onEnded` faz o
mesmo com `concluido: true`. `onError` no `<video>` mostra "vídeo indisponível, recarregue a
página" sem quebrar o resto da tela.

**`site/client/src/components/Shell.jsx`** — item novo no menu, `{ to: '/curso', label: 'Curso
de mira', num: '11', icone: 'curso' }`, adicionado ao array `ITENS` depois de "Minha conta"
(que continua `10`); os itens de admin (`Admin`/`Partidas pro`, hoje `11`/`12`) sobem pra
`12`/`13`. Ícone novo (mira/crosshair) em `NAV_ICONES`.

**`site/client/src/pages/Admin.jsx`** — seção nova "Curso de mira" (visível só aqui, página já
é super-admin-only), com um botão de upload por vídeo do catálogo, no mesmo padrão de
`EnviarDemo.jsx` (`POST /api/curso/upload-url` → `PUT` direto pro R2 com o arquivo escolhido).
Cada botão mostra o slug/título do vídeo esperado, pra evitar subir o arquivo errado no slot
errado.

## Erros

- Vídeo ainda não subido (URL assinada gerada, mas o objeto não existe no R2) ou URL expirada
  no meio da sessão → o navegador dispara `onError` no `<video>`; a página mostra "vídeo
  indisponível, recarregue a página" sem derrubar o resto da lista.
- Upload falha (rede ou PUT pro R2) → mesmo tratamento já usado em `EnviarDemo.jsx` (mensagem
  de erro visível, sem travar a página).
- Slug inválido em qualquer rota → 404 com `{ erro: 'Vídeo não encontrado' }`.

## Testes

- `site/server/test/curso.test.js` (novo): as 4 rotas com R2/db mockados — grupo não-membro
  recebe 403, membro recebe catálogo + progresso correto, `PUT progresso` faz upsert
  (idempotente rodando duas vezes), upload-url exige `requireSuperAdmin` (membro comum recebe
  403), slug inválido devolve 404 em todas as rotas que recebem slug.
- Não há um `r2.test.js` isolado neste projeto — `presignUpload` já é testado só indiretamente,
  via `test/upload.test.js`, mockando `../src/r2.js` inteiro com `vi.mock` e batendo nas rotas
  via `supertest`. `presignDownload` segue o mesmo padrão: coberto indiretamente dentro de
  `curso.test.js` (abaixo), sem arquivo de teste próprio.
- Smoke test de `Curso.jsx`: renderiza a lista dos 5 vídeos, clicar num mostra o `<video>` com a
  URL assinada mockada.
- Smoke test da seção nova em `Admin.jsx`: os 5 botões de upload aparecem.
