# Curso de Mira — upload em partes + estado real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o crash da aba do Chrome ao subir vídeos de vários GB (upload passa a ser em
partes de 100 MiB, com progresso e retry) e fazer o sistema saber quais vídeos existem de fato
no R2 (Admin mostra estado real; `/curso` apaga os que ainda não subiram).

**Architecture:** Multipart upload S3 sobre o R2 — o servidor abre o multipart e pré-assina uma
URL por parte; o navegador manda cada `slice` de 100 MiB numa requisição própria; no fim o
servidor descobre as partes via `ListParts` e completa. `GET /api/curso` ganha `disponivel` via
`HeadObject`, servindo tanto o Admin quanto a página do curso.

**Tech Stack:** Express + `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner` (já usados em
`site/server/src/r2.js`), React + `<video>` nativo, Vitest + supertest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-17-curso-upload-multipart-design.md`.
- Catálogo fixo dos 5 vídeos vive SÓ em `site/server/src/routes/curso.js` (o `Admin.jsx` para de
  ter a cópia dele e passa a usar o que `GET /api/curso` devolve).
- Chave no R2: `curso-mira/{slug}.mp4` (inalterada).
- Tamanho de parte no cliente: **100 MiB** (`100 * 1024 * 1024`).
- Máximo de partes aceito pelo servidor: **1000** (mantém `ListParts` numa página só).
- Retry: **3 tentativas por parte**; esgotou → aborta o multipart e marca erro só naquele vídeo.
- Rotas de upload: `requireAuth + requireSuperAdmin` (NÃO `requireGroupMember` — é ação de admin).
- `GET /api/curso`, `GET /:slug/url`, `PUT /:slug/progresso`: `requireAuth + requireGroupMember`
  (inalterado).
- Slug fora do catálogo → 404 `{ erro: 'Vídeo não encontrado' }` em toda rota que recebe slug.
- Sem `r2Client` → 503 nas rotas de upload; `disponivel: false` em `GET /api/curso`.
- A rota `POST /upload-url` (PUT único) é REMOVIDA — substituída pelo fluxo em 3 etapas.
- `presignUpload` CONTINUA existindo em `r2.js` (usada por `routes/upload.js`, envio de demos) —
  só o import dela em `curso.js` sai.

---

### Task 1: Servidor — helpers de multipart/head em `r2.js` + rotas em `curso.js`

**Files:**
- Modify: `site/server/src/r2.js`
- Modify: `site/server/src/routes/curso.js`
- Test: `site/server/test/curso.test.js`

**Interfaces:**
- Produces (consumido pelas Tasks 2 e 3):
  - `POST /api/curso/upload/iniciar` body `{slug, partes}` → `{uploadId, urls: string[]}` (N urls)
  - `POST /api/curso/upload/concluir` body `{slug, uploadId}` → 204
  - `POST /api/curso/upload/abortar` body `{slug, uploadId}` → 204
  - `GET /api/curso` → `[{slug, titulo, concluido, posicaoSegundos, disponivel}]`

- [ ] **Step 1: Reescrever o teste de `curso.test.js`**

Substitua o conteúdo INTEIRO de `site/server/test/curso.test.js` por:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

vi.mock('../src/r2.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    presignDownload: vi.fn(),
    iniciarMultipart: vi.fn(),
    presignUploadPart: vi.fn(),
    concluirMultipart: vi.fn(),
    abortarMultipart: vi.fn(),
    objetoExiste: vi.fn(),
  }
})
import {
  presignDownload, iniciarMultipart, presignUploadPart, concluirMultipart,
  abortarMultipart, objetoExiste,
} from '../src/r2.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos' }
const cookieMembro = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`
const cookieAdmin = `resenha_token=${signToken({ steamId: '111', isSuperAdmin: true }, config.jwtSecret)}`
const GRUPO = '11111111-1111-1111-1111-111111111111'

// Defaults re-aplicados a cada teste: vi.clearAllMocks() zera as CHAMADAS mas mantém as
// implementações, e um teste que troca a implementação de objetoExiste não pode vazar pro
// seguinte — por isso o beforeEach re-seta tudo explicitamente.
beforeEach(() => {
  vi.clearAllMocks()
  presignDownload.mockResolvedValue('https://r2.example/presigned-get')
  iniciarMultipart.mockResolvedValue('upload-id-1')
  presignUploadPart.mockImplementation((c, b, k, u, n) => Promise.resolve(`https://r2.example/parte-${n}`))
  concluirMultipart.mockResolvedValue(undefined)
  abortarMultipart.mockResolvedValue(undefined)
  objetoExiste.mockResolvedValue(false)
})

function appWith({ progresso = [] } = {}) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      if (sql.includes('group_members where group_id')) return Promise.resolve({ rows: [{}] })
      if (sql.includes('from curso_progresso')) return Promise.resolve({ rows: progresso })
      if (sql.includes('insert into curso_progresso')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db, r2Client: { send: vi.fn() } }), db }
}

describe('GET /api/curso', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    const res = await request(app).get('/api/curso')
    expect(res.status).toBe(401)
  })

  it('sem X-Group-Id: 400', async () => {
    const { app } = appWith()
    const res = await request(app).get('/api/curso').set('Cookie', cookieMembro)
    expect(res.status).toBe(400)
  })

  it('devolve os 5 vídeos do catálogo, em ordem, com progresso do jogador', async () => {
    const { app } = appWith({
      progresso: [{ video_slug: 'modulo-1-aimbotz', concluido: true, posicao_segundos: 600 }],
    })
    const res = await request(app).get('/api/curso').set('Cookie', cookieMembro).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(5)
    expect(res.body[0]).toMatchObject({ slug: 'introducao', titulo: 'Introdução', concluido: false, posicaoSegundos: 0 })
    expect(res.body[1]).toMatchObject({ slug: 'modulo-1-aimbotz', concluido: true, posicaoSegundos: 600 })
  })

  it('disponivel reflete o que existe no R2', async () => {
    objetoExiste.mockImplementation((c, b, key) => Promise.resolve(key === 'curso-mira/introducao.mp4'))
    const { app } = appWith()
    const res = await request(app).get('/api/curso').set('Cookie', cookieMembro).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ slug: 'introducao', disponivel: true })
    expect(res.body[1]).toMatchObject({ slug: 'modulo-1-aimbotz', disponivel: false })
  })
})

describe('GET /api/curso/:slug/url', () => {
  it('slug fora do catálogo: 404', async () => {
    const { app } = appWith()
    const res = await request(app).get('/api/curso/nao-existe/url').set('Cookie', cookieMembro).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(404)
    expect(res.body.erro).toBe('Vídeo não encontrado')
  })

  it('slug válido: devolve a URL assinada', async () => {
    const { app } = appWith()
    const res = await request(app).get('/api/curso/introducao/url').set('Cookie', cookieMembro).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ url: 'https://r2.example/presigned-get' })
  })
})

describe('PUT /api/curso/:slug/progresso', () => {
  it('slug fora do catálogo: 404', async () => {
    const { app } = appWith()
    const res = await request(app)
      .put('/api/curso/nao-existe/progresso')
      .set('Cookie', cookieMembro).set('X-Group-Id', GRUPO)
      .send({ posicaoSegundos: 10, concluido: false })
    expect(res.status).toBe(404)
  })

  it('slug válido: upsert e devolve 204', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .put('/api/curso/introducao/progresso')
      .set('Cookie', cookieMembro).set('X-Group-Id', GRUPO)
      .send({ posicaoSegundos: 42, concluido: false })
    expect(res.status).toBe(204)
    const chamada = db.query.mock.calls.find(([sql]) => sql.includes('insert into curso_progresso'))
    expect(chamada[1]).toEqual(['765', 'introducao', 42, false])
  })
})

describe('POST /api/curso/upload/iniciar', () => {
  it('membro comum: 403', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/curso/upload/iniciar')
      .set('Cookie', cookieMembro).send({ slug: 'introducao', partes: 3 })
    expect(res.status).toBe(403)
  })

  it('slug fora do catálogo: 404', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/curso/upload/iniciar')
      .set('Cookie', cookieAdmin).send({ slug: 'nao-existe', partes: 3 })
    expect(res.status).toBe(404)
  })

  it('partes inválido: 400', async () => {
    const { app } = appWith()
    for (const partes of [0, -1, 1001, 2.5, 'x', undefined]) {
      const res = await request(app).post('/api/curso/upload/iniciar')
        .set('Cookie', cookieAdmin).send({ slug: 'introducao', partes })
      expect(res.status).toBe(400)
      expect(res.body.erro).toBe('Número de partes inválido')
    }
  })

  it('super-admin: abre o multipart e devolve uma url por parte', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/curso/upload/iniciar')
      .set('Cookie', cookieAdmin).send({ slug: 'introducao', partes: 3 })
    expect(res.status).toBe(200)
    expect(res.body.uploadId).toBe('upload-id-1')
    expect(res.body.urls).toEqual([
      'https://r2.example/parte-1',
      'https://r2.example/parte-2',
      'https://r2.example/parte-3',
    ])
    expect(iniciarMultipart).toHaveBeenCalledWith(
      expect.anything(), 'resenha-demos', 'curso-mira/introducao.mp4', 'video/mp4',
    )
  })
})

describe('POST /api/curso/upload/concluir', () => {
  it('membro comum: 403', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/curso/upload/concluir')
      .set('Cookie', cookieMembro).send({ slug: 'introducao', uploadId: 'up-1' })
    expect(res.status).toBe(403)
  })

  it('sem uploadId: 400', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/curso/upload/concluir')
      .set('Cookie', cookieAdmin).send({ slug: 'introducao' })
    expect(res.status).toBe(400)
  })

  it('super-admin: completa o multipart', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/curso/upload/concluir')
      .set('Cookie', cookieAdmin).send({ slug: 'introducao', uploadId: 'up-1' })
    expect(res.status).toBe(204)
    expect(concluirMultipart).toHaveBeenCalledWith(
      expect.anything(), 'resenha-demos', 'curso-mira/introducao.mp4', 'up-1',
    )
  })
})

describe('POST /api/curso/upload/abortar', () => {
  it('membro comum: 403', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/curso/upload/abortar')
      .set('Cookie', cookieMembro).send({ slug: 'introducao', uploadId: 'up-1' })
    expect(res.status).toBe(403)
  })

  it('super-admin: aborta o multipart', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/curso/upload/abortar')
      .set('Cookie', cookieAdmin).send({ slug: 'introducao', uploadId: 'up-1' })
    expect(res.status).toBe(204)
    expect(abortarMultipart).toHaveBeenCalledWith(
      expect.anything(), 'resenha-demos', 'curso-mira/introducao.mp4', 'up-1',
    )
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/server && npx vitest run test/curso.test.js`
Expected: FAIL — `iniciarMultipart`/`objetoExiste` não existem em `r2.js` ainda.

- [ ] **Step 3: Adicionar os helpers em `r2.js`**

Em `site/server/src/r2.js`, troque a linha 1 (o import do SDK) por:

```js
import {
  S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand, ListPartsCommand,
} from '@aws-sdk/client-s3'
```

E adicione ao FIM do arquivo (depois de `streamObject`):

```js
// --- Upload em partes (multipart) ---
// Um PUT único do arquivo inteiro estoura a memória da aba do navegador em arquivos de vários
// GB (um vídeo de 2 GB matava o processo do Chrome com STATUS_BREAKPOINT). O navegador manda
// pedaços de ~100 MiB, cada um numa requisição própria, e o R2 remonta o objeto no fim.

export async function iniciarMultipart(client, bucket, key, contentType) {
  const out = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucket, Key: key, ContentType: contentType,
  }))
  return out.UploadId
}

export async function presignUploadPart(client, bucket, key, uploadId, partNumber, expiresInSeconds = 7200) {
  const cmd = new UploadPartCommand({
    Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber,
  })
  return getSignedUrl(client, cmd, { expiresIn: expiresInSeconds })
}

// Pergunta ao R2 quais partes chegaram, em vez de exigir que o navegador leia o header ETag de
// cada PUT — ler ETag no JS exigiria ExposeHeaders no CORS do bucket (passo manual no painel da
// Cloudflare). ListParts pagina em 1000 por página; quem chama limita as partes a 1000, então
// uma página basta.
export async function concluirMultipart(client, bucket, key, uploadId) {
  const listadas = await client.send(new ListPartsCommand({
    Bucket: bucket, Key: key, UploadId: uploadId, MaxParts: 1000,
  }))
  const partes = (listadas.Parts ?? [])
    .map((p) => ({ ETag: p.ETag, PartNumber: p.PartNumber }))
    .sort((a, b) => a.PartNumber - b.PartNumber)
  if (partes.length === 0) throw new Error('Nenhuma parte foi enviada')
  await client.send(new CompleteMultipartUploadCommand({
    Bucket: bucket, Key: key, UploadId: uploadId,
    MultipartUpload: { Parts: partes },
  }))
}

export async function abortarMultipart(client, bucket, key, uploadId) {
  await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
}

// Existe no bucket? Qualquer erro (404 do R2, credencial ruim, rede) vira false: isto alimenta
// só um rótulo de UI ("ainda não disponível"), e falhar fechado é o comportamento certo aqui.
export async function objetoExiste(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Reescrever as rotas em `curso.js`**

Em `site/server/src/routes/curso.js`, troque a linha 3 (import do r2) por:

```js
import {
  presignDownload, iniciarMultipart, presignUploadPart, concluirMultipart,
  abortarMultipart, objetoExiste,
} from '../r2.js'
```

Logo abaixo de `encontrarVideo` (linha 17), adicione:

```js
// ListParts pagina em 1000 por página; limitar aqui mantém concluirMultipart lendo uma página
// só — sem isso, partes além da primeira sumiriam silenciosamente do complete e o vídeo sairia
// truncado. 1000 partes × 100 MiB = 97 GiB de teto por arquivo, muito além de qualquer aula.
const MAX_PARTES = 1000

function chaveDo(slug) {
  return `curso-mira/${slug}.mp4`
}

// Toda rota de upload valida a mesma tripla: slug do catálogo, R2 configurado, uploadId
// presente. Recebe r2Client por parâmetro (ele vive no closure de createCursoRouter, não no
// request), e devolve null depois de já ter respondido o erro — quem chama só faz `if (!ok) return`.
function validarUpload(req, res, r2Client, { exigirUploadId = false } = {}) {
  const video = encontrarVideo(String(req.body?.slug ?? ''))
  if (!video) {
    res.status(404).json({ erro: 'Vídeo não encontrado' })
    return null
  }
  if (!r2Client) {
    res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })
    return null
  }
  const uploadId = String(req.body?.uploadId ?? '')
  if (exigirUploadId && !uploadId) {
    res.status(400).json({ erro: 'uploadId obrigatório' })
    return null
  }
  return { video, uploadId }
}
```

Troque o handler do `GET /` (linhas 22-39) por:

```js
  router.get('/', requireAuth, requireGroupMember, async (req, res) => {
    const { rows } = await db.query(
      'select video_slug, concluido, posicao_segundos from curso_progresso where steam_id64 = $1',
      [req.player.steamId],
    )
    const progressoPorSlug = new Map(rows.map((r) => [r.video_slug, r]))
    const existencias = await Promise.all(
      CATALOGO.map((v) => (r2Client ? objetoExiste(r2Client, r2Bucket, chaveDo(v.slug)) : false)),
    )
    res.json(
      CATALOGO.map((v, i) => {
        const p = progressoPorSlug.get(v.slug)
        return {
          slug: v.slug,
          titulo: v.titulo,
          concluido: p?.concluido ?? false,
          posicaoSegundos: p?.posicao_segundos ?? 0,
          disponivel: existencias[i],
        }
      }),
    )
  })
```

No `GET /:slug/url` (linha 45), troque a montagem da chave por `chaveDo(video.slug)`:

```js
    const url = await presignDownload(r2Client, r2Bucket, chaveDo(video.slug), 7200)
```

E troque o handler `POST /upload-url` INTEIRO (linhas 64-70) por estes três:

```js
  router.post('/upload/iniciar', requireAuth, requireSuperAdmin, async (req, res) => {
    const ok = validarUpload(req, res, r2Client)
    if (!ok) return
    const partes = Number(req.body?.partes)
    if (!Number.isInteger(partes) || partes < 1 || partes > MAX_PARTES) {
      return res.status(400).json({ erro: 'Número de partes inválido' })
    }
    const key = chaveDo(ok.video.slug)
    const uploadId = await iniciarMultipart(r2Client, r2Bucket, key, 'video/mp4')
    const urls = await Promise.all(
      Array.from({ length: partes }, (_, i) =>
        presignUploadPart(r2Client, r2Bucket, key, uploadId, i + 1)),
    )
    res.json({ uploadId, urls })
  })

  router.post('/upload/concluir', requireAuth, requireSuperAdmin, async (req, res) => {
    const ok = validarUpload(req, res, r2Client, { exigirUploadId: true })
    if (!ok) return
    await concluirMultipart(r2Client, r2Bucket, chaveDo(ok.video.slug), ok.uploadId)
    res.status(204).end()
  })

  router.post('/upload/abortar', requireAuth, requireSuperAdmin, async (req, res) => {
    const ok = validarUpload(req, res, r2Client, { exigirUploadId: true })
    if (!ok) return
    await abortarMultipart(r2Client, r2Bucket, chaveDo(ok.video.slug), ok.uploadId)
    res.status(204).end()
  })
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `cd site/server && npx vitest run test/curso.test.js`
Expected: PASS (16 testes).

- [ ] **Step 6: Rodar a suíte completa do servidor**

Run: `cd site/server && npx vitest run`
Expected: PASS, zero regressão (`upload.test.js` continua verde — `presignUpload` segue em
`r2.js`, só saiu do `curso.js`).

- [ ] **Step 7: Commit**

```bash
git add site/server/src/r2.js site/server/src/routes/curso.js site/server/test/curso.test.js
git commit -m "feat: upload do Curso em partes (multipart) + disponivel via HeadObject"
```

---

### Task 2: Client — `Admin.jsx` com upload fatiado e estado real

**Files:**
- Modify: `site/client/src/pages/Admin.jsx`
- Test: `site/client/src/test/Admin.test.jsx`

**Interfaces:**
- Consumes (da Task 1): `GET /api/curso` → `[{slug, titulo, concluido, posicaoSegundos, disponivel}]`;
  `POST /api/curso/upload/iniciar` `{slug, partes}` → `{uploadId, urls}`;
  `POST /api/curso/upload/concluir` `{slug, uploadId}`; `POST /api/curso/upload/abortar` `{slug, uploadId}`.

- [ ] **Step 1: Reescrever o teste**

Substitua o conteúdo INTEIRO de `site/client/src/test/Admin.test.jsx` por:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Admin from '../pages/Admin.jsx'

// Arquivo falso: um File real de 250 MiB no jsdom seria absurdo em memória e tempo. O código só
// usa .size e .slice(), então isto basta pra exercitar o fatiamento de verdade.
function arquivoFalso(tamanho) {
  return { size: tamanho, slice: (ini, fim) => ({ ini, fim }) }
}

let chamadas
function mockFetch(overrides = {}) {
  chamadas = []
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url, opts) => {
    chamadas.push({ url: String(url), opts })
    if (url === '/api/curso') {
      return Promise.resolve({
        ok: true,
        json: async () => [
          { slug: 'introducao', titulo: 'Introdução', disponivel: true, concluido: false, posicaoSegundos: 0 },
          { slug: 'modulo-1-aimbotz', titulo: 'Módulo 1 — AimBotz', disponivel: false, concluido: false, posicaoSegundos: 0 },
        ],
      })
    }
    if (url === '/api/curso/upload/iniciar') {
      return Promise.resolve({
        ok: overrides.iniciarOk ?? true,
        json: async () => ({ uploadId: 'up-1', urls: ['https://r2/p1', 'https://r2/p2', 'https://r2/p3'] }),
      })
    }
    if (String(url).startsWith('https://r2/')) {
      return Promise.resolve({ ok: overrides.parteOk ?? true })
    }
    return Promise.resolve({ ok: true, json: async () => [] })
  }))
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('Admin — curso de mira', () => {
  it('mostra os vídeos vindos do servidor, com "Enviado" pro que já existe no R2', async () => {
    mockFetch()
    render(<Admin />)
    expect(await screen.findByText('Introdução')).toBeInTheDocument()
    expect(screen.getByText('Módulo 1 — AimBotz')).toBeInTheDocument()
    expect(screen.getByText(/enviado/i)).toBeInTheDocument()
    expect(screen.getByText('Escolher arquivo')).toBeInTheDocument()
  })

  it('sobe em partes de 100 MiB e conclui', async () => {
    mockFetch()
    const { container } = render(<Admin />)
    expect(await screen.findByText('Introdução')).toBeInTheDocument()
    const inputs = container.querySelectorAll('input[type="file"]')
    // 250 MiB / 100 MiB = 2.5 → 3 partes
    fireEvent.change(inputs[0], { target: { files: [arquivoFalso(250 * 1024 * 1024)] } })

    await waitFor(() => {
      expect(chamadas.some((c) => c.url === '/api/curso/upload/concluir')).toBe(true)
    })
    const iniciar = chamadas.find((c) => c.url === '/api/curso/upload/iniciar')
    expect(JSON.parse(iniciar.opts.body)).toEqual({ slug: 'introducao', partes: 3 })
    expect(chamadas.filter((c) => c.url.startsWith('https://r2/'))).toHaveLength(3)
    const concluir = chamadas.find((c) => c.url === '/api/curso/upload/concluir')
    expect(JSON.parse(concluir.opts.body)).toEqual({ slug: 'introducao', uploadId: 'up-1' })
  })

  it('parte falhando: tenta 3x, aborta o multipart e marca erro', async () => {
    mockFetch({ parteOk: false })
    const { container } = render(<Admin />)
    expect(await screen.findByText('Introdução')).toBeInTheDocument()
    const inputs = container.querySelectorAll('input[type="file"]')
    fireEvent.change(inputs[0], { target: { files: [arquivoFalso(150 * 1024 * 1024)] } })

    await waitFor(() => {
      expect(chamadas.some((c) => c.url === '/api/curso/upload/abortar')).toBe(true)
    })
    // 3 tentativas na primeira parte, e desiste sem tentar a segunda
    expect(chamadas.filter((c) => c.url === 'https://r2/p1')).toHaveLength(3)
    expect(chamadas.filter((c) => c.url === 'https://r2/p2')).toHaveLength(0)
    expect(chamadas.some((c) => c.url === '/api/curso/upload/concluir')).toBe(false)
    expect(await screen.findByText(/erro, tentar de novo/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/client && npx vitest run src/test/Admin.test.jsx`
Expected: FAIL — o Admin ainda usa o catálogo local e o PUT único.

- [ ] **Step 3: Reescrever a parte do curso em `Admin.jsx`**

Em `site/client/src/pages/Admin.jsx`:

**(a)** APAGUE a constante `CURSO_VIDEOS` inteira (linhas 4-10) — o catálogo agora vem do
servidor. No lugar dela, coloque:

```jsx
// Pedaços de 100 MiB: um PUT único do arquivo inteiro estoura a memória da aba (um vídeo de
// 2 GB matava o processo do Chrome com STATUS_BREAKPOINT).
const TAMANHO_PARTE = 100 * 1024 * 1024
const TENTATIVAS_POR_PARTE = 3

async function enviarParte(url, pedaco) {
  for (let tentativa = 1; tentativa <= TENTATIVAS_POR_PARTE; tentativa++) {
    try {
      const res = await fetch(url, { method: 'PUT', body: pedaco })
      if (res.ok) return
    } catch {
      // rede caiu no meio da parte — cai no retry abaixo
    }
    if (tentativa === TENTATIVAS_POR_PARTE) throw new Error('parte falhou após as tentativas')
  }
}

function rotuloUpload(status, disponivel) {
  if (status?.estado === 'enviando') {
    const pct = status.total ? Math.round((status.atual / status.total) * 100) : 0
    return `Parte ${status.atual}/${status.total} — ${pct}%`
  }
  if (status?.estado === 'ok') return 'Enviado ✓'
  if (status?.estado === 'erro') return 'Erro, tentar de novo'
  return disponivel ? 'Enviado ✓ — trocar' : 'Escolher arquivo'
}
```

**(b)** Troque a linha do estado `statusUpload` (linha 16) por:

```jsx
  const [statusUpload, setStatusUpload] = useState({})
  const [videosCurso, setVideosCurso] = useState(null)
```

**(c)** Troque a função `enviarVideoCurso` INTEIRA (linhas 18-40) por:

```jsx
  async function enviarVideoCurso(slug, arquivo) {
    const partes = Math.ceil(arquivo.size / TAMANHO_PARTE)
    setStatusUpload((s) => ({ ...s, [slug]: { estado: 'enviando', atual: 0, total: partes } }))
    let uploadId = null
    try {
      const resIniciar = await fetch('/api/curso/upload/iniciar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, partes }),
      })
      if (!resIniciar.ok) throw new Error('iniciar falhou')
      const { uploadId: id, urls } = await resIniciar.json()
      uploadId = id

      for (let i = 0; i < partes; i++) {
        await enviarParte(urls[i], arquivo.slice(i * TAMANHO_PARTE, (i + 1) * TAMANHO_PARTE))
        setStatusUpload((s) => ({ ...s, [slug]: { estado: 'enviando', atual: i + 1, total: partes } }))
      }

      const resConcluir = await fetch('/api/curso/upload/concluir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, uploadId }),
      })
      if (!resConcluir.ok) throw new Error('concluir falhou')
      setStatusUpload((s) => ({ ...s, [slug]: { estado: 'ok' } }))
      setVideosCurso((atual) => atual?.map((v) => (v.slug === slug ? { ...v, disponivel: true } : v)))
    } catch {
      if (uploadId) {
        await fetch('/api/curso/upload/abortar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, uploadId }),
        }).catch(() => {})
      }
      setStatusUpload((s) => ({ ...s, [slug]: { estado: 'erro' } }))
    }
  }
```

**(d)** No `useEffect` existente (linhas 58-63), adicione a busca do catálogo. O `useEffect`
passa a ser:

```jsx
  useEffect(() => {
    fetch('/api/taticas?status=sugerida')
      .then((r) => r.json())
      .then(setTaticasPendentes)
      .catch(() => setTaticasPendentes([]))
    fetch('/api/curso')
      .then((r) => r.json())
      .then(setVideosCurso)
      .catch(() => setVideosCurso([]))
  }, [])
```

**(e)** Troque o bloco JSX do curso (`{CURSO_VIDEOS.map(...)}`, o `<div className="mt-8 space-y-3">`
final) por:

```jsx
      <div className="mt-8 space-y-3">
        <SectionHeader titulo="Curso de mira — upload dos vídeos" />
        <div className="space-y-2">
          {videosCurso?.map((v) => (
            <Card key={v.slug} className="flex items-center justify-between gap-3 px-3 py-2">
              <div>
                <p className="font-display text-sm font-semibold uppercase text-texto">{v.titulo}</p>
                <p className="font-mono text-[10px] uppercase text-texto-fraco/70">{v.slug}.mp4</p>
              </div>
              <label className="panel-cut-sm flex min-h-10 shrink-0 cursor-pointer items-center border border-borda px-3 py-1 font-mono text-xs uppercase tracking-wide text-texto-fraco transition-colors hover:border-destaque/50 hover:text-destaque lg:min-h-0">
                {rotuloUpload(statusUpload[v.slug], v.disponivel)}
                <input
                  type="file"
                  accept="video/mp4"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) enviarVideoCurso(v.slug, f)
                  }}
                />
              </label>
            </Card>
          ))}
        </div>
      </div>
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd site/client && npx vitest run src/test/Admin.test.jsx`
Expected: PASS (3 testes).

- [ ] **Step 5: Rodar a suíte completa do client**

Run: `cd site/client && npx vitest run`
Expected: PASS, zero regressão.

- [ ] **Step 6: Commit**

```bash
git add site/client/src/pages/Admin.jsx site/client/src/test/Admin.test.jsx
git commit -m "feat: upload do curso em partes no Admin, com progresso e estado real"
```

---

### Task 3: Client — `Curso.jsx` apaga vídeo indisponível

**Files:**
- Modify: `site/client/src/pages/Curso.jsx`
- Test: `site/client/src/test/Curso.test.jsx`

**Interfaces:**
- Consumes (da Task 1): `GET /api/curso` → cada item tem `disponivel: boolean`.

- [ ] **Step 1: Atualizar o teste**

Em `site/client/src/test/Curso.test.jsx`, troque o array devolvido pelo mock de `/api/curso`
(hoje 3 itens sem `disponivel`) por:

```jsx
          json: async () => [
            { slug: 'introducao', titulo: 'Introdução', concluido: false, posicaoSegundos: 0, disponivel: true },
            { slug: 'modulo-1-aimbotz', titulo: 'Módulo 1 — AimBotz', concluido: true, posicaoSegundos: 600, disponivel: true },
            { slug: 'modulo-2-dm', titulo: 'Módulo 2 — Deathmatch', concluido: false, posicaoSegundos: 120, disponivel: true },
            { slug: 'modulo-3-mecanicas', titulo: 'Módulo 3 — Mecânicas', concluido: false, posicaoSegundos: 0, disponivel: false },
          ],
```

E adicione este teste novo, depois do existente, dentro do mesmo `describe('Curso', ...)`:

```jsx
  it('vídeo ainda não enviado aparece indisponível e não abre o player', async () => {
    mockFetch()
    render(<Curso />)
    expect(await screen.findByText('Módulo 3 — Mecânicas')).toBeInTheDocument()
    expect(screen.getByText('ainda não disponível')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Módulo 3 — Mecânicas'))
    await waitFor(() => {
      expect(document.querySelector('video')).toBeNull()
    })
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/client && npx vitest run src/test/Curso.test.jsx`
Expected: FAIL — não existe o texto "ainda não disponível".

- [ ] **Step 3: Tratar `disponivel` em `Curso.jsx`**

Em `site/client/src/pages/Curso.jsx`, troque o `<Card>` da lista (o bloco
`{videos?.map((v) => (...))}`) por:

```jsx
        {videos?.map((v) => (
          <Card
            key={v.slug}
            as="button"
            interativo={v.disponivel}
            disabled={!v.disponivel}
            onClick={() => abrir(v)}
            className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${
              v.disponivel ? '' : 'opacity-50'
            }`}
          >
            <p className="font-display text-sm font-semibold uppercase text-texto">{v.titulo}</p>
            <span className="flex flex-col items-end gap-0.5 font-mono text-xs text-texto-fraco">
              {!v.disponivel && <span>ainda não disponível</span>}
              {v.disponivel && v.concluido && <span>✓ concluído</span>}
              {v.disponivel && v.posicaoSegundos > 0 && !v.concluido && (
                <span>{`continuar de ${formatarTempo(v.posicaoSegundos)}`}</span>
              )}
            </span>
          </Card>
        ))}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd site/client && npx vitest run src/test/Curso.test.jsx`
Expected: PASS (2 testes).

- [ ] **Step 5: Rodar a suíte completa do client**

Run: `cd site/client && npx vitest run`
Expected: PASS, zero regressão.

- [ ] **Step 6: Commit**

```bash
git add site/client/src/pages/Curso.jsx site/client/src/test/Curso.test.jsx
git commit -m "fix: video do curso ainda nao enviado nao abre player enganoso"
```

---

### Task 4: Deploy (operação)

**Files:** nenhum (ações do controlador + usuário).

- [ ] **Step 1: Aplicar a migration `0032_ranking_publico_padrao` em produção**

Confirmação explícita do usuário antes de `apply_migration` no projeto Supabase
`hrpgbrfqxqjxpsjeymec`. Essa migration é de OUTRA demanda (ranking público vira opt-out), já
commitada em `supabase/migrations/0032_ranking_publico_padrao.sql`, e vai junto no mesmo deploy.
Conferir depois com `execute_sql` que `ranking_publico` ficou `true` pros 5 jogadores e que o
default da coluna virou `true`.

- [ ] **Step 2: Push pra produção**

Confirmação explícita do usuário antes de `git push` dos commits das Tasks 1-3 + o da migration.

- [ ] **Step 3: Usuário sobe o `modulo-1-aimbotz.mp4` (2.04 GB)**

É o caso que quebrava. Acompanhar: o rótulo deve andar ("Parte 1/21 — 5%" … "Parte 21/21 —
100%") e terminar em "Enviado ✓", sem crash da aba.

- [ ] **Step 4: Verificação**

Recarregar `/admin` e confirmar que os vídeos já enviados aparecem como "Enviado ✓ — trocar"
(estado real, sobrevive ao reload). Abrir `/curso` e confirmar que os vídeos ainda não enviados
estão apagados com "ainda não disponível" em vez do erro enganoso.
