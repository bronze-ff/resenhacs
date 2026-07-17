# Curso de Mira Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma página `/curso` no Resenha onde qualquer membro do grupo assiste aos 5 vídeos do
curso de mira comprado pelo Filippe, com player embutido, progresso salvo (retomar de onde
parou, concluído automático), e upload dos vídeos feito pelo super-admin direto pro R2.

**Architecture:** Catálogo fixo de 5 vídeos no código do servidor (sem tabela). Assistir: o
servidor confere grupo e devolve uma URL assinada de GET do R2 (2h de validade); o `<video>`
do navegador usa essa URL direto, sem passar pela função serverless — suporta os pedidos
parciais (Range) nativamente, sem risco de esbarrar em limite de tempo/tamanho da Vercel.
Upload: mesmo padrão de URL assinada, mas de PUT, restrito ao super-admin.

**Tech Stack:** Express + `@aws-sdk/client-s3`/`@aws-sdk/s3-request-presigner` (já usados em
`site/server/src/r2.js`), Postgres/Supabase, React + `<video>` nativo (sem lib de player).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-17-curso-mira-design.md`.
- Catálogo fixo (sem tabela), 5 vídeos, nesta ordem exata:
  1. `introducao` — "Introdução"
  2. `modulo-1-aimbotz` — "Módulo 1 — AimBotz"
  3. `modulo-2-dm` — "Módulo 2 — Deathmatch"
  4. `modulo-3-mecanicas` — "Módulo 3 — Mecânicas"
  5. `consideracoes-finais` — "Considerações finais"
- Chave no R2 de cada vídeo: `curso-mira/{slug}.mp4`.
- URL assinada de GET (assistir): validade **2 horas**. URL assinada de PUT (upload): mesmo
  helper `presignUpload` já existente, sem mudar sua assinatura.
- Acesso pra assistir: `requireAuth` + `requireGroupMember` (todo membro do grupo ativo vê o
  curso — sem lista de permissão extra).
- Acesso pro upload: `requireAuth` + `requireSuperAdmin` (mesma dupla já usada em
  `POST /api/players` e `POST /api/players/promote`).
- Progresso: sem botão manual de "marcar concluído" — só automático ao `ended` do `<video>`.
  Posição salva a cada ~10s de reprodução (`timeupdate`) e ao pausar (`pause`).
- Slug fora do catálogo fixo → 404 com `{ erro: 'Vídeo não encontrado' }`, em qualquer rota que
  receba `:slug`.

---

### Task 1: Migration — `curso_progresso`

**Files:**
- Create: `supabase/migrations/0031_curso_progresso.sql`

**Interfaces:**
- Produces: tabela `curso_progresso(steam_id64, video_slug, concluido, posicao_segundos,
  atualizado_em)`, chave primária `(steam_id64, video_slug)`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Progresso do Curso de Mira por jogador × vídeo. Sem group_id: o acesso ao curso já é
-- controlado por requireGroupMember na rota; progresso é preferência pessoal do jogador.
create table curso_progresso (
  steam_id64 text not null references players(steam_id64),
  video_slug text not null,
  concluido boolean not null default false,
  posicao_segundos integer not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (steam_id64, video_slug)
);
```

- [ ] **Step 2: Aplicar em produção**

Aplicar em produção é uma etapa **operacional** (Task 5 deste plano), com confirmação
explícita do usuário — NÃO aplicar aqui. Este task só cria e commita o arquivo da migration.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0031_curso_progresso.sql
git commit -m "feat: migration do progresso do Curso de Mira (curso_progresso)"
```

---

### Task 2: Servidor — `r2.js` (presignDownload) + `curso.js` (rotas) + wiring

**Files:**
- Modify: `site/server/src/r2.js` (nova função `presignDownload`)
- Create: `site/server/src/routes/curso.js`
- Modify: `site/server/src/app.js` (wiring da rota nova)
- Test: `site/server/test/curso.test.js`

**Interfaces:**
- Consumes: `presignUpload(client, bucket, key, contentType, expiresInSeconds)` (já existe em
  `r2.js`); `createRequireAuth`/`createRequireGroupMember`/`requireSuperAdmin` (já existem em
  `site/server/src/auth/middleware.js`); tabela `curso_progresso` da Task 1.
- Produces: `presignDownload(client, bucket, key, expiresInSeconds)` em `r2.js`;
  `createCursoRouter({ db, requireAuth, requireGroupMember, r2Client, r2Bucket })` montada em
  `/api/curso` — consumida pela Task 3 (assistir) e Task 4 (upload admin).

- [ ] **Step 1: Escrever os testes que falham**

Crie `site/server/test/curso.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

vi.mock('../src/r2.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    presignDownload: vi.fn().mockResolvedValue('https://r2.example/presigned-get'),
    presignUpload: vi.fn().mockResolvedValue('https://r2.example/presigned-put'),
  }
})

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos' }
const cookieMembro = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`
const cookieAdmin = `resenha_token=${signToken({ steamId: '111', isSuperAdmin: true }, config.jwtSecret)}`
const GRUPO = '11111111-1111-1111-1111-111111111111'

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
      .set('Cookie', cookieMembro)
      .set('X-Group-Id', GRUPO)
      .send({ posicaoSegundos: 10, concluido: false })
    expect(res.status).toBe(404)
  })

  it('slug válido: upsert e devolve 204', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .put('/api/curso/introducao/progresso')
      .set('Cookie', cookieMembro)
      .set('X-Group-Id', GRUPO)
      .send({ posicaoSegundos: 42, concluido: false })
    expect(res.status).toBe(204)
    const chamada = db.query.mock.calls.find(([sql]) => sql.includes('insert into curso_progresso'))
    expect(chamada[1]).toEqual(['765', 'introducao', 42, false])
  })
})

describe('POST /api/curso/upload-url', () => {
  it('membro comum: 403', async () => {
    const { app } = appWith()
    const res = await request(app)
      .post('/api/curso/upload-url')
      .set('Cookie', cookieMembro)
      .send({ slug: 'introducao' })
    expect(res.status).toBe(403)
  })

  it('super-admin com slug do catálogo: devolve a URL de upload', async () => {
    const { app } = appWith()
    const res = await request(app)
      .post('/api/curso/upload-url')
      .set('Cookie', cookieAdmin)
      .send({ slug: 'introducao' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ uploadUrl: 'https://r2.example/presigned-put' })
  })

  it('super-admin com slug fora do catálogo: 404', async () => {
    const { app } = appWith()
    const res = await request(app)
      .post('/api/curso/upload-url')
      .set('Cookie', cookieAdmin)
      .send({ slug: 'nao-existe' })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd site/server && npx vitest run test/curso.test.js`
Expected: FAIL — `Cannot find module '../src/routes/curso.js'` (arquivo ainda não existe).

- [ ] **Step 3: Adicionar `presignDownload` em `r2.js`**

Em `site/server/src/r2.js`, adicione o import de `GetObjectCommand` (já importado — confira a
linha 1, que já traz `GetObjectCommand` junto de `S3Client` e `PutObjectCommand`) e a função
nova, logo depois de `presignUpload`:

```js
// URL assinada de GET direto do R2 pro navegador: usada pro player de vídeo do Curso de Mira
// assistir sem os bytes passarem pela função serverless (arquivos de ~2GB esbarrariam no
// limite de tempo/tamanho da Vercel) — o R2 já entende os pedidos parciais (Range) que o
// <video> usa sozinho pra avançar/retroceder.
export async function presignDownload(client, bucket, key, expiresInSeconds = 7200) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key })
  return getSignedUrl(client, cmd, { expiresIn: expiresInSeconds })
}
```

- [ ] **Step 4: Criar `curso.js`**

Crie `site/server/src/routes/curso.js`:

```js
import { Router } from 'express'
import { requireSuperAdmin } from '../auth/middleware.js'
import { presignDownload, presignUpload } from '../r2.js'

// Catálogo fixo do Curso de Mira — só existe este curso, então não há tabela de catálogo,
// só esta lista no código (ver Global Constraints do plano).
const CATALOGO = [
  { slug: 'introducao', titulo: 'Introdução' },
  { slug: 'modulo-1-aimbotz', titulo: 'Módulo 1 — AimBotz' },
  { slug: 'modulo-2-dm', titulo: 'Módulo 2 — Deathmatch' },
  { slug: 'modulo-3-mecanicas', titulo: 'Módulo 3 — Mecânicas' },
  { slug: 'consideracoes-finais', titulo: 'Considerações finais' },
]

function encontrarVideo(slug) {
  return CATALOGO.find((v) => v.slug === slug) ?? null
}

export function createCursoRouter({ db, requireAuth, requireGroupMember, r2Client, r2Bucket }) {
  const router = Router()

  router.get('/', requireAuth, requireGroupMember, async (req, res) => {
    const { rows } = await db.query(
      'select video_slug, concluido, posicao_segundos from curso_progresso where steam_id64 = $1',
      [req.player.steamId],
    )
    const progressoPorSlug = new Map(rows.map((r) => [r.video_slug, r]))
    res.json(
      CATALOGO.map((v) => {
        const p = progressoPorSlug.get(v.slug)
        return {
          slug: v.slug,
          titulo: v.titulo,
          concluido: p?.concluido ?? false,
          posicaoSegundos: p?.posicao_segundos ?? 0,
        }
      }),
    )
  })

  router.get('/:slug/url', requireAuth, requireGroupMember, async (req, res) => {
    const video = encontrarVideo(req.params.slug)
    if (!video) return res.status(404).json({ erro: 'Vídeo não encontrado' })
    if (!r2Client) return res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })
    const url = await presignDownload(r2Client, r2Bucket, `curso-mira/${video.slug}.mp4`, 7200)
    res.json({ url })
  })

  router.put('/:slug/progresso', requireAuth, requireGroupMember, async (req, res) => {
    const video = encontrarVideo(req.params.slug)
    if (!video) return res.status(404).json({ erro: 'Vídeo não encontrado' })
    const posicaoSegundos = Number(req.body?.posicaoSegundos ?? 0)
    const concluido = Boolean(req.body?.concluido)
    await db.query(
      `insert into curso_progresso (steam_id64, video_slug, posicao_segundos, concluido, atualizado_em)
       values ($1, $2, $3, $4, now())
       on conflict (steam_id64, video_slug)
       do update set posicao_segundos = $3, concluido = $4, atualizado_em = now()`,
      [req.player.steamId, video.slug, posicaoSegundos, concluido],
    )
    res.status(204).end()
  })

  router.post('/upload-url', requireAuth, requireSuperAdmin, async (req, res) => {
    const video = encontrarVideo(String(req.body?.slug ?? ''))
    if (!video) return res.status(404).json({ erro: 'Vídeo não encontrado' })
    if (!r2Client) return res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })
    const uploadUrl = await presignUpload(r2Client, r2Bucket, `curso-mira/${video.slug}.mp4`, 'video/mp4')
    res.json({ uploadUrl })
  })

  return router
}
```

- [ ] **Step 5: Ligar a rota em `app.js`**

Em `site/server/src/app.js`, adicione o import logo abaixo da linha 17
(`import { createGranadasRouter } from './routes/granadas.js'`):

```js
import { createCursoRouter } from './routes/curso.js'
```

E adicione a linha de wiring logo abaixo da linha 86 (`app.use('/api/granadas', createGranadasRouter({ db, requireAuth }))`):

```js
  app.use('/api/curso', createCursoRouter({ db, requireAuth, requireGroupMember, r2Client, r2Bucket: config.r2Bucket }))
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `cd site/server && npx vitest run test/curso.test.js`
Expected: PASS (9 testes).

- [ ] **Step 7: Rodar a suíte completa do servidor**

Run: `cd site/server && npx vitest run`
Expected: PASS (zero regressão nos testes existentes).

- [ ] **Step 8: Commit**

```bash
git add site/server/src/r2.js site/server/src/routes/curso.js site/server/src/app.js site/server/test/curso.test.js
git commit -m "feat: rotas do Curso de Mira (assistir + progresso + upload admin)"
```

---

### Task 3: Client — página `Curso.jsx` + rota + item de menu

**Files:**
- Create: `site/client/src/pages/Curso.jsx`
- Test: `site/client/src/test/Curso.test.jsx`
- Modify: `site/client/src/App.jsx` (rota nova)
- Modify: `site/client/src/components/Shell.jsx` (item de menu + ícone + renumeração)

**Interfaces:**
- Consumes: `GET /api/curso`, `GET /api/curso/:slug/url`, `PUT /api/curso/:slug/progresso` da
  Task 2 (resposta de `GET /api/curso`: `[{ slug, titulo, concluido, posicaoSegundos }]`).

- [ ] **Step 1: Escrever o teste que falha**

Crie `site/client/src/test/Curso.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Curso from '../pages/Curso.jsx'

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url) => {
      if (url === '/api/curso') {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { slug: 'introducao', titulo: 'Introdução', concluido: false, posicaoSegundos: 0 },
            { slug: 'modulo-1-aimbotz', titulo: 'Módulo 1 — AimBotz', concluido: true, posicaoSegundos: 600 },
          ],
        })
      }
      if (url === '/api/curso/introducao/url') {
        return Promise.resolve({ ok: true, json: async () => ({ url: 'https://r2.example/introducao.mp4' }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }),
  )
}

describe('Curso', () => {
  it('lista os vídeos com progresso e abre o player com a URL assinada ao clicar', async () => {
    mockFetch()
    render(<Curso />)
    expect(await screen.findByText('Introdução')).toBeInTheDocument()
    expect(screen.getByText('✓ concluído')).toBeInTheDocument()
    expect(screen.getByText('continuar de 10:00')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Introdução'))
    await waitFor(() => {
      expect(document.querySelector('video')).toHaveAttribute('src', 'https://r2.example/introducao.mp4')
    })
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd site/client && npx vitest run src/test/Curso.test.jsx`
Expected: FAIL — `Failed to resolve import "../pages/Curso.jsx"` (arquivo ainda não existe).

- [ ] **Step 3: Implementar `Curso.jsx`**

Crie `site/client/src/pages/Curso.jsx`:

```jsx
import { useRef, useState, useEffect } from 'react'
import { Card, SectionHeader } from '../components/ui'

function formatarTempo(segundos) {
  const m = Math.floor(segundos / 60)
  const s = Math.floor(segundos % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function Curso() {
  const [videos, setVideos] = useState(null)
  const [slugAtivo, setSlugAtivo] = useState(null)
  const [urlAtivo, setUrlAtivo] = useState(null)
  const [erro, setErro] = useState(null)
  const ultimoEnvio = useRef(0)

  useEffect(() => {
    fetch('/api/curso')
      .then((r) => r.json())
      .then(setVideos)
      .catch(() => setVideos([]))
  }, [])

  async function abrir(video) {
    setErro(null)
    setUrlAtivo(null)
    setSlugAtivo(video.slug)
    const res = await fetch(`/api/curso/${video.slug}/url`)
    if (!res.ok) {
      setErro('Vídeo indisponível, recarregue a página')
      return
    }
    const body = await res.json()
    setUrlAtivo(body.url)
  }

  function salvarProgresso(slug, posicaoSegundos, concluido) {
    fetch(`/api/curso/${slug}/progresso`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posicaoSegundos, concluido }),
    }).then(() => {
      setVideos((atual) =>
        atual?.map((v) => (v.slug === slug ? { ...v, posicaoSegundos, concluido } : v)),
      )
    })
  }

  function onTimeUpdate(e) {
    const agora = e.target.currentTime
    if (agora - ultimoEnvio.current >= 10) {
      ultimoEnvio.current = agora
      salvarProgresso(slugAtivo, Math.floor(agora), false)
    }
  }

  function onPause(e) {
    salvarProgresso(slugAtivo, Math.floor(e.target.currentTime), false)
  }

  function onEnded(e) {
    salvarProgresso(slugAtivo, Math.floor(e.target.duration), true)
  }

  function onLoadedMetadata(e) {
    const video = videos?.find((v) => v.slug === slugAtivo)
    if (video?.posicaoSegundos) e.target.currentTime = video.posicaoSegundos
  }

  const videoAtivo = videos?.find((v) => v.slug === slugAtivo)

  return (
    <div className="max-w-3xl space-y-4">
      <SectionHeader titulo="Curso de mira" />
      {urlAtivo && (
        <Card className="p-3">
          <p className="mb-2 font-display text-sm font-semibold uppercase text-texto">{videoAtivo?.titulo}</p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- curso pessoal sem legendas */}
          <video
            key={slugAtivo}
            controls
            src={urlAtivo}
            className="w-full"
            onTimeUpdate={onTimeUpdate}
            onPause={onPause}
            onEnded={onEnded}
            onLoadedMetadata={onLoadedMetadata}
            onError={() => setErro('Vídeo indisponível, recarregue a página')}
          />
        </Card>
      )}
      {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}
      <div className="space-y-2">
        {videos?.map((v) => (
          <Card
            key={v.slug}
            interativo
            onClick={() => abrir(v)}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <p className="font-display text-sm font-semibold uppercase text-texto">{v.titulo}</p>
            <span className="font-mono text-xs text-texto-fraco">
              {v.concluido
                ? '✓ concluído'
                : v.posicaoSegundos > 0
                  ? `continuar de ${formatarTempo(v.posicaoSegundos)}`
                  : ''}
            </span>
          </Card>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd site/client && npx vitest run src/test/Curso.test.jsx`
Expected: PASS.

- [ ] **Step 5: Adicionar a rota em `App.jsx`**

Em `site/client/src/App.jsx`, adicione o import logo abaixo da linha do import de `Apoie`
(`import Apoie from './pages/Apoie.jsx'`):

```jsx
import Curso from './pages/Curso.jsx'
```

E a rota logo abaixo da rota `/apoie` (`<Route path="/apoie" element={<RotaProtegida><Apoie /></RotaProtegida>} />`):

```jsx
          <Route path="/curso" element={<RotaProtegida><Curso /></RotaProtegida>} />
```

- [ ] **Step 6: Adicionar o item de menu em `Shell.jsx`**

Em `site/client/src/components/Shell.jsx`, o array `ITENS` (linhas 9-23) termina com:

```js
  { to: '/conta', label: 'Minha conta', num: '10', icone: 'perfil' },
]
```

Troque por (novo item, número `11` — os dois itens de admin logo abaixo, hoje `11`/`12`, sobem
pra `12`/`13`):

```js
  { to: '/conta', label: 'Minha conta', num: '10', icone: 'perfil' },
  { to: '/curso', label: 'Curso de mira', num: '11', icone: 'curso' },
]
```

No objeto `NAV_ICONES`, adicione o ícone `curso` (mira/crosshair) — insira logo antes da chave
`apoie:`:

```js
  curso: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <circle cx="12" cy="12" r="8" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
    </svg>
  ),
```

Nas duas `NavLink` de admin, troque os números pra não colidir com o novo `11` — a de
`/admin` (hoje `>11<`) vira:

```jsx
                <span className={`font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque ${colapsada ? 'lg:hidden' : ''}`}>12</span>
```

E a de `/partidas-pro` (hoje `>12<`) vira:

```jsx
                <span className={`font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque ${colapsada ? 'lg:hidden' : ''}`}>13</span>
```

- [ ] **Step 7: Rodar a suíte completa do client**

Run: `cd site/client && npx vitest run`
Expected: PASS (zero regressão).

- [ ] **Step 8: Commit**

```bash
git add site/client/src/pages/Curso.jsx site/client/src/test/Curso.test.jsx site/client/src/App.jsx site/client/src/components/Shell.jsx
git commit -m "feat: pagina do Curso de Mira com player e progresso"
```

---

### Task 4: Client — seção de upload no `Admin.jsx`

**Files:**
- Modify: `site/client/src/pages/Admin.jsx`
- Test: `site/client/src/test/Admin.test.jsx` (novo)

**Interfaces:**
- Consumes: `POST /api/curso/upload-url` da Task 2 (body `{ slug }` → `{ uploadUrl }`).

- [ ] **Step 1: Escrever o teste que falha**

Crie `site/client/src/test/Admin.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import Admin from '../pages/Admin.jsx'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
})

describe('Admin', () => {
  it('mostra um botão de upload pra cada um dos 5 vídeos do curso de mira', async () => {
    render(<Admin />)
    expect(await screen.findByText('Introdução')).toBeInTheDocument()
    expect(screen.getByText('Módulo 1 — AimBotz')).toBeInTheDocument()
    expect(screen.getByText('Módulo 2 — Deathmatch')).toBeInTheDocument()
    expect(screen.getByText('Módulo 3 — Mecânicas')).toBeInTheDocument()
    expect(screen.getByText('Considerações finais')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd site/client && npx vitest run src/test/Admin.test.jsx`
Expected: FAIL — os textos dos vídeos não existem ainda em `Admin.jsx`.

- [ ] **Step 3: Adicionar a seção de upload em `Admin.jsx`**

Em `site/client/src/pages/Admin.jsx`, adicione a constante do catálogo (mesmos 5 vídeos da
Task 2, duplicada de propósito — é só uma lista de exibição no client, não uma fonte de
verdade) logo abaixo do import (linha 2, `import { Card, SectionHeader } from '../components/ui'`):

```jsx
const CURSO_VIDEOS = [
  { slug: 'introducao', titulo: 'Introdução' },
  { slug: 'modulo-1-aimbotz', titulo: 'Módulo 1 — AimBotz' },
  { slug: 'modulo-2-dm', titulo: 'Módulo 2 — Deathmatch' },
  { slug: 'modulo-3-mecanicas', titulo: 'Módulo 3 — Mecânicas' },
  { slug: 'consideracoes-finais', titulo: 'Considerações finais' },
]
```

Dentro do componente `Admin`, adicione o estado e a função de envio, logo abaixo da linha 7
(`const [taticasPendentes, setTaticasPendentes] = useState(null)`):

```js
  const [statusUpload, setStatusUpload] = useState({})

  async function enviarVideoCurso(slug, arquivo) {
    setStatusUpload((s) => ({ ...s, [slug]: 'enviando' }))
    try {
      const resUrl = await fetch('/api/curso/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      })
      if (!resUrl.ok) {
        setStatusUpload((s) => ({ ...s, [slug]: 'erro' }))
        return
      }
      const { uploadUrl } = await resUrl.json()
      const resPut = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
        body: arquivo,
      })
      setStatusUpload((s) => ({ ...s, [slug]: resPut.ok ? 'ok' : 'erro' }))
    } catch {
      setStatusUpload((s) => ({ ...s, [slug]: 'erro' }))
    }
  }
```

E a seção nova de JSX, logo antes do fechamento da `<div>` final (depois do bloco "Táticas
pendentes", antes de `</div>` na penúltima linha do arquivo):

```jsx
      <div className="mt-8 space-y-3">
        <SectionHeader titulo="Curso de mira — upload dos vídeos" />
        <div className="space-y-2">
          {CURSO_VIDEOS.map((v) => (
            <Card key={v.slug} className="flex items-center justify-between gap-3 px-3 py-2">
              <div>
                <p className="font-display text-sm font-semibold uppercase text-texto">{v.titulo}</p>
                <p className="font-mono text-[10px] uppercase text-texto-fraco/70">{v.slug}.mp4</p>
              </div>
              <label className="panel-cut-sm flex min-h-10 shrink-0 cursor-pointer items-center border border-borda px-3 py-1 font-mono text-xs uppercase tracking-wide text-texto-fraco transition-colors hover:border-destaque/50 hover:text-destaque lg:min-h-0">
                {statusUpload[v.slug] === 'enviando'
                  ? 'Enviando…'
                  : statusUpload[v.slug] === 'ok'
                    ? 'Enviado ✓'
                    : statusUpload[v.slug] === 'erro'
                      ? 'Erro, tentar de novo'
                      : 'Escolher arquivo'}
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

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd site/client && npx vitest run src/test/Admin.test.jsx`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte completa do client**

Run: `cd site/client && npx vitest run`
Expected: PASS (zero regressão).

- [ ] **Step 6: Commit**

```bash
git add site/client/src/pages/Admin.jsx site/client/src/test/Admin.test.jsx
git commit -m "feat: secao de upload do Curso de Mira no Admin"
```

---

### Task 5: Deploy (operação)

**Files:** nenhum (ações do controlador + usuário).

- [ ] **Step 1: Aplicar a migration `0031_curso_progresso` em produção**

Confirmação explícita do usuário antes de `apply_migration` no projeto Supabase
`hrpgbrfqxqjxpsjeymec` (padrão do projeto). Confirmar depois com `execute_sql` que a tabela
`curso_progresso` existe.

- [ ] **Step 2: Push pra produção**

Confirmação explícita do usuário antes de `git push` dos commits das Tasks 1-4.

- [ ] **Step 3: Upload manual dos 5 vídeos**

Depois do deploy, o Filippe baixa os 5 arquivos do Google Drive pro computador dele e usa a
seção nova em `/admin` pra subir cada um (o upload vai direto do navegador dele pro R2 — não
precisa da minha ajuda pra essa parte, é só abrir a página e escolher os arquivos).

- [ ] **Step 4: Verificação manual**

Depois de pelo menos 1 vídeo subido, abrir `/curso`, tocar o vídeo, pausar no meio, recarregar
a página e confirmar que o "continuar de M:SS" aparece corretamente, e que o vídeo retoma da
posição certa ao reabrir.
