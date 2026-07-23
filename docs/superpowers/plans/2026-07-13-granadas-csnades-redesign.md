# Redesign Granadas (estilo csnades) + Fix CORS R2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biblioteca de granadas curada pelo admin com navegação mapa-first, radar SVG interativo (hover→card com thumbnail do YouTube, clique→modal com vídeo/passos), sugestões a partir das demos, callouts — e destravar o upload de .rar/.dem configurando CORS no bucket R2.

**Architecture:** Tabela nova `lineups_curados` (separada da `lineups` auto-extraída, que vira fonte de sugestões). Router Express novo `/api/granadas` (CRUD admin + leitura logada + contagem + sugestões agregadas). Frontend: `Granadas.jsx` vira orquestrador de duas visões (landing por mapa / página do mapa), com componentes novos em `site/client/src/components/granadas/`. CORS do R2 configurado uma vez via comando do coletor rodado no GitHub Actions.

**Tech Stack:** Express + pg (parametrizado), vitest+supertest (padrão `appWith`), React+Vite+Tailwind v4 (tokens `bg-superficie`/`text-destaque`/`panel-cut` etc.), SVG (não canvas) pro radar interativo, boto3 `put_bucket_cors` no coletor (pytest).

## Global Constraints

- Todo texto de UI em português (pt-BR), mesmo tom do resto do site.
- SQL SEMPRE parametrizado; valores de filtro validados por allowlist/regex ANTES de montar o WHERE (padrão de `site/server/src/routes/lineups.js`).
- Tipos válidos de granada: `smoke`, `flash`, `he`, `molotov`. Lados: `T`, `CT`. Técnicas: `normal`, `jumpthrow`, `walkthrow`, `runthrow`, `run_jumpthrow`. Botões: `esquerdo`, `direito`, `esquerdo_direito`.
- Posições x/y são normalizadas 0..1 no espaço do radar (mesma convenção do replay.json e da tabela `lineups` pós-normalização).
- Mapas do pool: `de_mirage`, `de_dust2`, `de_inferno`, `de_nuke`, `de_overpass`, `de_vertigo`, `de_ancient`, `de_anubis`, `de_train` (os 9 de `MAP_CALIBRATION` em `coletor/src/coletor/replay.py`).
- URL de vídeo aceita: `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/shorts/ID` (ID = 11 chars `[A-Za-z0-9_-]`).
- Origens CORS do R2: `https://resenha-phi.vercel.app`, `https://resenhacs.vercel.app`, `http://localhost:5173`.
- Sem comentários "o que" no código; só "por quê" quando não óbvio, em português.
- Fora de escopo (YAGNI, ver spec): upload de vídeo/imagem, imagens nos passos, callouts editáveis, favoritos, página pública, prancheta tática, playbook.

---

### Task 1: CORS do bucket R2 (coletor + workflow)

**Files:**
- Modify: `coletor/src/coletor/storage_r2.py`
- Modify: `coletor/src/coletor/main.py` (argparse + dispatch)
- Modify: `coletor/tests/test_storage_db.py`
- Modify: `.github/workflows/coletor.yml`

**Interfaces:**
- Produces: `storage_r2.configurar_cors(client, bucket, origens)` e subcomando CLI `configurar-cors`.

- [ ] **Step 1: Teste falhando** — em `coletor/tests/test_storage_db.py`, na seção `# ---- storage ----`:

```python
def test_configurar_cors_manda_regra_pro_bucket():
    s3 = FakeS3()
    storage_r2.configurar_cors(s3, "bucket", ["https://a.com", "http://localhost:5173"])
    assert s3.cors[0]["Bucket"] == "bucket"
    regra = s3.cors[0]["CORSConfiguration"]["CORSRules"][0]
    assert regra["AllowedOrigins"] == ["https://a.com", "http://localhost:5173"]
    assert regra["AllowedMethods"] == ["PUT", "GET"]
    assert regra["AllowedHeaders"] == ["content-type"]
    assert regra["MaxAgeSeconds"] == 3600
```

E no `FakeS3`, adicionar `self.cors = []` no `__init__` e:

```python
    def put_bucket_cors(self, **kw):
        self.cors.append(kw)
```

- [ ] **Step 2: Rodar** `cd coletor && python -m pytest tests/test_storage_db.py -q` — FAIL (`configurar_cors` não existe).

- [ ] **Step 3: Implementar** em `coletor/src/coletor/storage_r2.py`:

```python
def configurar_cors(client, bucket, origens):
    """Regra de CORS pro bucket — sem ela o R2 recusa o PUT pré-assinado vindo de
    navegador (upload manual de demo pro na página Partidas Pro). Rodar uma vez."""
    client.put_bucket_cors(
        Bucket=bucket,
        CORSConfiguration={
            "CORSRules": [
                {
                    "AllowedOrigins": list(origens),
                    "AllowedMethods": ["PUT", "GET"],
                    "AllowedHeaders": ["content-type"],
                    "MaxAgeSeconds": 3600,
                }
            ]
        },
    )
```

- [ ] **Step 4: Rodar de novo** — PASS. Rode a suíte inteira: `python -m pytest -q` (nada quebrou).

- [ ] **Step 5: CLI** em `coletor/src/coletor/main.py` — dentro de `main()`, junto dos outros `sub.add_parser`:

```python
    sub.add_parser(
        "configurar-cors",
        help="Configura CORS no bucket R2 (uma vez) pra aceitar upload direto do navegador.",
    )
```

e no dispatch (`elif args.cmd == ...`):

```python
        elif args.cmd == "configurar-cors":
            client = storage_r2.make_client(config)
            storage_r2.configurar_cors(
                client,
                config.r2_bucket,
                [
                    "https://resenha-phi.vercel.app",
                    "https://resenhacs.vercel.app",
                    "http://localhost:5173",
                ],
            )
            print(f"configurar-cors: regra aplicada no bucket {config.r2_bucket}")
```

- [ ] **Step 6: Workflow** — em `.github/workflows/coletor.yml`, adicionar input (abaixo de `reprocessar_tudo`):

```yaml
      configurar_cors:
        description: 'Configurar CORS no bucket R2 (upload de demo pro via navegador) - rodar uma vez'
        type: boolean
        default: false
```

e step (depois do step "Reprocessar todas as Partidas (sob demanda)", mesmo bloco de `env` com os secrets R2 + DATABASE_URL):

```yaml
      - name: Configurar CORS no bucket R2 (sob demanda)
        if: github.event_name == 'workflow_dispatch' && inputs.configurar_cors == true
        working-directory: coletor
        env:
          PYTHONPATH: src
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
        run: python -m coletor.main configurar-cors
```

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: comando configurar-cors no R2 (upload de demo pro via navegador era bloqueado)"`

---

### Task 2: Migration + router `/api/granadas` (CRUD, contagem, sugestões)

**Files:**
- Create: `supabase/migrations/0016_lineups_curados.sql`
- Create: `site/server/src/routes/granadas.js`
- Create: `site/server/test/granadas.test.js`
- Modify: `site/server/src/app.js` (import + mount)

**Interfaces:**
- Consumes: `requireAuth` (injetado), `requireAdmin` de `../auth/middleware.js`, tabela `lineups` (auto-extraída, posições já normalizadas 0..1).
- Produces: rotas `GET /api/granadas`, `GET /api/granadas/contagem`, `GET /api/granadas/sugestoes`, `POST /api/granadas`, `PATCH /api/granadas/:id`, `DELETE /api/granadas/:id`. Shape do item: `{id, map, lado, tipo, titulo, descricao, videoUrl, tecnica, botao, passos, arremessoX, arremessoY, alvoX, alvoY, criadoPor, criadoEm}`.

- [ ] **Step 1: Migration** `supabase/migrations/0016_lineups_curados.sql`:

```sql
create table lineups_curados (
  id uuid primary key default gen_random_uuid(),
  map text not null,
  lado text not null check (lado in ('T', 'CT')),
  tipo text not null check (tipo in ('smoke', 'flash', 'he', 'molotov')),
  titulo text not null,
  descricao text,
  video_url text,
  tecnica text not null default 'normal'
    check (tecnica in ('normal', 'jumpthrow', 'walkthrow', 'runthrow', 'run_jumpthrow')),
  botao text not null default 'esquerdo'
    check (botao in ('esquerdo', 'direito', 'esquerdo_direito')),
  passos jsonb not null default '[]',
  arremesso_x numeric not null,
  arremesso_y numeric not null,
  alvo_x numeric not null,
  alvo_y numeric not null,
  criado_por text references players(steam_id64),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index on lineups_curados (map, lado, tipo);
```

(O controlador aplica em produção depois do review — o implementador só cria o arquivo.)

- [ ] **Step 2: Testes falhando** — `site/server/test/granadas.test.js` (padrão de `test/partidasPro.test.js` — copie o cabeçalho de imports/`config`/cookies/`appWith` de lá, sem o mock de r2.js que aqui não é usado):

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookieJogador = `resenha_token=${signToken({ steamId: '765', isAdmin: false }, config.jwtSecret)}`
const cookieAdmin = `resenha_token=${signToken({ steamId: '999', isAdmin: true }, config.jwtSecret)}`

function appWith(handlers) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      for (const [needle, rows] of handlers) {
        if (sql.includes(needle)) return Promise.resolve({ rows })
      }
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db, r2Client: null }), db }
}

const LINHA = {
  id: 'g1', map: 'de_mirage', lado: 'T', tipo: 'smoke', titulo: 'Smoke janela',
  descricao: 'da base', video_url: 'https://youtu.be/abcdefghijk', tecnica: 'jumpthrow',
  botao: 'esquerdo', passos: ['mire no pixel', 'jumpthrow'], arremesso_x: '0.2',
  arremesso_y: '0.8', alvo_x: '0.4', alvo_y: '0.3', criado_por: '999',
  criado_em: '2026-07-13T00:00:00Z',
}

describe('GET /api/granadas', () => {
  it('anonimo: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/granadas')).status).toBe(401)
  })

  it('logado lista com filtros validados e camelCase', async () => {
    const { app, db } = appWith([['from lineups_curados', [LINHA]]])
    const res = await request(app)
      .get('/api/granadas?map=de_mirage&lado=T&tipo=smoke')
      .set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({
      id: 'g1', videoUrl: 'https://youtu.be/abcdefghijk', arremessoX: 0.2, alvoY: 0.3,
      passos: ['mire no pixel', 'jumpthrow'], tecnica: 'jumpthrow',
    })
    expect(db.query.mock.calls[0][1]).toEqual(['de_mirage', 'T', 'smoke'])
  })

  it('filtro invalido e ignorado (nao vira SQL)', async () => {
    const { app, db } = appWith([['from lineups_curados', []]])
    await request(app).get("/api/granadas?map=x';drop&lado=Z&tipo=nuke").set('Cookie', cookieJogador)
    expect(db.query.mock.calls[0][1]).toEqual([])
  })
})

describe('GET /api/granadas/contagem', () => {
  it('agrupa por mapa e tipo', async () => {
    const { app } = appWith([['group by map, tipo', [{ map: 'de_mirage', tipo: 'smoke', total: '3' }]]])
    const res = await request(app).get('/api/granadas/contagem').set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body[0]).toEqual({ map: 'de_mirage', tipo: 'smoke', total: 3 })
  })
})

describe('POST /api/granadas', () => {
  const valido = {
    map: 'de_mirage', lado: 'T', tipo: 'smoke', titulo: 'Smoke janela',
    videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk', tecnica: 'jumpthrow',
    botao: 'esquerdo', passos: ['p1'], arremessoX: 0.2, arremessoY: 0.8, alvoX: 0.4, alvoY: 0.3,
  }

  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    expect((await request(app).post('/api/granadas').set('Cookie', cookieJogador).send(valido)).status).toBe(403)
  })

  it('admin cria', async () => {
    const { app, db } = appWith([['insert into lineups_curados', [{ id: 'g2' }]]])
    const res = await request(app).post('/api/granadas').set('Cookie', cookieAdmin).send(valido)
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('g2')
    const params = db.query.mock.calls[0][1]
    expect(params).toContain('de_mirage')
    expect(params).toContain('999')
  })

  it('video que nao e youtube: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/granadas').set('Cookie', cookieAdmin)
      .send({ ...valido, videoUrl: 'https://vimeo.com/123' })
    expect(res.status).toBe(400)
  })

  it('posicao fora de 0..1: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/granadas').set('Cookie', cookieAdmin)
      .send({ ...valido, alvoX: 1.5 })
    expect(res.status).toBe(400)
  })

  it('sem titulo: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/granadas').set('Cookie', cookieAdmin)
      .send({ ...valido, titulo: '  ' })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/granadas/:id', () => {
  it('admin edita e atualizado_em anda', async () => {
    const { app, db } = appWith([['update lineups_curados', [{ id: 'g1' }]]])
    const res = await request(app).patch('/api/granadas/g1').set('Cookie', cookieAdmin)
      .send({ map: 'de_mirage', lado: 'CT', tipo: 'flash', titulo: 'Flash CT',
        tecnica: 'normal', botao: 'direito', passos: [], arremessoX: 0.1, arremessoY: 0.1,
        alvoX: 0.2, alvoY: 0.2 })
    expect(res.status).toBe(200)
    expect(db.query.mock.calls[0][0]).toContain('atualizado_em = now()')
  })

  it('id inexistente: 404', async () => {
    const { app } = appWith([['update lineups_curados', []]])
    const res = await request(app).patch('/api/granadas/gx').set('Cookie', cookieAdmin)
      .send({ map: 'de_mirage', lado: 'CT', tipo: 'flash', titulo: 'x', tecnica: 'normal',
        botao: 'direito', passos: [], arremessoX: 0.1, arremessoY: 0.1, alvoX: 0.2, alvoY: 0.2 })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/granadas/:id', () => {
  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    expect((await request(app).delete('/api/granadas/g1').set('Cookie', cookieJogador)).status).toBe(403)
  })

  it('admin apaga', async () => {
    const { app, db } = appWith([['delete from lineups_curados', [{ id: 'g1' }]]])
    const res = await request(app).delete('/api/granadas/g1').set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    expect(db.query.mock.calls[0][1]).toEqual(['g1'])
  })
})

describe('GET /api/granadas/sugestoes', () => {
  it('jogador comum: 403 (insight e ferramenta de curadoria)', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/granadas/sugestoes?map=de_mirage').set('Cookie', cookieJogador)).status).toBe(403)
  })

  it('admin ve clusters agregados', async () => {
    const { app, db } = appWith([['from lineups', [{
      tipo: 'smoke', origem: 'pro', total: '12', alvo_x: '0.4', alvo_y: '0.3',
      arremesso_x: '0.2', arremesso_y: '0.8',
    }]]])
    const res = await request(app).get('/api/granadas/sugestoes?map=de_mirage').set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    expect(res.body[0]).toEqual({
      tipo: 'smoke', origem: 'pro', total: 12, alvoX: 0.4, alvoY: 0.3, arremessoX: 0.2, arremessoY: 0.8,
    })
    expect(db.query.mock.calls[0][1]).toEqual(['de_mirage'])
  })

  it('sem map valido: 400', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/granadas/sugestoes').set('Cookie', cookieAdmin)).status).toBe(400)
  })
})
```

- [ ] **Step 3: Rodar** `cd site/server && npm test` — os novos FALHAM (router não existe).

- [ ] **Step 4: Implementar** `site/server/src/routes/granadas.js`:

```js
import { Router } from 'express'
import { requireAdmin } from '../auth/middleware.js'

const LADOS = new Set(['T', 'CT'])
const TIPOS = new Set(['smoke', 'flash', 'he', 'molotov'])
const TECNICAS = new Set(['normal', 'jumpthrow', 'walkthrow', 'runthrow', 'run_jumpthrow'])
const BOTOES = new Set(['esquerdo', 'direito', 'esquerdo_direito'])
const MAP_RE = /^[a-z0-9_]+$/
const YOUTUBE_RE = /^https:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[A-Za-z0-9_-]{11}([&?#].*)?$/

function paraCamel(l) {
  return {
    id: l.id, map: l.map, lado: l.lado, tipo: l.tipo, titulo: l.titulo,
    descricao: l.descricao, videoUrl: l.video_url, tecnica: l.tecnica, botao: l.botao,
    passos: l.passos ?? [],
    arremessoX: Number(l.arremesso_x), arremessoY: Number(l.arremesso_y),
    alvoX: Number(l.alvo_x), alvoY: Number(l.alvo_y),
    criadoPor: l.criado_por, criadoEm: l.criado_em,
  }
}

function pos01(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null
}

// Valida o corpo de POST/PATCH; devolve {erro} ou {valores} prontos pra query.
function validarCorpo(body) {
  const map = String(body?.map ?? '')
  const lado = String(body?.lado ?? '')
  const tipo = String(body?.tipo ?? '')
  const titulo = String(body?.titulo ?? '').trim()
  const descricao = String(body?.descricao ?? '').trim() || null
  const videoUrl = String(body?.videoUrl ?? '').trim() || null
  const tecnica = String(body?.tecnica ?? 'normal')
  const botao = String(body?.botao ?? 'esquerdo')
  const passos = Array.isArray(body?.passos) ? body.passos.map(String).filter((p) => p.trim()) : null

  if (!MAP_RE.test(map)) return { erro: 'mapa inválido' }
  if (!LADOS.has(lado)) return { erro: 'lado deve ser T ou CT' }
  if (!TIPOS.has(tipo)) return { erro: 'tipo inválido' }
  if (!titulo) return { erro: 'título é obrigatório' }
  if (videoUrl && !YOUTUBE_RE.test(videoUrl)) return { erro: 'vídeo precisa ser um link do YouTube' }
  if (!TECNICAS.has(tecnica)) return { erro: 'técnica inválida' }
  if (!BOTOES.has(botao)) return { erro: 'botão inválido' }
  if (passos === null) return { erro: 'passos deve ser uma lista' }
  const arremessoX = pos01(body?.arremessoX)
  const arremessoY = pos01(body?.arremessoY)
  const alvoX = pos01(body?.alvoX)
  const alvoY = pos01(body?.alvoY)
  if ([arremessoX, arremessoY, alvoX, alvoY].some((v) => v === null)) {
    return { erro: 'posições precisam estar entre 0 e 1' }
  }
  return {
    valores: { map, lado, tipo, titulo, descricao, videoUrl, tecnica, botao, passos,
      arremessoX, arremessoY, alvoX, alvoY },
  }
}

export function createGranadasRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const cond = []
    const params = []
    const { map, lado, tipo } = req.query
    if (map && MAP_RE.test(map)) {
      params.push(map)
      cond.push(`map = $${params.length}`)
    }
    if (lado && LADOS.has(lado)) {
      params.push(lado)
      cond.push(`lado = $${params.length}`)
    }
    if (tipo && TIPOS.has(tipo)) {
      params.push(tipo)
      cond.push(`tipo = $${params.length}`)
    }
    const where = cond.length ? `where ${cond.join(' and ')}` : ''
    const { rows } = await db.query(
      `select id, map, lado, tipo, titulo, descricao, video_url, tecnica, botao, passos,
              arremesso_x, arremesso_y, alvo_x, alvo_y, criado_por, criado_em
       from lineups_curados ${where} order by criado_em desc limit 500`,
      params,
    )
    res.json(rows.map(paraCamel))
  })

  router.get('/contagem', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      'select map, tipo, count(*) as total from lineups_curados group by map, tipo',
    )
    res.json(rows.map((r) => ({ map: r.map, tipo: r.tipo, total: Number(r.total) })))
  })

  // Agrega a tabela auto-extraída (lineups) por célula de queda (grade de 1/40) pra
  // mostrar ao admin as granadas mais usadas de verdade nas demos (grupo e pro).
  router.get('/sugestoes', requireAuth, requireAdmin, async (req, res) => {
    const map = String(req.query?.map ?? '')
    if (!MAP_RE.test(map)) return res.status(400).json({ erro: 'map é obrigatório' })
    const { rows } = await db.query(
      `select tipo, origem, count(*) as total,
              round(avg(target_x)::numeric, 3) as alvo_x,
              round(avg(target_y)::numeric, 3) as alvo_y,
              round(avg(thrower_x)::numeric, 3) as arremesso_x,
              round(avg(thrower_y)::numeric, 3) as arremesso_y
       from lineups
       where map = $1
       group by tipo, origem, round(target_x::numeric * 40), round(target_y::numeric * 40)
       order by total desc
       limit 50`,
      [map],
    )
    res.json(rows.map((r) => ({
      tipo: r.tipo, origem: r.origem, total: Number(r.total),
      alvoX: Number(r.alvo_x), alvoY: Number(r.alvo_y),
      arremessoX: Number(r.arremesso_x), arremessoY: Number(r.arremesso_y),
    })))
  })

  router.post('/', requireAuth, requireAdmin, async (req, res) => {
    const { erro, valores } = validarCorpo(req.body)
    if (erro) return res.status(400).json({ erro })
    const v = valores
    const { rows } = await db.query(
      `insert into lineups_curados
         (map, lado, tipo, titulo, descricao, video_url, tecnica, botao, passos,
          arremesso_x, arremesso_y, alvo_x, alvo_y, criado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14)
       returning id`,
      [v.map, v.lado, v.tipo, v.titulo, v.descricao, v.videoUrl, v.tecnica, v.botao,
        JSON.stringify(v.passos), v.arremessoX, v.arremessoY, v.alvoX, v.alvoY,
        req.player.steamId],
    )
    res.status(201).json({ id: rows[0].id })
  })

  router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
    const { erro, valores } = validarCorpo(req.body)
    if (erro) return res.status(400).json({ erro })
    const v = valores
    const { rows } = await db.query(
      `update lineups_curados
       set map = $1, lado = $2, tipo = $3, titulo = $4, descricao = $5, video_url = $6,
           tecnica = $7, botao = $8, passos = $9::jsonb,
           arremesso_x = $10, arremesso_y = $11, alvo_x = $12, alvo_y = $13,
           atualizado_em = now()
       where id = $14
       returning id`,
      [v.map, v.lado, v.tipo, v.titulo, v.descricao, v.videoUrl, v.tecnica, v.botao,
        JSON.stringify(v.passos), v.arremessoX, v.arremessoY, v.alvoX, v.alvoY,
        req.params.id],
    )
    if (!rows.length) return res.status(404).json({ erro: 'granada não encontrada' })
    res.json({ ok: true })
  })

  router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
    const { rows } = await db.query(
      'delete from lineups_curados where id = $1 returning id',
      [req.params.id],
    )
    if (!rows.length) return res.status(404).json({ erro: 'granada não encontrada' })
    res.json({ ok: true })
  })

  return router
}
```

- [ ] **Step 5: Montar** em `site/server/src/app.js` — import `createGranadasRouter` de `./routes/granadas.js` e, junto dos outros mounts:

```js
  app.use('/api/granadas', createGranadasRouter({ db, requireAuth }))
```

- [ ] **Step 6: Rodar** `npm test` — TODOS passam (novos + antigos).

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: tabela lineups_curados + API /api/granadas (CRUD admin, contagem, sugestoes)"`

---

### Task 3: Client — helper de YouTube + landing "Explorar por Mapa"

**Files:**
- Create: `site/client/src/lib/youtube.js`
- Create: `site/client/src/components/granadas/ExplorarMapas.jsx`
- Modify: `site/client/src/pages/Granadas.jsx` (reescrever como orquestrador)

**Interfaces:**
- Consumes: `GET /api/granadas/contagem`; `nomeMapa` de `../lib/format.js`; imagens `/radars/{map}.png` (public dir, já existem).
- Produces: `extrairYoutubeId(url) -> string|null`; `<ExplorarMapas contagens onEscolher(map)>`; `Granadas.jsx` lê/escreve `?map=` via `useSearchParams` do react-router-dom.

- [ ] **Step 1:** `site/client/src/lib/youtube.js`:

```js
const YOUTUBE_ID_RE = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/

export function extrairYoutubeId(url) {
  if (!url) return null
  const m = YOUTUBE_ID_RE.exec(url)
  return m ? m[1] : null
}

export function thumbYoutube(url) {
  const id = extrairYoutubeId(url)
  return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null
}

export function embedYoutube(url) {
  const id = extrairYoutubeId(url)
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null
}
```

- [ ] **Step 2:** `site/client/src/components/granadas/ExplorarMapas.jsx`:

```jsx
import { nomeMapa } from '../../lib/format.js'

export const MAPAS_POOL = ['de_mirage', 'de_dust2', 'de_inferno', 'de_nuke', 'de_overpass', 'de_vertigo', 'de_ancient', 'de_anubis', 'de_train']

const ROTULO_TIPO = { smoke: 'Smoke', flash: 'Flash', molotov: 'Molotov', he: 'HE' }

export default function ExplorarMapas({ contagens, onEscolher }) {
  // contagens: [{map, tipo, total}] -> {map: {tipo: total}}
  const porMapa = {}
  for (const c of contagens ?? []) {
    porMapa[c.map] = { ...(porMapa[c.map] ?? {}), [c.tipo]: c.total }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">Explorar por mapa</h2>
        <p className="font-mono text-sm text-texto-fraco">Escolha um mapa pra ver os lineups do grupo.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MAPAS_POOL.map((m) => {
          const tipos = porMapa[m] ?? {}
          const vazio = Object.keys(tipos).length === 0
          return (
            <button
              key={m}
              onClick={() => onEscolher(m)}
              className={`panel-cut group relative overflow-hidden border border-borda bg-superficie text-left transition-colors hover:border-destaque ${vazio ? 'opacity-60' : ''}`}
            >
              <div
                className="h-36 bg-cover bg-center opacity-50 transition-opacity group-hover:opacity-70"
                style={{ backgroundImage: `url(/radars/${m}.png)` }}
              />
              <div className="absolute right-2 top-2 flex gap-1">
                {Object.entries(tipos).map(([tipo, total]) => (
                  <span key={tipo} className="panel-cut-sm border border-destaque/40 bg-fundo/80 px-1.5 py-0.5 font-mono text-[10px] uppercase text-destaque">
                    {ROTULO_TIPO[tipo]} {total}
                  </span>
                ))}
              </div>
              <p className="absolute bottom-2 left-3 font-display text-lg font-bold uppercase tracking-wide text-texto">
                {nomeMapa(m)}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 3:** Reescrever `site/client/src/pages/Granadas.jsx` como orquestrador (a página do mapa em si chega na Task 4 — por ora renderiza um placeholder mínimo que a Task 4 substitui):

```jsx
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ExplorarMapas, { MAPAS_POOL } from '../components/granadas/ExplorarMapas.jsx'

export default function Granadas() {
  const [searchParams, setSearchParams] = useSearchParams()
  const mapa = searchParams.get('map')
  const [contagens, setContagens] = useState(null)

  useEffect(() => {
    fetch('/api/granadas/contagem')
      .then((r) => r.json())
      .then(setContagens)
      .catch(() => setContagens([]))
  }, [])

  if (!mapa || !MAPAS_POOL.includes(mapa)) {
    return <ExplorarMapas contagens={contagens} onEscolher={(m) => setSearchParams({ map: m })} />
  }

  return (
    <div className="font-mono text-sm text-texto-fraco">
      Mapa selecionado: {mapa} (página do mapa chega na próxima task)
    </div>
  )
}
```

- [ ] **Step 4: Build** `cd site/client && npm run build` — limpo.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: landing Explorar por Mapa na biblioteca de Granadas"`

---

### Task 4: Client — página do mapa (sidebar + radar SVG + hover + modal de detalhe)

**Files:**
- Create: `site/client/src/components/granadas/RadarGranadas.jsx`
- Create: `site/client/src/components/granadas/DetalheGranada.jsx`
- Create: `site/client/src/components/granadas/PaginaMapa.jsx`
- Modify: `site/client/src/pages/Granadas.jsx` (trocar o placeholder pela PaginaMapa)

**Interfaces:**
- Consumes: `GET /api/granadas?map=&lado=&tipo=`; `thumbYoutube`/`embedYoutube` de `../../lib/youtube.js`; `nomeMapa` de `../../lib/format.js`.
- Produces: `<PaginaMapa mapa onVoltar onTrocarMapa>`; `<RadarGranadas mapa lineups selecionadaId onHover onSelecionar callouts nivelCallouts modoMarcacao onCliqueMarcacao>`; `<DetalheGranada granada onFechar>`. A Task 5 estende PaginaMapa/RadarGranadas com o modo admin — as props `modoMarcacao`/`onCliqueMarcacao` já nascem aqui (no read-only ficam `null`/ignoradas).

- [ ] **Step 1:** `site/client/src/components/granadas/RadarGranadas.jsx`:

```jsx
import { useRef, useState } from 'react'
import { thumbYoutube } from '../../lib/youtube.js'

const ROTULO_TECNICA = {
  normal: null, jumpthrow: 'lançar com salto', walkthrow: 'andando',
  runthrow: 'correndo', run_jumpthrow: 'correr + saltar',
}

// Ícone simples por tipo, desenhado direto em SVG (sem lib de ícones).
function MarcadorTipo({ tipo, x, y, ativo }) {
  const cor = ativo ? '#ffd166' : { smoke: '#d2d2d7', flash: '#fff8d6', he: '#ffaa3c', molotov: '#ff6e1e' }[tipo]
  if (tipo === 'smoke') {
    return <circle cx={x} cy={y} r={ativo ? 2.2 : 1.8} fill={cor} opacity="0.9" />
  }
  if (tipo === 'molotov') {
    return <path d={`M ${x} ${y - 2} L ${x + 1.6} ${y + 1.4} L ${x - 1.6} ${y + 1.4} Z`} fill={cor} opacity="0.9" />
  }
  if (tipo === 'flash') {
    return <rect x={x - 1.4} y={y - 1.4} width="2.8" height="2.8" transform={`rotate(45 ${x} ${y})`} fill={cor} opacity="0.9" />
  }
  return <circle cx={x} cy={y} r={ativo ? 2 : 1.5} fill="none" stroke={cor} strokeWidth="0.7" opacity="0.9" />
}

export default function RadarGranadas({
  mapa, lineups, selecionadaId, onSelecionar,
  callouts = [], nivelCallouts = 'sem',
  modoMarcacao = null, onCliqueMarcacao = null,
}) {
  const svgRef = useRef(null)
  const [hoverId, setHoverId] = useState(null)

  const ativa = lineups.find((l) => l.id === (hoverId ?? selecionadaId))
  const hovered = lineups.find((l) => l.id === hoverId)

  function coordsDoClique(e) {
    const rect = svgRef.current.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }
  }

  const calloutsVisiveis = nivelCallouts === 'sem' ? []
    : callouts.filter((c) => nivelCallouts === 'pro' || c.nivel === 'noob')

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        onClick={modoMarcacao && onCliqueMarcacao ? (e) => onCliqueMarcacao(coordsDoClique(e)) : undefined}
        className={`panel-cut block w-full border border-borda bg-fundo ${modoMarcacao ? 'cursor-crosshair' : ''}`}
        aria-label={`Radar de granadas`}
      >
        <image href={`/radars/${mapa}.png`} width="100" height="100" opacity="0.9" />

        {calloutsVisiveis.map((c) => (
          <text
            key={c.nome}
            x={c.x * 100}
            y={c.y * 100}
            textAnchor="middle"
            className="pointer-events-none select-none"
            fill="#e8e8ec"
            fontSize={c.nivel === 'noob' ? 2.6 : 1.8}
            opacity={c.nivel === 'noob' ? 0.9 : 0.7}
            style={{ paintOrder: 'stroke', stroke: '#0a0d12', strokeWidth: 0.5 }}
          >
            {c.nome}
          </text>
        ))}

        {ativa && (
          <>
            <line
              x1={ativa.arremessoX * 100} y1={ativa.arremessoY * 100}
              x2={ativa.alvoX * 100} y2={ativa.alvoY * 100}
              stroke="#ffd166" strokeWidth="0.5" strokeDasharray="1.5 1.5" opacity="0.9"
            />
            <circle cx={ativa.arremessoX * 100} cy={ativa.arremessoY * 100} r="1.6" fill="#ffd166" />
          </>
        )}

        {lineups.map((l) => (
          <g
            key={l.id}
            onMouseEnter={() => setHoverId(l.id)}
            onMouseLeave={() => setHoverId(null)}
            onClick={(e) => {
              if (modoMarcacao) return
              e.stopPropagation()
              onSelecionar(l)
            }}
            className="cursor-pointer"
          >
            {/* área de acerto maior que o ícone, senão o hover fica nervoso */}
            <circle cx={l.alvoX * 100} cy={l.alvoY * 100} r="3" fill="transparent" />
            <MarcadorTipo tipo={l.tipo} x={l.alvoX * 100} y={l.alvoY * 100} ativo={l.id === (hoverId ?? selecionadaId)} />
          </g>
        ))}

        {modoMarcacao?.arremesso && (
          <circle cx={modoMarcacao.arremesso.x * 100} cy={modoMarcacao.arremesso.y * 100} r="1.6" fill="#ffd166" />
        )}
        {modoMarcacao?.alvo && (
          <>
            <circle cx={modoMarcacao.alvo.x * 100} cy={modoMarcacao.alvo.y * 100} r="1.6" fill="#4fb6ff" />
            <line
              x1={modoMarcacao.arremesso.x * 100} y1={modoMarcacao.arremesso.y * 100}
              x2={modoMarcacao.alvo.x * 100} y2={modoMarcacao.alvo.y * 100}
              stroke="#ffd166" strokeWidth="0.5" strokeDasharray="1.5 1.5"
            />
          </>
        )}
      </svg>

      {hovered && !modoMarcacao && (
        <div
          className="panel-cut pointer-events-none absolute z-10 w-56 border border-borda bg-superficie p-3 shadow-lg"
          style={{
            left: `${Math.min(hovered.alvoX * 100, 62)}%`,
            top: `${Math.min(hovered.alvoY * 100 + 4, 78)}%`,
          }}
        >
          <p className="font-display text-sm font-semibold text-texto">{hovered.titulo}</p>
          {ROTULO_TECNICA[hovered.tecnica] && (
            <span className="mt-1 inline-block panel-cut-sm border border-borda px-1.5 py-0.5 font-mono text-[10px] uppercase text-texto-fraco">
              {ROTULO_TECNICA[hovered.tecnica]}
            </span>
          )}
          {thumbYoutube(hovered.videoUrl) && (
            <img src={thumbYoutube(hovered.videoUrl)} alt="" className="mt-2 w-full rounded" />
          )}
          <p className="mt-1 font-mono text-[10px] uppercase text-texto-fraco">clique pra ver vídeo e passos</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2:** `site/client/src/components/granadas/DetalheGranada.jsx`:

```jsx
import { useState } from 'react'
import { embedYoutube } from '../../lib/youtube.js'

const ROTULO_TECNICA = {
  normal: 'lançar parado', jumpthrow: 'lançar com salto', walkthrow: 'andando',
  runthrow: 'correndo', run_jumpthrow: 'correr + saltar',
}
const ROTULO_BOTAO = { esquerdo: 'botão esquerdo', direito: 'botão direito', esquerdo_direito: 'os dois botões' }

export default function DetalheGranada({ granada, onFechar, acoesAdmin = null }) {
  const [aba, setAba] = useState('video')
  const embed = embedYoutube(granada.videoUrl)
  const temPassos = (granada.passos ?? []).length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fundo/80 p-4" onClick={onFechar}>
      <div
        className="panel-cut max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-borda bg-superficie p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-xl font-bold text-texto">{granada.titulo}</h3>
          <button onClick={onFechar} className="font-mono text-sm uppercase text-texto-fraco hover:text-texto">fechar</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="panel-cut-sm border border-borda px-1.5 py-0.5 font-mono text-[10px] uppercase text-texto-fraco">{ROTULO_BOTAO[granada.botao]}</span>
          <span className="panel-cut-sm border border-borda px-1.5 py-0.5 font-mono text-[10px] uppercase text-texto-fraco">{ROTULO_TECNICA[granada.tecnica]}</span>
        </div>
        {granada.descricao && <p className="mt-3 font-mono text-sm text-texto-fraco">{granada.descricao}</p>}

        <div className="mt-4 flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
          {[['video', 'Vídeo'], ['passos', 'Passos']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setAba(v)}
              className={`flex-1 px-3 py-1.5 transition-colors ${aba === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {aba === 'video' && (
          embed ? (
            <div className="mt-3 aspect-video w-full">
              <iframe
                src={embed}
                title={granada.titulo}
                className="h-full w-full rounded border border-borda"
                allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <p className="mt-3 font-mono text-sm text-texto-fraco">Sem vídeo cadastrado pra esse lineup ainda.</p>
          )
        )}
        {aba === 'passos' && (
          temPassos ? (
            <ol className="mt-3 list-inside list-decimal space-y-1 font-mono text-sm text-texto">
              {granada.passos.map((p, i) => <li key={i}>{p}</li>)}
            </ol>
          ) : (
            <p className="mt-3 font-mono text-sm text-texto-fraco">Sem passos cadastrados.</p>
          )
        )}

        {acoesAdmin}
      </div>
    </div>
  )
}
```

- [ ] **Step 3:** `site/client/src/components/granadas/PaginaMapa.jsx`:

```jsx
import { useEffect, useMemo, useState } from 'react'
import { nomeMapa } from '../../lib/format.js'
import { MAPAS_POOL } from './ExplorarMapas.jsx'
import RadarGranadas from './RadarGranadas.jsx'
import DetalheGranada from './DetalheGranada.jsx'

const TIPOS = [['smoke', 'Smoke'], ['flash', 'Flash'], ['molotov', 'Molotov'], ['he', 'HE']]
const NIVEIS_CALLOUT = [['sem', 'Sem'], ['noob', 'Noob'], ['pro', 'Pro']]

export default function PaginaMapa({ mapa, onTrocarMapa }) {
  const [lado, setLado] = useState('T')
  const [tipo, setTipo] = useState('smoke')
  const [lineups, setLineups] = useState(null)
  const [selecionada, setSelecionada] = useState(null)
  const [nivelCallouts, setNivelCallouts] = useState('sem')
  const [callouts, setCallouts] = useState([])

  useEffect(() => {
    setLineups(null)
    fetch(`/api/granadas?map=${mapa}&lado=${lado}`)
      .then((r) => r.json())
      .then(setLineups)
      .catch(() => setLineups([]))
  }, [mapa, lado])

  useEffect(() => {
    setCallouts([])
    import(`../../data/callouts/${mapa}.json`)
      .then((m) => setCallouts(m.default ?? []))
      .catch(() => setCallouts([]))
  }, [mapa])

  const porTipo = useMemo(() => {
    const c = { smoke: 0, flash: 0, molotov: 0, he: 0 }
    for (const l of lineups ?? []) c[l.tipo] += 1
    return c
  }, [lineups])

  const visiveis = (lineups ?? []).filter((l) => l.tipo === tipo)

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="w-full space-y-4 lg:w-56">
        <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">{nomeMapa(mapa)}</h2>

        <div>
          <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Trocar mapa</p>
          <select
            value={mapa}
            onChange={(e) => onTrocarMapa(e.target.value)}
            className="w-full rounded border border-borda bg-superficie px-2 py-1 font-mono text-sm"
          >
            {MAPAS_POOL.map((m) => <option key={m} value={m}>{nomeMapa(m)}</option>)}
          </select>
        </div>

        <div>
          <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Trocar lado</p>
          <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
            {['T', 'CT'].map((v) => (
              <button
                key={v}
                onClick={() => setLado(v)}
                className={`flex-1 px-3 py-1.5 transition-colors ${lado === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Tipos de granada</p>
          <div className="space-y-1">
            {TIPOS.map(([v, label]) => (
              <button
                key={v}
                onClick={() => setTipo(v)}
                disabled={porTipo[v] === 0}
                className={`flex w-full items-center justify-between rounded border px-3 py-1.5 font-mono text-xs uppercase transition-colors ${
                  tipo === v ? 'border-destaque bg-destaque/10 text-destaque'
                    : porTipo[v] === 0 ? 'border-borda text-texto-fraco/40'
                    : 'border-borda text-texto-fraco hover:text-texto'
                }`}
              >
                <span>{label}</span>
                <span>{porTipo[v]}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Chamadas</p>
          <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
            {NIVEIS_CALLOUT.map(([v, label]) => (
              <button
                key={v}
                onClick={() => setNivelCallouts(v)}
                className={`flex-1 px-2 py-1.5 transition-colors ${nivelCallouts === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {!lineups && <p className="font-mono text-sm text-texto-fraco">Carregando…</p>}
        {lineups && (
          <RadarGranadas
            mapa={mapa}
            lineups={visiveis}
            selecionadaId={selecionada?.id}
            onSelecionar={setSelecionada}
            callouts={callouts}
            nivelCallouts={nivelCallouts}
          />
        )}
        {lineups?.length === 0 && (
          <p className="mt-2 font-mono text-sm text-texto-fraco">Nenhuma granada cadastrada pra esse lado ainda.</p>
        )}
      </div>

      {selecionada && <DetalheGranada granada={selecionada} onFechar={() => setSelecionada(null)} />}
    </div>
  )
}
```

- [ ] **Step 4:** Em `Granadas.jsx`, trocar o placeholder:

```jsx
import PaginaMapa from '../components/granadas/PaginaMapa.jsx'
// ...
  return <PaginaMapa mapa={mapa} onTrocarMapa={(m) => setSearchParams({ map: m })} />
```

- [ ] **Step 5:** Criar os 9 arquivos `site/client/src/data/callouts/{map}.json` VAZIOS (`[]`) — a Task 6 preenche; o import dinâmico não pode quebrar antes disso.

- [ ] **Step 6: Build** `cd site/client && npm run build` — limpo.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: pagina do mapa com radar SVG interativo, hover com preview e modal video/passos"`

---

### Task 5: Client — admin: modo de marcação + form criar/editar/excluir

**Files:**
- Create: `site/client/src/components/granadas/FormGranada.jsx`
- Modify: `site/client/src/components/granadas/PaginaMapa.jsx`

**Interfaces:**
- Consumes: `POST/PATCH/DELETE /api/granadas`; `useAuth()` — ver como `Shell.jsx`/`Admin.jsx` obtêm `jogador.isAdmin` hoje (contexto/hook existente; copie o mesmo mecanismo, ex.: prop `jogador` vinda do Shell ou hook `useJogador`) e use o MESMO.
- Produces: fluxo completo: botão "Adicionar granada" (admin) → clique 1 no radar = arremesso, clique 2 = alvo → form → POST → recarrega. Editar/excluir dentro do `DetalheGranada` via prop `acoesAdmin`.

- [ ] **Step 1:** `site/client/src/components/granadas/FormGranada.jsx`:

```jsx
import { useState } from 'react'

const TIPOS = [['smoke', 'Smoke'], ['flash', 'Flash'], ['molotov', 'Molotov'], ['he', 'HE']]
const TECNICAS = [
  ['normal', 'Normal (parado)'], ['jumpthrow', 'Lançar com salto'], ['walkthrow', 'Andando'],
  ['runthrow', 'Correndo'], ['run_jumpthrow', 'Correr + saltar'],
]
const BOTOES = [['esquerdo', 'Esquerdo'], ['direito', 'Direito'], ['esquerdo_direito', 'Os dois']]

export default function FormGranada({ mapa, lado, posicoes, inicial = null, onSalvo, onCancelar }) {
  const [titulo, setTitulo] = useState(inicial?.titulo ?? '')
  const [descricao, setDescricao] = useState(inicial?.descricao ?? '')
  const [videoUrl, setVideoUrl] = useState(inicial?.videoUrl ?? '')
  const [tipo, setTipo] = useState(inicial?.tipo ?? 'smoke')
  const [tecnica, setTecnica] = useState(inicial?.tecnica ?? 'normal')
  const [botao, setBotao] = useState(inicial?.botao ?? 'esquerdo')
  const [passosTexto, setPassosTexto] = useState((inicial?.passos ?? []).join('\n'))
  const [erro, setErro] = useState(null)
  const [salvando, setSalvando] = useState(false)

  async function salvar(e) {
    e.preventDefault()
    setErro(null)
    setSalvando(true)
    const corpo = {
      map: mapa, lado, tipo, titulo, descricao, videoUrl, tecnica, botao,
      passos: passosTexto.split('\n').map((p) => p.trim()).filter(Boolean),
      arremessoX: posicoes.arremesso.x, arremessoY: posicoes.arremesso.y,
      alvoX: posicoes.alvo.x, alvoY: posicoes.alvo.y,
    }
    const res = await fetch(inicial ? `/api/granadas/${inicial.id}` : '/api/granadas', {
      method: inicial ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    }).catch(() => null)
    setSalvando(false)
    if (res?.ok) return onSalvo()
    const body = await res?.json().catch(() => ({}))
    setErro(body?.erro ?? 'Erro ao salvar.')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fundo/80 p-4" onClick={onCancelar}>
      <form
        onSubmit={salvar}
        onClick={(e) => e.stopPropagation()}
        className="panel-cut max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto border border-borda bg-superficie p-5"
      >
        <h3 className="font-display text-lg font-bold uppercase text-texto">
          {inicial ? 'Editar granada' : 'Nova granada'} — {lado}
        </h3>
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título (ex.: Smoke janela da base)"
          className="w-full rounded border border-borda bg-fundo px-3 py-2 font-mono text-sm" />
        <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição (opcional)" rows={2}
          className="w-full rounded border border-borda bg-fundo px-3 py-2 font-mono text-sm" />
        <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="Link do YouTube (opcional)"
          className="w-full rounded border border-borda bg-fundo px-3 py-2 font-mono text-sm" />
        <div className="grid grid-cols-3 gap-2">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded border border-borda bg-fundo px-2 py-1.5 font-mono text-xs">
            {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={tecnica} onChange={(e) => setTecnica(e.target.value)} className="rounded border border-borda bg-fundo px-2 py-1.5 font-mono text-xs">
            {TECNICAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={botao} onChange={(e) => setBotao(e.target.value)} className="rounded border border-borda bg-fundo px-2 py-1.5 font-mono text-xs">
            {BOTOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <textarea value={passosTexto} onChange={(e) => setPassosTexto(e.target.value)} rows={4}
          placeholder={'Passos, um por linha:\nFique colado na quina da caixa\nMire no pixel acima da antena\nJumpthrow'}
          className="w-full rounded border border-borda bg-fundo px-3 py-2 font-mono text-sm" />
        {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancelar} className="px-4 py-2 font-mono text-xs uppercase text-texto-fraco hover:text-texto">Cancelar</button>
          <button type="submit" disabled={salvando}
            className="panel-cut-sm border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase text-fundo disabled:opacity-50">
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 2:** Em `PaginaMapa.jsx`, adicionar o fluxo admin. Estados novos:

```jsx
const [modoMarcacao, setModoMarcacao] = useState(null) // null | {arremesso?, alvo?}
const [formAberto, setFormAberto] = useState(null)     // null | {posicoes, inicial?}
```

Descobrir `isAdmin` pelo MESMO mecanismo que `Shell.jsx` usa (leia `Shell.jsx` antes: se o jogador vem por contexto/hook, use-o; se vem por prop, aceite prop). Botão na sidebar (só admin):

```jsx
{isAdmin && (
  <button
    onClick={() => setModoMarcacao({})}
    className="panel-cut-sm w-full border border-destaque bg-destaque px-3 py-2 font-display text-sm font-semibold uppercase text-fundo"
  >
    Adicionar granada
  </button>
)}
{modoMarcacao && (
  <p className="font-mono text-xs text-destaque">
    {!modoMarcacao.arremesso ? '1º clique: de onde LANÇA' : !modoMarcacao.alvo ? '2º clique: onde CAI' : ''}
    <button onClick={() => setModoMarcacao(null)} className="ml-2 underline">cancelar</button>
  </p>
)}
```

Handler de clique passado pro radar:

```jsx
function aoCliqueMarcacao(p) {
  if (!modoMarcacao.arremesso) return setModoMarcacao({ arremesso: p })
  const marcado = { ...modoMarcacao, alvo: p }
  setModoMarcacao(marcado)
  setFormAberto({ posicoes: marcado })
}
```

Passar `modoMarcacao={modoMarcacao}` e `onCliqueMarcacao={aoCliqueMarcacao}` pro `RadarGranadas`. Render do form e das ações de admin no detalhe:

```jsx
{formAberto && (
  <FormGranada
    mapa={mapa} lado={lado}
    posicoes={formAberto.posicoes}
    inicial={formAberto.inicial}
    onSalvo={() => { setFormAberto(null); setModoMarcacao(null); recarregar() }}
    onCancelar={() => { setFormAberto(null); setModoMarcacao(null) }}
  />
)}
```

(onde `recarregar()` é o fetch de lineups extraído do useEffect pra função nomeada, chamada pelos dois). No `DetalheGranada`, via prop `acoesAdmin`:

```jsx
{selecionada && (
  <DetalheGranada
    granada={selecionada}
    onFechar={() => setSelecionada(null)}
    acoesAdmin={isAdmin && (
      <div className="mt-4 flex justify-end gap-2 border-t border-borda pt-3">
        <button
          onClick={() => {
            setFormAberto({
              posicoes: { arremesso: { x: selecionada.arremessoX, y: selecionada.arremessoY }, alvo: { x: selecionada.alvoX, y: selecionada.alvoY } },
              inicial: selecionada,
            })
            setSelecionada(null)
          }}
          className="px-3 py-1.5 font-mono text-xs uppercase text-texto-fraco hover:text-texto"
        >Editar</button>
        <button
          onClick={async () => {
            const res = await fetch(`/api/granadas/${selecionada.id}`, { method: 'DELETE' }).catch(() => null)
            if (res?.ok) { setSelecionada(null); recarregar() }
          }}
          className="px-3 py-1.5 font-mono text-xs uppercase text-perigo hover:brightness-125"
        >Excluir</button>
      </div>
    )}
  />
)}
```

- [ ] **Step 3: Build** `cd site/client && npm run build` — limpo.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: admin cadastra granada clicando no radar (marcacao arremesso/queda + form)"`

---

### Task 6: Callouts dos 9 mapas

**Files:**
- Modify: `site/client/src/data/callouts/*.json` (os 9, criados vazios na Task 4)

**Interfaces:**
- Produces: JSON `[{nome, x, y, nivel}]` por mapa; x/y 0..1 no espaço do radar (mesma imagem `/radars/{map}.png`); nivel `"noob"` (regiões principais: sites, Mid, spawns, conexões-chave — 8 a 15 por mapa) ou `"pro"` (detalhados — mais 10 a 25 por mapa).

- [ ] **Step 1: Pesquisar dado pronto.** Tente, nesta ordem: (a) repo `boltgolt/boltobserv` no GitHub (contém configs de mapa com zonas/callouts em porcentagem do radar); (b) busca por "cs2 callouts json coordinates github". Se um dataset utilizável existir, converta pro nosso formato (atenção: se as coordenadas forem % da imagem do radar, já são o nosso 0..1 direto; se forem coordenadas de mundo, converta com `world_to_radar` da calibração em `coletor/src/coletor/replay.py`).

- [ ] **Step 2: Fallback manual (aceito pela spec).** Se não houver dataset confiável, escreva à mão pelo menos o nível "noob" dos 9 mapas (sites A/B, Mid, spawns T/CT e 4-8 regiões que qualquer jogador conhece — Mirage: Palace, Rampa, Varanda, Janela, Conector, Base T, Base CT, A, B, Meio; equivalentes nos outros mapas), estimando x/y contra a imagem do radar. `"pro"` pode ficar vazio nos mapas sem dataset.

- [ ] **Step 3: Validação visual OBRIGATÓRIA em 2 mapas.** Suba o preview (`.claude/launch.json` já tem o dev server) e confira de_mirage e de_dust2 com o toggle Noob: os rótulos precisam cair nas regiões certas do radar (Janela em cima da janela, etc.). Ajuste x/y até ficar certo. Tire screenshot como evidência no report.

- [ ] **Step 4: Build + commit** — `npm run build`; `git add -A && git commit -m "feat: callouts Noob/Pro nos radares (dados da comunidade/manuais)"`

---

### Task 7: Sugestões (admin) na página do mapa

**Files:**
- Modify: `site/client/src/components/granadas/PaginaMapa.jsx`

**Interfaces:**
- Consumes: `GET /api/granadas/sugestoes?map=` (Task 2); modo de marcação/form (Task 5).
- Produces: seção "Sugestões" na sidebar (só admin): busca sob demanda, lista até 15 clusters ("Smoke · 12x · pro"), hover destaca o marcador correspondente no radar (marcadores de sugestão são renderizados com opacidade menor e só enquanto a seção está aberta), botão "usar como base" abre o form já com as posições do cluster.

- [ ] **Step 1:** Estados e fetch sob demanda em `PaginaMapa.jsx`:

```jsx
const [sugestoes, setSugestoes] = useState(null)      // null = fechado, [] = aberto vazio
const [sugestaoHover, setSugestaoHover] = useState(null)

async function abrirSugestoes() {
  const res = await fetch(`/api/granadas/sugestoes?map=${mapa}`).catch(() => null)
  setSugestoes(res?.ok ? await res.json() : [])
}
```

Seção na sidebar (só admin), abaixo do botão Adicionar:

```jsx
{isAdmin && (
  <div>
    <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Sugestões (das demos)</p>
    {sugestoes === null ? (
      <button onClick={abrirSugestoes} className="w-full rounded border border-borda px-3 py-1.5 font-mono text-xs uppercase text-texto-fraco hover:text-texto">
        Ver granadas mais usadas
      </button>
    ) : sugestoes.length === 0 ? (
      <p className="font-mono text-xs text-texto-fraco">Nenhuma granada extraída das demos desse mapa ainda.</p>
    ) : (
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {sugestoes.slice(0, 15).map((s, i) => (
          <li
            key={i}
            onMouseEnter={() => setSugestaoHover(i)}
            onMouseLeave={() => setSugestaoHover(null)}
            className="flex items-center justify-between rounded border border-borda px-2 py-1 font-mono text-[11px] text-texto-fraco"
          >
            <span className="uppercase">{s.tipo} · {s.total}x · {s.origem}</span>
            <button
              onClick={() => setFormAberto({
                posicoes: { arremesso: { x: s.arremessoX, y: s.arremessoY }, alvo: { x: s.alvoX, y: s.alvoY } },
              })}
              className="text-destaque hover:brightness-125"
            >usar</button>
          </li>
        ))}
      </ul>
    )}
  </div>
)}
```

- [ ] **Step 2:** Marcadores de sugestão no radar — passe pro `RadarGranadas` uma prop nova `sugestoes` (default `[]`) e `sugestaoAtiva` (índice ou null); dentro do SVG, depois dos callouts e antes dos lineups:

```jsx
{sugestoes.map((s, i) => (
  <circle
    key={`sug-${i}`}
    cx={s.alvoX * 100} cy={s.alvoY * 100}
    r={sugestaoAtiva === i ? 2.4 : 1.4}
    fill="none" stroke="#8fd3a6" strokeWidth="0.5"
    opacity={sugestaoAtiva === i ? 1 : 0.5}
  />
))}
```

(passando `sugestoes={sugestoes ?? []}` e `sugestaoAtiva={sugestaoHover}` de PaginaMapa).

- [ ] **Step 3: Build** — limpo. **Commit** — `git add -A && git commit -m "feat: sugestoes de granadas mais usadas (das demos) pro admin curar"`

---

### Task 8: Verificação integrada

**Files:** nenhum novo (só correções que a verificação apontar).

- [ ] **Step 1:** Suítes completas: `cd coletor && python -m pytest -q` (todas), `cd site/server && npm test` (todas), `cd site/client && npm run build`.
- [ ] **Step 2:** Preview no browser (dev server via launch.json): landing → escolher Mirage → toggle T/CT → hover num marcador (se houver dado) → modal → callouts Noob. Sem login admin dá pra verificar o read-only; o fluxo admin é verificado pelo usuário em produção.
- [ ] **Step 3:** Controlador (não o implementador): aplicar migration 0016 em produção, rodar workflow com `configurar_cors=true`, push, verificar deploy Vercel READY, avisar o usuário pra testar upload + cadastro de granada.
