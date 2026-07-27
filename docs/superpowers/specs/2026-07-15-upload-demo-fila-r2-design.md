# Envio manual de demo via fila R2 (conserto definitivo)

## Objetivo

O "Enviar Demo" (`site/client/src/pages/EnviarDemo.jsx`) hoje sobe o arquivo
direto pro corpo de uma request HTTP pra função serverless da Vercel, que
rejeita com `413 Content Too Large` qualquer `.dem` real (100-300MB) — o
limite de payload da Vercel é de poucos MB, muito abaixo disso. O caminho
"funcional" só existe hoje em dev/self-hosted, quando `COLETOR_DIR`/
`COLETOR_PYTHON` apontam pro Coletor Python no mesmo host (rota
`site/server/src/routes/upload.js`, que roda o Coletor via `child_process`
síncrono).

Esse projeto já resolveu exatamente esse problema pra outro fluxo — a fila de
Partidas Pro (`site/server/src/routes/partidasPro.js`): o cliente sobe o
arquivo DIRETO pro R2 via URL pré-assinada (bytes nunca passam pela função
serverless), uma linha fica pendente numa tabela, e o Coletor (rodando via
GitHub Actions, a cada 30 min) baixa do R2 e processa.

## Decisão de escopo

**Substituir** o caminho atual (não manter os dois) — a fila R2 funciona
igual em dev e produção, então manter o `child_process` síncrono como
segundo caminho seria duplicar a mesma função de duas formas. Remove-se
`site/server/src/routes/upload.js` inteiro (rota + testes) e o parâmetro
`coletorDir`/`pythonBin` do gate em `app.js`.

**Consequência aceita pelo usuário**: o envio deixa de ser instantâneo — o
Coletor roda a cada 30 min (mesmo agendamento do `.github/workflows/coletor.yml`),
então a Partida pode levar até ~30 min pra aparecer no Feed. O cliente mostra
só uma mensagem de confirmação de envio recebido, sem página de status (o
usuário descobre que deu certo quando a Partida aparecer no Feed).

## Arquitetura

### 1. Migration — tabela `uploads_pendentes`

Mesmo padrão de `partidas_pro_fila`, mas escopado por `group_id` (qualquer
membro do grupo pode enviar, não só super admin) e sem os campos específicos
de Partidas Pro (`hltv_url`, `match_ids` — aqui é sempre 1 `.dem` = 1 Partida):

```sql
create table uploads_pendentes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id),
  adicionado_por text not null,
  arquivo_r2_key text not null,
  share_code text,
  played_at timestamptz,
  status text not null default 'pendente',
  match_id uuid references matches(id),
  erro text,
  adicionado_em timestamptz not null default now()
);
create index uploads_pendentes_status_idx on uploads_pendentes (status);
```

`status`: `pendente` → `processando` → `pronto` (com `match_id` preenchido) ou
`falhou` (com `erro`).

### 2. Servidor — `site/server/src/routes/upload.js` reescrito

Troca a rota atual (que dependia de `coletorDir`/`pythonBin`) por uma que só
precisa de `r2Client` (igual `partidasPro.js`), montada sempre (sem gate
condicional em `app.js` — o próprio `presignUpload` já lida com R2 ausente
retornando erro, como as outras rotas de replay/demo em `matches.js`):

```js
import { Router } from 'express'
import crypto from 'node:crypto'
import { presignUpload } from '../r2.js'

const SHARE_CODE_RE = /^CSGO(-\S{5}){5}$/
const PLAYED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/

export function createUploadRouter({ db, requireAuth, requireGroupMember, r2Client, r2Bucket }) {
  const router = Router()

  router.post('/upload-url', requireAuth, requireGroupMember, async (req, res) => {
    if (!r2Client) return res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })
    const filename = String(req.body?.filename ?? '').trim()
    if (!filename.toLowerCase().endsWith('.dem')) {
      return res.status(400).json({ erro: 'Só arquivos .dem são aceitos' })
    }
    const shareCode = String(req.body?.shareCode ?? '').trim()
    if (shareCode && !SHARE_CODE_RE.test(shareCode)) {
      return res.status(400).json({ erro: 'Share code inválido (formato CSGO-…-…-…-…-…)' })
    }
    const playedAt = String(req.body?.playedAt ?? '').trim()
    if (playedAt && !PLAYED_AT_RE.test(playedAt)) {
      return res.status(400).json({ erro: 'Data/hora inválida' })
    }

    const key = `uploads-pendentes/${crypto.randomUUID()}.dem`
    const { rows } = await db.query(
      `insert into uploads_pendentes (group_id, adicionado_por, arquivo_r2_key, share_code, played_at)
       values ($1, $2, $3, $4, $5) returning id`,
      [req.groupId, req.player.steamId, key, shareCode || null, playedAt || null],
    )
    const uploadUrl = await presignUpload(r2Client, r2Bucket, key, 'application/octet-stream')
    res.json({ id: rows[0].id, uploadUrl, key })
  })

  return router
}
```

`app.js`: troca o `if (config.coletorDir && config.pythonBin) { ... } else { ... 503 ... }`
por uma montagem incondicional: `app.use('/api/upload', createUploadRouter({ db, requireAuth, requireGroupMember, r2Client, r2Bucket: config.r2Bucket }))`.
`config.coletorDir`/`config.pythonBin` deixam de ser lidos em `app.js` (continuam existindo em `config.js`/`index.js` só se algo mais os usar — checar antes de remover de lá; se nada mais usa, remove também, mas isso é fora do escopo direto se der mais trabalho que o esperado).

### 3. Cliente — `EnviarDemo.jsx`

Troca o `enviar()` de um único `POST /api/upload` multipart por dois passos:

```js
async function enviar(e) {
  e.preventDefault()
  if (!arquivo) return
  setEnviando(true)
  setErro(null)
  setResultado(null)
  try {
    const resUrl = await fetch('/api/upload/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: arquivo.name, shareCode, playedAt }),
    })
    const bodyUrl = await resUrl.json().catch(() => ({}))
    if (!resUrl.ok) {
      setErro(bodyUrl.erro ?? 'Erro ao preparar o envio')
      return
    }
    const resPut = await fetch(bodyUrl.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: arquivo,
    })
    if (!resPut.ok) {
      setErro('Falha ao enviar o arquivo pro armazenamento')
      return
    }
    setResultado(true)
  } catch {
    setErro('Falha de rede ao enviar')
  } finally {
    setEnviando(false)
  }
}
```

Mensagem de sucesso troca de "Partida gravada! Ver partida" (que exigia
`matchId` síncrono) pra algo como "Envio recebido — processando em até 30
minutos. A Partida aparece no Feed quando terminar." (sem link, sem
polling — decisão já tomada).

### 4. Coletor — nova fila

`coletor/src/coletor/db.py`: `listar_uploads_pendentes(conn)` (mesmo padrão
de `listar_fila_pro_pendente`, seleciona `id, group_id, adicionado_por,
arquivo_r2_key, share_code, played_at` onde `status = 'pendente'`) e
`atualizar_upload_pendente(conn, id, status, match_id=None, erro=None)`.

`coletor/src/coletor/main.py`: `cmd_processar_uploads_pendentes(config, conn)`
— mais simples que `cmd_processar_fila_pro` (sempre 1 `.dem`, nunca `.rar`
multi-mapa): baixa do R2, chama `ingest_demo(config, conn, path,
share_code=share_code, source="upload", upload=True, played_at=played_at,
group_id=group_id)`, atualiza status, apaga do R2 em sucesso (mantém em
falha, igual ao padrão de retry da fila pro — **mas sem rota de retry por
enquanto**, YAGNI: se ninguém pediu retry manual pra esse fluxo ainda, não
constrói; dá pra adicionar depois se virar necessidade real).

`ingest_demo`/`_finalizar_ingest` ganham um parâmetro opcional
`group_id=None`: quando informado, usa ELE diretamente em vez de chamar
`dbmod.grupo_para_ingest(conn, steam_ids)` — importante porque aqui já
sabemos com certeza de qual grupo veio o upload (quem enviou), não precisa
adivinhar pelos jogadores da demo.

Novo subcomando `processar-uploads-pendentes` no `argparse` de `main()`.

### 5. GitHub Actions

`.github/workflows/coletor.yml`: novo step, mesmo padrão do
`processar-fila-pro` existente, na mesma `sincroniza` job (roda a cada 30
min via `schedule`):

```yaml
- name: Processar uploads manuais pendentes
  working-directory: coletor
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    ... (mesmas envs do step processar-fila-pro)
  run: python -m coletor.main processar-uploads-pendentes
```

## Testes

- Coletor: `listar_uploads_pendentes`/`atualizar_upload_pendente` (db),
  `cmd_processar_uploads_pendentes` (sucesso, falha, apaga do R2 só em
  sucesso), `ingest_demo`/`_finalizar_ingest` com `group_id` explícito
  (bypassa `grupo_para_ingest`).
- Servidor: `POST /api/upload/upload-url` (401 sem login, 400 filename sem
  `.dem`, 400 shareCode/playedAt inválido, 503 sem R2, 200 com insert +
  presigned URL, grupo vem de `req.groupId`). Remove os testes antigos da
  rota `upload.js` velha (child_process).
- Cliente: nenhum teste dedicado hoje pra essa página (mesmo padrão do
  resto do projeto) — verificação por build + checagem manual.

## Fora de escopo

- Página/endpoint de status dos próprios envios (usuário decidiu: só a
  mensagem de confirmação, sem isso agora).
- Botão de retry pra upload que falhou (YAGNI — adiciona se virar pedido
  real, como foi com a fila pro).
- Qualquer mudança no fluxo de Partidas Pro (`partidas_pro_fila` continua
  intocado, são tabelas/rotas separadas).
