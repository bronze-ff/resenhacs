# Resenha — Fase 1 (Fundação) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repo funcionando com API Express + login via Steam (whitelist), schema inicial no Postgres (Supabase) e shell React dark em PT-BR — amigos conseguem logar e ver o esqueleto do site.

**Architecture:** Monorepo com `site/server` (Express, ESM, injeção de dependências para testabilidade) e `site/client` (React + Vite + Tailwind v4, proxy `/api` → 3001 em dev, servido pelo Express em produção). Banco Postgres no Supabase acessado via `pg` direto (sem ORM); migrações SQL versionadas em `supabase/migrations/`. Autenticação: Steam OpenID 2.0 verificado manualmente (sem passport) → JWT em cookie httpOnly. O schema do banco é o contrato com o Coletor (Fase 2).

**Tech Stack:** Node ≥ 22.9, Express 4, pg 8, jsonwebtoken 9, cookie-parser; React 19, Vite 7, react-router-dom 7, Tailwind CSS 4; vitest + supertest (server), vitest + jsdom + testing-library (client).

## Global Constraints

- Node ≥ 22.9 (usamos `--env-file-if-exists=.env`); **ESM em todo o server** (`"type": "module"`)
- **express@^4.21** — NÃO usar Express 5
- **Sem TypeScript**: JS no server, JSX no client
- UI em PT-BR; jargão de CS fica em inglês (ace, clutch, entry)
- Cookie de sessão: `resenha_token` — httpOnly, `sameSite: 'lax'`, `secure` só em produção, validade 7 dias
- JWT HS256, payload `{ steamId, isAdmin }`, expiração `7d`
- Portas: API **3001**, Vite dev **5173**; `APP_URL` default `http://localhost:5173`
- Testes NUNCA tocam banco/rede reais — `db`, `verifySteamLogin` e `fetchPersona` são injetados no `createApp`
- Ambiente de dev é Windows/PowerShell: scripts npm não podem usar comandos unix-only
- Nomes de tabelas/colunas em inglês snake_case; times de uma Partida são `'A'` e `'B'`

---

### Task 1: Servidor Express base + repo

**Files:**
- Create: `.gitignore`, `site/server/package.json`, `site/server/src/config.js`, `site/server/src/app.js`, `site/server/test/app.test.js`

**Interfaces:**
- Produces: `loadConfig(env)` → `{ databaseUrl, jwtSecret, steamApiKey, appUrl, port, isProduction }` (lança `Error` listando variáveis faltando); `createApp({ config, db, verifySteamLogin, fetchPersona, staticDir })` → app Express (deps opcionais nesta task, usadas nas Tasks 4-5)

- [ ] **Step 1: Inicializar repo e estrutura**

```powershell
git init
```

`.gitignore` na raiz:

```gitignore
node_modules/
dist/
.env
*.local
__pycache__/
.venv/
```

`site/server/package.json`:

```json
{
  "name": "resenha-server",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.9" },
  "scripts": {
    "dev": "node --watch --env-file-if-exists=.env src/index.js",
    "start": "node --env-file-if-exists=.env src/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "cookie-parser": "^1.4.7",
    "express": "^4.21.2",
    "jsonwebtoken": "^9.0.2",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "supertest": "^7.0.0",
    "vitest": "^3.0.0"
  }
}
```

Rodar: `npm install` dentro de `site/server`.

- [ ] **Step 2: Escrever os testes que falham**

`site/server/test/app.test.js`:

```js
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

export const testConfig = {
  jwtSecret: 'segredo-de-teste',
  appUrl: 'http://localhost:5173',
  isProduction: false,
}

describe('loadConfig', () => {
  it('lança erro listando variáveis faltando', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/)
  })

  it('monta config a partir do env', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://x',
      JWT_SECRET: 's',
      STEAM_API_KEY: 'k',
    })
    expect(config.port).toBe(3001)
    expect(config.appUrl).toBe('http://localhost:5173')
    expect(config.isProduction).toBe(false)
  })
})

describe('GET /api/health', () => {
  it('responde ok', async () => {
    const app = createApp({ config: testConfig })
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test` (em `site/server`)
Expected: FAIL — `Cannot find module '../src/app.js'`

- [ ] **Step 4: Implementar**

`site/server/src/config.js`:

```js
export function loadConfig(env = process.env) {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'STEAM_API_KEY']
  const missing = required.filter((k) => !env[k])
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente faltando: ${missing.join(', ')}`)
  }
  return {
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
    steamApiKey: env.STEAM_API_KEY,
    appUrl: env.APP_URL ?? 'http://localhost:5173',
    port: Number(env.PORT ?? 3001),
    isProduction: env.NODE_ENV === 'production',
  }
}
```

`site/server/src/app.js` (versão desta task; Tasks 4, 5 e 7 adicionam rotas e static):

```js
import express from 'express'
import cookieParser from 'cookie-parser'

export function createApp({ config, db, verifySteamLogin, fetchPersona, staticDir } = {}) {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())

  app.get('/api/health', (req, res) => res.json({ ok: true }))

  return app
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: PASS (3 testes)

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat: servidor express base com health check e config"
```

---

### Task 2: Schema inicial do banco + acesso via pg

**Files:**
- Create: `supabase/migrations/0001_schema_inicial.sql`, `site/server/src/db.js`, `site/server/scripts/seed-admin.js`, `site/server/test/db.test.js`

**Interfaces:**
- Produces: `createDb(connectionString)` → `{ query(text, params) → Promise<{ rows }>, close() }`; tabelas `players`, `matches`, `match_players`, `rounds`, `highlights`, `clips`; view `synergy_pairs(steam_id_1, steam_id_2, partidas, vitorias)`. Este schema é o contrato com o Coletor (Fase 2) e com as telas (Fase 3).

- [ ] **Step 1: Escrever a migração completa**

`supabase/migrations/0001_schema_inicial.sql`:

```sql
-- Resenha: schema inicial (Fase 1)
-- Jogador = membro whitelistado; Participante = qualquer um dos 10 numa Partida (linha em match_players).

create table players (
  steam_id64      text primary key,
  nick            text not null default '',
  avatar_url      text,
  is_admin        boolean not null default false,
  match_auth_code text,          -- código de autenticação de histórico (Steam), usado pelo Coletor
  last_share_code text,          -- último share code conhecido da corrente
  created_at      timestamptz not null default now()
);

create table matches (
  id               uuid primary key default gen_random_uuid(),
  share_code       text unique,
  source           text not null default 'valve_mm',   -- valve_mm | faceit | gc | upload
  map              text,
  played_at        timestamptz,
  duration_seconds integer,
  score_a          integer,
  score_b          integer,
  demo_url         text,                                -- .dem arquivado no R2 (ADR-0002)
  replay_url       text,                                -- frames do Replay 2D no R2 (Fase 4)
  status           text not null default 'pending',     -- pending | parsed | failed | expired
  created_at       timestamptz not null default now()
);

create table match_players (
  match_id       uuid not null references matches(id) on delete cascade,
  steam_id64     text not null,
  nick           text not null default '',
  team           text not null check (team in ('A', 'B')),
  kills          integer not null default 0,
  deaths         integer not null default 0,
  assists        integer not null default 0,
  headshot_kills integer not null default 0,
  damage         integer not null default 0,
  rounds_played  integer not null default 0,
  rating         numeric(4, 2),
  won            boolean,
  is_tracked     boolean not null default false,  -- cache informativo "é Jogador" (o Coletor seta); a Sinergia NÃO depende disto, usa join em players
  primary key (match_id, steam_id64)
);

create table rounds (
  match_id     uuid not null references matches(id) on delete cascade,
  round_number integer not null,
  winner_team  text check (winner_team in ('A', 'B')),
  win_reason   text,
  primary key (match_id, round_number)
);

create table highlights (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references matches(id) on delete cascade,
  steam_id64   text not null,
  round_number integer not null,
  kind         text not null,               -- ace | quad | triple | clutch_1v3 | clutch_1v4 | clutch_1v5
  description  text not null default '',
  created_at   timestamptz not null default now()
);

create table clips (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid references matches(id) on delete set null,
  highlight_id uuid references highlights(id) on delete set null,
  steam_id64   text not null,               -- de quem é a jogada
  url          text not null,
  provider     text not null default 'other',  -- allstar | medal | youtube | other
  title        text not null default '',
  added_by     text not null references players(steam_id64),
  created_at   timestamptz not null default now()
);

-- Nonces de OpenID já usados, para impedir replay do login Steam (ver Task 3/4).
create table used_openid_nonces (
  nonce   text primary key,
  seen_at timestamptz not null default now()
);

create index idx_match_players_steam on match_players (steam_id64);
create index idx_matches_played_at on matches (played_at desc);
create index idx_highlights_match on highlights (match_id);
create index idx_clips_match on clips (match_id);

-- Sinergia: duplas de Jogadores no mesmo time (a.won = b.won, basta contar pelo lado A).
-- Fonte de verdade de "é Jogador" é a tabela players (join), NÃO a flag is_tracked:
-- quem entra na whitelist depois tem o histórico contado retroativamente.
-- security_invoker é OBRIGATÓRIO: view comum roda com privilégios do dono e ignoraria
-- o RLS das tabelas base, vazando dados pela API PostgREST pública do Supabase.
-- REGRA para toda view futura (Fases 3-4): sempre security_invoker + revoke de anon/authenticated.
create view synergy_pairs with (security_invoker = true) as
select
  a.steam_id64                    as steam_id_1,
  b.steam_id64                    as steam_id_2,
  count(*)                        as partidas,
  count(*) filter (where a.won)   as vitorias
from match_players a
join match_players b
  on  a.match_id = b.match_id
  and a.team = b.team
  and a.steam_id64 < b.steam_id64
join players p1 on p1.steam_id64 = a.steam_id64
join players p2 on p2.steam_id64 = b.steam_id64
group by a.steam_id64, b.steam_id64;

-- O site acessa o banco pela conexão direta (role postgres); a API PostgREST pública
-- do Supabase não deve expor nada: RLS ligado em tudo, sem policies = negar por padrão,
-- E revogação explícita dos grants default que o Supabase dá a anon/authenticated.
alter table players enable row level security;
alter table matches enable row level security;
alter table match_players enable row level security;
alter table rounds enable row level security;
alter table highlights enable row level security;
alter table clips enable row level security;
alter table used_openid_nonces enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on synergy_pairs from anon, authenticated;
```

- [ ] **Step 2: Aplicar a migração no projeto Supabase**

Via MCP do Supabase (`apply_migration` com name `schema_inicial`) no projeto **resenhacs** (`hrpgbrfqxqjxpsjeymec`), OU manualmente: SQL Editor do Supabase → colar o arquivo → Run.

Verificação: `select count(*) from players;` → `0` (tabela existe, vazia). Rodar também o `get_advisors` (security) do MCP e confirmar que NÃO há alerta de "Security Definer View" para `synergy_pairs`.

- [ ] **Step 3: Escrever teste do módulo db (sem banco real)**

`site/server/test/db.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { createDb } from '../src/db.js'

describe('createDb', () => {
  it('expõe query e close', () => {
    const db = createDb('postgres://usuario:senha@localhost:5432/fake')
    expect(typeof db.query).toBe('function')
    expect(typeof db.close).toBe('function')
    return db.close()
  })
})
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/db.js'`

- [ ] **Step 5: Implementar**

`site/server/src/db.js`:

```js
import pg from 'pg'

export function createDb(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 5 })
  return {
    query: (text, params) => pool.query(text, params),
    close: () => pool.end(),
  }
}
```

`site/server/scripts/seed-admin.js` (uso: `node --env-file-if-exists=.env scripts/seed-admin.js 76561198000000000`):

```js
import { createDb } from '../src/db.js'

const steamId = process.argv[2]
if (!/^\d{17}$/.test(steamId ?? '')) {
  console.error('Uso: node scripts/seed-admin.js <steam_id64 com 17 dígitos>')
  process.exit(1)
}

const db = createDb(process.env.DATABASE_URL)
await db.query(
  `insert into players (steam_id64, is_admin) values ($1, true)
   on conflict (steam_id64) do update set is_admin = true`,
  [steamId],
)
console.log(`Jogador ${steamId} agora é admin.`)
await db.close()
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "feat: schema inicial do banco (partidas, jogadores, highlights, sinergia) e acesso pg"
```

---

### Task 3: Steam OpenID (funções puras)

**Files:**
- Create: `site/server/src/steam/openid.js`, `site/server/test/openid.test.js`

**Interfaces:**
- Produces: `buildSteamRedirectUrl(appUrl)` → string; `extractSteamId(claimedId)` → `'7656...'` | `null`; `verifySteamAssertion(query, appUrl, fetchImpl?, now?)` → `Promise<{ steamId, nonce } | null>` (valida `openid.mode`, `openid.return_to` e o frescor do `response_nonce` antes de aceitar). A Task 4 injeta `verifySteamAssertion` como `verifySteamLogin` e persiste o `nonce` para impedir replay.

- [ ] **Step 1: Escrever os testes que falham**

`site/server/test/openid.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import {
  buildSteamRedirectUrl,
  extractSteamId,
  verifySteamAssertion,
} from '../src/steam/openid.js'

describe('buildSteamRedirectUrl', () => {
  it('aponta para o login da Steam com return_to e realm corretos', () => {
    const url = new URL(buildSteamRedirectUrl('http://localhost:5173'))
    expect(url.origin + url.pathname).toBe('https://steamcommunity.com/openid/login')
    expect(url.searchParams.get('openid.mode')).toBe('checkid_setup')
    expect(url.searchParams.get('openid.return_to')).toBe(
      'http://localhost:5173/api/auth/steam/return',
    )
    expect(url.searchParams.get('openid.realm')).toBe('http://localhost:5173')
    expect(url.searchParams.get('openid.claimed_id')).toBe(
      'http://specs.openid.net/auth/2.0/identifier_select',
    )
  })
})

describe('extractSteamId', () => {
  it('extrai o steam_id64 do claimed_id', () => {
    expect(extractSteamId('https://steamcommunity.com/openid/id/76561198012345678')).toBe(
      '76561198012345678',
    )
  })

  it('rejeita formatos inesperados', () => {
    expect(extractSteamId('https://malicioso.com/openid/id/76561198012345678')).toBeNull()
    expect(extractSteamId('https://steamcommunity.com/openid/id/abc')).toBeNull()
    expect(extractSteamId(undefined)).toBeNull()
  })
})

describe('verifySteamAssertion', () => {
  const appUrl = 'http://localhost:5173'
  const now = Date.parse('2024-01-02T03:04:05Z')
  const query = {
    'openid.mode': 'id_res',
    'openid.return_to': `${appUrl}/api/auth/steam/return`,
    'openid.response_nonce': '2024-01-02T03:04:05Zabc123',
    'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198012345678',
    'openid.sig': 'assinatura',
  }

  function fetchValido() {
    return vi.fn().mockResolvedValue({
      text: async () => 'ns:http://specs.openid.net/auth/2.0\nis_valid:true\n',
    })
  }

  it('retorna steamId e nonce quando tudo confere', async () => {
    const fakeFetch = fetchValido()
    const res = await verifySteamAssertion(query, appUrl, fakeFetch, now)
    expect(res).toEqual({ steamId: '76561198012345678', nonce: '2024-01-02T03:04:05Zabc123' })
    const [url, opts] = fakeFetch.mock.calls[0]
    expect(url).toBe('https://steamcommunity.com/openid/login')
    expect(opts.body).toContain('openid.mode=check_authentication')
  })

  it('rejeita mode diferente de id_res sem nem chamar a Steam', async () => {
    const fakeFetch = fetchValido()
    const res = await verifySteamAssertion(
      { ...query, 'openid.mode': 'cancel' },
      appUrl,
      fakeFetch,
      now,
    )
    expect(res).toBeNull()
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it('rejeita return_to de outra origem (forjamento)', async () => {
    const fakeFetch = fetchValido()
    const res = await verifySteamAssertion(
      { ...query, 'openid.return_to': 'https://malicioso.com/api/auth/steam/return' },
      appUrl,
      fakeFetch,
      now,
    )
    expect(res).toBeNull()
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it('rejeita nonce fora da janela de 5 minutos (replay antigo)', async () => {
    const fakeFetch = fetchValido()
    const quinzeMinDepois = Date.parse('2024-01-02T03:20:00Z')
    expect(await verifySteamAssertion(query, appUrl, fakeFetch, quinzeMinDepois)).toBeNull()
  })

  it('retorna null quando a Steam responde is_valid:false', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ text: async () => 'is_valid:false\n' })
    expect(await verifySteamAssertion(query, appUrl, fakeFetch, now)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/steam/openid.js'`

- [ ] **Step 3: Implementar**

`site/server/src/steam/openid.js`:

```js
const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login'

export function buildSteamRedirectUrl(appUrl) {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${appUrl}/api/auth/steam/return`,
    'openid.realm': appUrl,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  })
  return `${STEAM_OPENID_URL}?${params}`
}

export function extractSteamId(claimedId) {
  const match = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(claimedId ?? '')
  return match ? match[1] : null
}

const NONCE_MAX_AGE_MS = 5 * 60 * 1000

// O response_nonce da Steam começa com um timestamp ISO 8601 (ex.: 2024-01-02T03:04:05Zxyz).
function nonceEstaFresco(nonce, now) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/.exec(nonce ?? '')
  if (!match) return false
  const emitido = Date.parse(match[1])
  if (Number.isNaN(emitido)) return false
  const idade = now - emitido
  return idade >= -NONCE_MAX_AGE_MS && idade <= NONCE_MAX_AGE_MS
}

export async function verifySteamAssertion(query, appUrl, fetchImpl = fetch, now = Date.now()) {
  // Verificações da spec OpenID 2.0 exigidas do Relying Party (feitas ANTES de falar com a Steam).
  if (query?.['openid.mode'] !== 'id_res') return null
  const returnTo = query['openid.return_to'] ?? ''
  if (!returnTo.startsWith(`${appUrl}/api/auth/steam/return`)) return null
  const nonce = query['openid.response_nonce']
  if (!nonceEstaFresco(nonce, now)) return null

  const params = new URLSearchParams({ ...query, 'openid.mode': 'check_authentication' })
  const res = await fetchImpl(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const text = await res.text()
  if (!/is_valid\s*:\s*true/.test(text)) return null

  const steamId = extractSteamId(query['openid.claimed_id'])
  if (!steamId) return null
  return { steamId, nonce }
}
```

A unicidade do nonce (impedir reenvio da mesma URL de retorno dentro da janela) é garantida na rota da Task 4, gravando o nonce em `used_openid_nonces` — o frescor acima limita a janela, a persistência elimina o replay.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat: verificação steam openid com funções puras testáveis"
```

---

### Task 4: Autenticação completa (JWT + whitelist + rotas)

**Files:**
- Create: `site/server/src/auth/jwt.js`, `site/server/src/auth/middleware.js`, `site/server/src/routes/auth.js`, `site/server/src/steam/api.js`, `site/server/test/auth.test.js`
- Modify: `site/server/src/app.js`

**Interfaces:**
- Consumes: `buildSteamRedirectUrl`, `verifySteamAssertion` (Task 3, agora resolvendo `{ steamId, nonce }`); `createApp` (Task 1)
- Produces: `signToken({ steamId, isAdmin }, secret)`; `verifyToken(token, secret)` → payload | null; `createRequireAuth(jwtSecret)` → middleware que popula `req.player = { steamId, isAdmin }`; `requireAdmin`; `createFetchPersona(apiKey, fetchImpl?)` → `fetchPersona(steamId)` → `{ nick, avatarUrl } | null`; rotas `GET /api/auth/steam`, `GET /api/auth/steam/return` (grava o nonce em `used_openid_nonces` para bloquear replay), `GET /api/auth/me`, `POST /api/auth/logout`

- [ ] **Step 1: Escrever os testes que falham**

`site/server/test/auth.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken, verifyToken } from '../src/auth/jwt.js'

const config = {
  jwtSecret: 'segredo-de-teste',
  appUrl: 'http://localhost:5173',
  isProduction: false,
}

const JOGADOR = {
  steam_id64: '76561198012345678',
  nick: 'fih',
  avatar_url: 'https://avatars.steamstatic.com/x.jpg',
  is_admin: true,
}

// Fake que roteia por SQL: players devolve `rows`; o insert de nonce devolve
// rowCount 1 (nonce novo) ou 0 (replay); qualquer outra query devolve vazio.
function fakeDb({ rows = [], nonceReplay = false } = {}) {
  return {
    query: vi.fn().mockImplementation((sql) => {
      if (sql.includes('used_openid_nonces')) {
        return Promise.resolve({ rows: nonceReplay ? [] : [{ nonce: 'n' }], rowCount: nonceReplay ? 0 : 1 })
      }
      if (sql.includes('from players')) return Promise.resolve({ rows })
      return Promise.resolve({ rows: [] })
    }),
  }
}

function appWith({ rows = [], nonceReplay = false, login = { steamId: JOGADOR.steam_id64, nonce: 'n1' } } = {}) {
  const db = fakeDb({ rows, nonceReplay })
  const app = createApp({
    config,
    db,
    verifySteamLogin: vi.fn().mockResolvedValue(login),
    fetchPersona: vi.fn().mockResolvedValue({ nick: 'fih', avatarUrl: 'https://a/x.jpg' }),
  })
  return { app, db }
}

function cookieFor(payload = { steamId: JOGADOR.steam_id64, isAdmin: true }) {
  return `resenha_token=${signToken(payload, config.jwtSecret)}`
}

describe('jwt', () => {
  it('assina e verifica payload', () => {
    const token = signToken({ steamId: '765', isAdmin: false }, 's')
    expect(verifyToken(token, 's')).toMatchObject({ steamId: '765', isAdmin: false })
  })

  it('retorna null para token inválido ou segredo errado', () => {
    expect(verifyToken('lixo', 's')).toBeNull()
    expect(verifyToken(signToken({ steamId: '765', isAdmin: false }, 'a'), 'b')).toBeNull()
  })
})

describe('GET /api/auth/steam', () => {
  it('redireciona para a Steam', async () => {
    const { app } = appWith()
    const res = await request(app).get('/api/auth/steam')
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('https://steamcommunity.com/openid/login')
  })
})

describe('GET /api/auth/steam/return', () => {
  it('whitelistado: seta cookie e redireciona para o app', async () => {
    const { app } = appWith({ rows: [JOGADOR] })
    const res = await request(app).get('/api/auth/steam/return?openid.mode=id_res')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(config.appUrl)
    const cookie = res.headers['set-cookie'][0]
    expect(cookie).toContain('resenha_token=')
    expect(cookie).toContain('HttpOnly')
  })

  it('fora da whitelist: redireciona para acesso-negado sem cookie', async () => {
    const { app } = appWith({ rows: [] })
    const res = await request(app).get('/api/auth/steam/return?openid.mode=id_res')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(`${config.appUrl}/acesso-negado`)
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('assinatura inválida: redireciona com erro', async () => {
    const { app } = appWith({ login: null })
    const res = await request(app).get('/api/auth/steam/return?openid.mode=id_res')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(`${config.appUrl}/?erro=login-invalido`)
  })

  it('nonce reutilizado (replay): redireciona com erro sem cookie', async () => {
    const { app } = appWith({ rows: [JOGADOR], nonceReplay: true })
    const res = await request(app).get('/api/auth/steam/return?openid.mode=id_res')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(`${config.appUrl}/?erro=login-invalido`)
    expect(res.headers['set-cookie']).toBeUndefined()
  })
})

describe('GET /api/auth/me', () => {
  it('sem cookie: 401', async () => {
    const { app } = appWith()
    expect((await request(app).get('/api/auth/me')).status).toBe(401)
  })

  it('com cookie válido: retorna o jogador', async () => {
    const { app } = appWith({ rows: [JOGADOR] })
    const res = await request(app).get('/api/auth/me').set('Cookie', cookieFor())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      steamId: JOGADOR.steam_id64,
      nick: 'fih',
      avatarUrl: JOGADOR.avatar_url,
      isAdmin: true,
    })
  })
})

describe('POST /api/auth/logout', () => {
  it('limpa o cookie', async () => {
    const { app } = appWith()
    const res = await request(app).post('/api/auth/logout')
    expect(res.status).toBe(200)
    expect(res.headers['set-cookie'][0]).toContain('resenha_token=;')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — módulos de auth inexistentes

- [ ] **Step 3: Implementar**

`site/server/src/auth/jwt.js`:

```js
import jwt from 'jsonwebtoken'

export function signToken({ steamId, isAdmin }, secret) {
  return jwt.sign({ steamId, isAdmin }, secret, { expiresIn: '7d' })
}

export function verifyToken(token, secret) {
  try {
    return jwt.verify(token, secret)
  } catch {
    return null
  }
}
```

`site/server/src/auth/middleware.js`:

```js
import { verifyToken } from './jwt.js'

export function createRequireAuth(jwtSecret) {
  return function requireAuth(req, res, next) {
    const payload = verifyToken(req.cookies?.resenha_token, jwtSecret)
    if (!payload) return res.status(401).json({ erro: 'Não autenticado' })
    req.player = { steamId: payload.steamId, isAdmin: Boolean(payload.isAdmin) }
    next()
  }
}

export function requireAdmin(req, res, next) {
  if (!req.player?.isAdmin) return res.status(403).json({ erro: 'Apenas administradores' })
  next()
}
```

`site/server/src/steam/api.js`:

```js
export function createFetchPersona(apiKey, fetchImpl = fetch) {
  return async function fetchPersona(steamId) {
    try {
      const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId}`
      const res = await fetchImpl(url)
      if (!res.ok) return null
      const data = await res.json()
      const p = data?.response?.players?.[0]
      if (!p) return null
      return { nick: p.personaname ?? '', avatarUrl: p.avatarfull ?? null }
    } catch {
      return null
    }
  }
}
```

`site/server/src/routes/auth.js`:

```js
import { Router } from 'express'
import { buildSteamRedirectUrl } from '../steam/openid.js'
import { signToken } from '../auth/jwt.js'

export function createAuthRouter({ config, db, verifySteamLogin, fetchPersona, requireAuth }) {
  const router = Router()

  router.get('/steam', (req, res) => {
    res.redirect(buildSteamRedirectUrl(config.appUrl))
  })

  router.get('/steam/return', async (req, res) => {
    const login = await verifySteamLogin(req.query, config.appUrl)
    if (!login) return res.redirect(`${config.appUrl}/?erro=login-invalido`)
    const { steamId, nonce } = login

    // Replay: o nonce só vale uma vez. insert-on-conflict; se já existia, rowCount = 0.
    const nonceInsert = await db.query(
      'insert into used_openid_nonces (nonce) values ($1) on conflict (nonce) do nothing returning nonce',
      [nonce],
    )
    if (nonceInsert.rowCount === 0) return res.redirect(`${config.appUrl}/?erro=login-invalido`)

    const { rows } = await db.query(
      'select steam_id64, is_admin from players where steam_id64 = $1',
      [steamId],
    )
    if (rows.length === 0) return res.redirect(`${config.appUrl}/acesso-negado`)

    const persona = await fetchPersona(steamId)
    if (persona) {
      await db.query('update players set nick = $2, avatar_url = $3 where steam_id64 = $1', [
        steamId,
        persona.nick,
        persona.avatarUrl,
      ])
    }

    const token = signToken({ steamId, isAdmin: rows[0].is_admin }, config.jwtSecret)
    res.cookie('resenha_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
    res.redirect(config.appUrl)
  })

  router.get('/me', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      'select steam_id64, nick, avatar_url, is_admin from players where steam_id64 = $1',
      [req.player.steamId],
    )
    if (rows.length === 0) return res.status(401).json({ erro: 'Jogador não encontrado' })
    const p = rows[0]
    res.json({ steamId: p.steam_id64, nick: p.nick, avatarUrl: p.avatar_url, isAdmin: p.is_admin })
  })

  router.post('/logout', (req, res) => {
    res.clearCookie('resenha_token')
    res.json({ ok: true })
  })

  return router
}
```

`site/server/src/app.js` (substituir por):

```js
import express from 'express'
import cookieParser from 'cookie-parser'
import { createAuthRouter } from './routes/auth.js'
import { createRequireAuth } from './auth/middleware.js'

export function createApp({ config, db, verifySteamLogin, fetchPersona, staticDir } = {}) {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())

  app.get('/api/health', (req, res) => res.json({ ok: true }))

  const requireAuth = createRequireAuth(config.jwtSecret)
  app.use('/api/auth', createAuthRouter({ config, db, verifySteamLogin, fetchPersona, requireAuth }))

  return app
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS (todos os testes, incluindo Tasks 1-3)

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat: login steam com whitelist, jwt em cookie httponly e rota /me"
```

---

### Task 5: Rotas de jogadores (listar + whitelist + onboarding)

**Files:**
- Create: `site/server/src/routes/players.js`, `site/server/test/players.test.js`
- Modify: `site/server/src/app.js`

**Interfaces:**
- Consumes: `createRequireAuth`, `requireAdmin` (Task 4); `createApp` (Task 4)
- Produces: `GET /api/players` (autenticado) → `[{ steamId, nick, avatarUrl, isAdmin }]`; `POST /api/players` (admin) body `{ steamId }` → 201; `PUT /api/players/me` (autenticado) body `{ matchAuthCode, lastShareCode }` → grava os próprios códigos de onboarding do Jogador logado (consumidos pelo Coletor na Fase 2)

- [ ] **Step 1: Escrever os testes que falham**

`site/server/test/players.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = {
  jwtSecret: 'segredo-de-teste',
  appUrl: 'http://localhost:5173',
  isProduction: false,
}

function appWith(rows = []) {
  const db = { query: vi.fn().mockResolvedValue({ rows }) }
  return { app: createApp({ config, db }), db }
}

const adminCookie = `resenha_token=${signToken({ steamId: '76561198000000001', isAdmin: true }, config.jwtSecret)}`
const memberCookie = `resenha_token=${signToken({ steamId: '76561198000000002', isAdmin: false }, config.jwtSecret)}`

describe('GET /api/players', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    expect((await request(app).get('/api/players')).status).toBe(401)
  })

  it('logado: lista jogadores', async () => {
    const { app } = appWith([
      { steam_id64: '765', nick: 'fih', avatar_url: null, is_admin: true },
    ])
    const res = await request(app).get('/api/players').set('Cookie', memberCookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ steamId: '765', nick: 'fih', avatarUrl: null, isAdmin: true }])
  })
})

describe('POST /api/players', () => {
  it('membro comum: 403', async () => {
    const { app } = appWith()
    const res = await request(app)
      .post('/api/players')
      .set('Cookie', memberCookie)
      .send({ steamId: '76561198000000003' })
    expect(res.status).toBe(403)
  })

  it('admin com steamId inválido: 400', async () => {
    const { app } = appWith()
    const res = await request(app)
      .post('/api/players')
      .set('Cookie', adminCookie)
      .send({ steamId: 'abc' })
    expect(res.status).toBe(400)
  })

  it('admin: adiciona à whitelist', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .post('/api/players')
      .set('Cookie', adminCookie)
      .send({ steamId: '76561198000000003' })
    expect(res.status).toBe(201)
    expect(db.query.mock.calls[0][1]).toEqual(['76561198000000003'])
  })
})

describe('PUT /api/players/me (onboarding)', () => {
  const shareCode = 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee'

  it('sem login: 401', async () => {
    const { app } = appWith()
    const res = await request(app)
      .put('/api/players/me')
      .send({ matchAuthCode: 'ABCD-12345-EFGH', lastShareCode: shareCode })
    expect(res.status).toBe(401)
  })

  it('share code em formato inválido: 400', async () => {
    const { app } = appWith()
    const res = await request(app)
      .put('/api/players/me')
      .set('Cookie', memberCookie)
      .send({ matchAuthCode: 'ABCD-12345-EFGH', lastShareCode: 'não-é-share-code' })
    expect(res.status).toBe(400)
  })

  it('grava os próprios códigos do jogador logado', async () => {
    const { app, db } = appWith()
    const res = await request(app)
      .put('/api/players/me')
      .set('Cookie', memberCookie)
      .send({ matchAuthCode: 'ABCD-12345-EFGH', lastShareCode: shareCode })
    expect(res.status).toBe(200)
    expect(db.query.mock.calls[0][1]).toEqual([
      '76561198000000002',
      'ABCD-12345-EFGH',
      shareCode,
    ])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — 404 nas rotas `/api/players`

- [ ] **Step 3: Implementar**

`site/server/src/routes/players.js`:

```js
import { Router } from 'express'
import { requireAdmin } from '../auth/middleware.js'

export function createPlayersRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      'select steam_id64, nick, avatar_url, is_admin from players order by nick',
    )
    res.json(
      rows.map((p) => ({
        steamId: p.steam_id64,
        nick: p.nick,
        avatarUrl: p.avatar_url,
        isAdmin: p.is_admin,
      })),
    )
  })

  router.post('/', requireAuth, requireAdmin, async (req, res) => {
    const steamId = String(req.body?.steamId ?? '')
    if (!/^\d{17}$/.test(steamId)) {
      return res.status(400).json({ erro: 'steamId deve ser o SteamID64 (17 dígitos)' })
    }
    await db.query(
      'insert into players (steam_id64) values ($1) on conflict (steam_id64) do nothing',
      [steamId],
    )
    res.status(201).json({ ok: true })
  })

  // Onboarding: o próprio Jogador informa seu código de autenticação de histórico e
  // o último share code, sementes de que o Coletor (Fase 2) precisa para achar Partidas.
  router.put('/me', requireAuth, async (req, res) => {
    const matchAuthCode = String(req.body?.matchAuthCode ?? '').trim()
    const lastShareCode = String(req.body?.lastShareCode ?? '').trim()
    if (!/^[\w-]{4,32}$/.test(matchAuthCode)) {
      return res.status(400).json({ erro: 'Código de autenticação inválido' })
    }
    if (!/^CSGO(-\S{5}){5}$/.test(lastShareCode)) {
      return res.status(400).json({ erro: 'Share code inválido (formato CSGO-…-…-…-…-…)' })
    }
    await db.query(
      'update players set match_auth_code = $2, last_share_code = $3 where steam_id64 = $1',
      [req.player.steamId, matchAuthCode, lastShareCode],
    )
    res.json({ ok: true })
  })

  return router
}
```

Em `site/server/src/app.js`, adicionar após a linha do `createAuthRouter`:

```js
import { createPlayersRouter } from './routes/players.js'
// ... dentro de createApp, após app.use('/api/auth', ...):
app.use('/api/players', createPlayersRouter({ db, requireAuth }))
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat: listagem de jogadores e whitelist gerida pelo admin"
```

---

### Task 6: Client React (shell dark, login, páginas base)

**Files:**
- Create: `site/client/package.json`, `site/client/vite.config.js`, `site/client/index.html`, `site/client/src/main.jsx`, `site/client/src/index.css`, `site/client/src/App.jsx`, `site/client/src/auth/AuthContext.jsx`, `site/client/src/components/Shell.jsx`, `site/client/src/pages/Entrar.jsx`, `site/client/src/pages/AcessoNegado.jsx`, `site/client/src/pages/Feed.jsx`, `site/client/src/pages/Jogadores.jsx`, `site/client/src/pages/Admin.jsx`, `site/client/src/pages/Perfil.jsx`, `site/client/src/test/setup.js`, `site/client/src/test/App.test.jsx`

**Interfaces:**
- Consumes: `GET /api/auth/me`, `GET /api/players`, `POST /api/players`, `PUT /api/players/me`, `POST /api/auth/logout` (Tasks 4-5), link `/api/auth/steam`
- Produces: SPA com rotas `/` (Feed), `/jogadores`, `/perfil`, `/admin`, `/entrar`, `/acesso-negado`; `useAuth()` → `{ carregando, jogador }`

- [ ] **Step 1: Scaffold e dependências**

`site/client/package.json`:

```json
{
  "name": "resenha-client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.1.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "tailwindcss": "^4.0.0",
    "vite": "^7.0.0",
    "vitest": "^3.0.0"
  }
}
```

Rodar `npm install` em `site/client`.

`site/client/vite.config.js`:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': 'http://localhost:3001' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    globals: true,
  },
})
```

`site/client/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Resenha</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

`site/client/src/index.css` (paleta provisória — o taste-skill redefine na Fase 3):

```css
@import 'tailwindcss';

@theme {
  --color-fundo: #0b0e13;
  --color-superficie: #141922;
  --color-borda: #232b38;
  --color-texto: #e6edf3;
  --color-texto-fraco: #8b98a9;
  --color-destaque: #f5a623;
}

body {
  background-color: var(--color-fundo);
  color: var(--color-texto);
}
```

`site/client/src/test/setup.js`:

```js
import '@testing-library/jest-dom'
```

- [ ] **Step 2: Escrever os testes que falham**

`site/client/src/test/App.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../App.jsx'

function mockMe(response) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: response !== null,
      json: async () => response ?? { erro: 'Não autenticado' },
    }),
  )
}

// jsdom compartilha window.history entre testes do mesmo arquivo, e o <Navigate replace>
// do teste "sem login" deixa a URL em /entrar. Sem resetar, o BrowserRouter do teste
// seguinte renderiza a página errada e o teste falha por engano.
beforeEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('App', () => {
  it('sem login: mostra a tela de entrar com link para a Steam', async () => {
    mockMe(null)
    render(<App />)
    const link = await screen.findByRole('link', { name: /entrar com steam/i })
    expect(link).toHaveAttribute('href', '/api/auth/steam')
  })

  it('logado: mostra o shell com o nick do jogador', async () => {
    mockMe({ steamId: '765', nick: 'fih', avatarUrl: null, isAdmin: false })
    render(<App />)
    expect(await screen.findByText('fih')).toBeInTheDocument()
    expect(screen.getByText(/nenhuma partida/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test` (em `site/client`)
Expected: FAIL — `Cannot find module '../App.jsx'`

- [ ] **Step 4: Implementar**

`site/client/src/main.jsx`:

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`site/client/src/auth/AuthContext.jsx`:

```jsx
import { createContext, useContext, useEffect, useState } from 'react'

const AuthContext = createContext({ carregando: true, jogador: null })

export function AuthProvider({ children }) {
  const [estado, setEstado] = useState({ carregando: true, jogador: null })

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((jogador) => setEstado({ carregando: false, jogador }))
      .catch(() => setEstado({ carregando: false, jogador: null }))
  }, [])

  return <AuthContext.Provider value={estado}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
```

`site/client/src/App.jsx`:

```jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext.jsx'
import Shell from './components/Shell.jsx'
import Entrar from './pages/Entrar.jsx'
import AcessoNegado from './pages/AcessoNegado.jsx'
import Feed from './pages/Feed.jsx'
import Jogadores from './pages/Jogadores.jsx'
import Perfil from './pages/Perfil.jsx'
import Admin from './pages/Admin.jsx'

function RotaProtegida({ children }) {
  const { carregando, jogador } = useAuth()
  if (carregando) return <p className="p-8 text-texto-fraco">Carregando…</p>
  if (!jogador) return <Navigate to="/entrar" replace />
  return <Shell>{children}</Shell>
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/entrar" element={<Entrar />} />
          <Route path="/acesso-negado" element={<AcessoNegado />} />
          <Route path="/" element={<RotaProtegida><Feed /></RotaProtegida>} />
          <Route path="/jogadores" element={<RotaProtegida><Jogadores /></RotaProtegida>} />
          <Route path="/perfil" element={<RotaProtegida><Perfil /></RotaProtegida>} />
          <Route path="/admin" element={<RotaProtegida><Admin /></RotaProtegida>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
```

`site/client/src/components/Shell.jsx`:

```jsx
import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'

function itemClasse({ isActive }) {
  return `block rounded px-3 py-2 text-sm ${
    isActive ? 'bg-superficie text-texto' : 'text-texto-fraco hover:text-texto'
  }`
}

export default function Shell({ children }) {
  const { jogador } = useAuth()

  async function sair() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/entrar'
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-borda p-4">
        <h1 className="mb-6 text-lg font-bold text-destaque">Resenha</h1>
        <nav className="space-y-1">
          <NavLink to="/" end className={itemClasse}>Partidas</NavLink>
          <NavLink to="/jogadores" className={itemClasse}>Jogadores</NavLink>
          <NavLink to="/perfil" className={itemClasse}>Meu perfil</NavLink>
          {jogador?.isAdmin && <NavLink to="/admin" className={itemClasse}>Admin</NavLink>}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-end gap-3 border-b border-borda px-6 py-3">
          {jogador?.avatarUrl && (
            <img src={jogador.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
          )}
          <span className="text-sm">{jogador?.nick}</span>
          <button onClick={sair} className="text-sm text-texto-fraco hover:text-texto">
            Sair
          </button>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}
```

`site/client/src/pages/Entrar.jsx`:

```jsx
export default function Entrar() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold text-destaque">Resenha</h1>
      <p className="text-texto-fraco">Stats e highlights do grupo. Fechado pra resenha.</p>
      <a
        href="/api/auth/steam"
        className="rounded bg-superficie px-6 py-3 font-medium hover:bg-borda"
      >
        Entrar com Steam
      </a>
    </div>
  )
}
```

`site/client/src/pages/AcessoNegado.jsx`:

```jsx
export default function AcessoNegado() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Acesso restrito</h1>
      <p className="text-texto-fraco">
        Sua conta Steam não está na whitelist. Pede pra um admin do grupo te adicionar.
      </p>
    </div>
  )
}
```

`site/client/src/pages/Feed.jsx`:

```jsx
export default function Feed() {
  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Partidas</h2>
      <p className="text-texto-fraco">
        Nenhuma Partida ainda — o Coletor entra em campo na Fase 2.
      </p>
    </div>
  )
}
```

`site/client/src/pages/Jogadores.jsx`:

```jsx
import { useEffect, useState } from 'react'

export default function Jogadores() {
  const [jogadores, setJogadores] = useState([])

  useEffect(() => {
    fetch('/api/players')
      .then((res) => (res.ok ? res.json() : []))
      .then(setJogadores)
      .catch(() => setJogadores([]))
  }, [])

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Jogadores</h2>
      <ul className="space-y-2">
        {jogadores.map((j) => (
          <li key={j.steamId} className="flex items-center gap-3 rounded bg-superficie p-3">
            {j.avatarUrl && <img src={j.avatarUrl} alt="" className="h-8 w-8 rounded-full" />}
            <span>{j.nick || j.steamId}</span>
            {j.isAdmin && <span className="text-xs text-destaque">admin</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

`site/client/src/pages/Admin.jsx`:

```jsx
import { useState } from 'react'

export default function Admin() {
  const [steamId, setSteamId] = useState('')
  const [mensagem, setMensagem] = useState(null)

  async function adicionar(e) {
    e.preventDefault()
    const res = await fetch('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steamId }),
    })
    if (res.ok) {
      setMensagem('Jogador adicionado à whitelist.')
      setSteamId('')
    } else {
      const body = await res.json().catch(() => ({}))
      setMensagem(body.erro ?? 'Erro ao adicionar.')
    }
  }

  return (
    <div className="max-w-md">
      <h2 className="mb-4 text-xl font-semibold">Admin</h2>
      <form onSubmit={adicionar} className="space-y-3">
        <label className="block text-sm text-texto-fraco" htmlFor="steamId">
          SteamID64 do novo Jogador (17 dígitos)
        </label>
        <input
          id="steamId"
          value={steamId}
          onChange={(e) => setSteamId(e.target.value)}
          className="w-full rounded border border-borda bg-superficie px-3 py-2"
          placeholder="76561198…"
        />
        <button type="submit" className="rounded bg-destaque px-4 py-2 font-medium text-fundo">
          Adicionar à whitelist
        </button>
      </form>
      {mensagem && <p className="mt-3 text-sm text-texto-fraco">{mensagem}</p>}
    </div>
  )
}
```

`site/client/src/pages/Perfil.jsx` (onboarding — o Jogador informa os códigos que o Coletor precisa):

```jsx
import { useState } from 'react'

export default function Perfil() {
  const [matchAuthCode, setMatchAuthCode] = useState('')
  const [lastShareCode, setLastShareCode] = useState('')
  const [mensagem, setMensagem] = useState(null)

  async function salvar(e) {
    e.preventDefault()
    const res = await fetch('/api/players/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchAuthCode, lastShareCode }),
    })
    const body = await res.json().catch(() => ({}))
    setMensagem(res.ok ? 'Códigos salvos. O Coletor vai buscar suas Partidas.' : (body.erro ?? 'Erro ao salvar.'))
  }

  return (
    <div className="max-w-lg">
      <h2 className="mb-2 text-xl font-semibold">Meu perfil</h2>
      <p className="mb-4 text-sm text-texto-fraco">
        Para o Resenha achar suas Partidas de matchmaking, cole seu código de autenticação de
        histórico e o último share code. Pegue os dois em{' '}
        <a
          className="text-destaque underline"
          href="https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128"
          target="_blank"
          rel="noreferrer"
        >
          Steam → Ajuda → Compartilhar histórico de partidas
        </a>
        .
      </p>
      <form onSubmit={salvar} className="space-y-3">
        <div>
          <label className="block text-sm text-texto-fraco" htmlFor="authCode">
            Código de autenticação de histórico
          </label>
          <input
            id="authCode"
            value={matchAuthCode}
            onChange={(e) => setMatchAuthCode(e.target.value)}
            className="w-full rounded border border-borda bg-superficie px-3 py-2"
            placeholder="XXXX-XXXXX-XXXX"
          />
        </div>
        <div>
          <label className="block text-sm text-texto-fraco" htmlFor="shareCode">
            Último share code
          </label>
          <input
            id="shareCode"
            value={lastShareCode}
            onChange={(e) => setLastShareCode(e.target.value)}
            className="w-full rounded border border-borda bg-superficie px-3 py-2"
            placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"
          />
        </div>
        <button type="submit" className="rounded bg-destaque px-4 py-2 font-medium text-fundo">
          Salvar
        </button>
      </form>
      {mensagem && <p className="mt-3 text-sm text-texto-fraco">{mensagem}</p>}
    </div>
  )
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test` (em `site/client`)
Expected: PASS (2 testes)

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat: shell react dark com login steam, feed, jogadores e admin"
```

---

### Task 7: Bootstrap, produção e README

**Files:**
- Create: `site/server/src/index.js`, `site/server/.env.example`, `README.md`
- Modify: `site/server/src/app.js`, `site/server/test/app.test.js`

**Interfaces:**
- Consumes: tudo das Tasks 1-6
- Produces: `npm run dev` funcional nos dois pacotes; em produção o Express serve `site/client/dist` com fallback SPA (exceto `/api/*`)

- [ ] **Step 1: Escrever o teste que falha (static + fallback SPA)**

Adicionar em `site/server/test/app.test.js`:

```js
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

describe('produção: static + fallback SPA', () => {
  it('serve index.html para rotas que não são /api', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'resenha-dist-'))
    writeFileSync(path.join(dir, 'index.html'), '<html>resenha</html>')
    const app = createApp({ config: testConfig, staticDir: dir })
    const res = await request(app).get('/jogadores')
    expect(res.status).toBe(200)
    expect(res.text).toContain('resenha')
  })

  it('não engole rotas /api desconhecidas', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'resenha-dist-'))
    writeFileSync(path.join(dir, 'index.html'), '<html>resenha</html>')
    const app = createApp({ config: testConfig, staticDir: dir })
    const res = await request(app).get('/api/inexistente')
    expect(res.status).toBe(404)
  })
})
```

(Reaproveita `testConfig` exportado no topo do arquivo pela Task 1.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `/jogadores` retorna 404

- [ ] **Step 3: Implementar**

Em `site/server/src/app.js`, adicionar antes do `return app`:

```js
import path from 'node:path'
// ... dentro de createApp:
if (staticDir) {
  app.use(express.static(staticDir))
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'))
  })
}
```

`site/server/src/index.js`:

```js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'
import { createDb } from './db.js'
import { createApp } from './app.js'
import { verifySteamAssertion } from './steam/openid.js'
import { createFetchPersona } from './steam/api.js'

const config = loadConfig()
const db = createDb(config.databaseUrl)
const staticDir = config.isProduction
  ? path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist')
  : null

const app = createApp({
  config,
  db,
  verifySteamLogin: verifySteamAssertion,
  fetchPersona: createFetchPersona(config.steamApiKey),
  staticDir,
})

app.listen(config.port, () => {
  console.log(`Resenha API na porta ${config.port}`)
})
```

`site/server/.env.example`:

```ini
# Conexão com o Postgres do Supabase (Settings → Database → Connection string).
# USE O "SESSION POOLER" como padrão: a conexão direta (db.SEU_PROJETO.supabase.co)
# é IPv6-only desde 2024 e falha em redes IPv4 (caso desta máquina) com ENETUNREACH.
# O Session Pooler é IPv4 e funciona com pg.Pool sem mudança de código.
DATABASE_URL=postgresql://postgres.SEU_PROJETO:SENHA@aws-0-us-east-1.pooler.supabase.com:5432/postgres
# (Alternativa, só se sua rede tiver IPv6: postgresql://postgres:SENHA@db.SEU_PROJETO.supabase.co:5432/postgres)
# Chave da Steam Web API: https://steamcommunity.com/dev/apikey
STEAM_API_KEY=
# Qualquer string longa e aleatória
JWT_SECRET=
# Origem pública do site (dev: o Vite; prod: o domínio)
APP_URL=http://localhost:5173
PORT=3001
```

`README.md` (raiz):

```markdown
# Resenha

Stats e highlights de CS2 para o grupo. Docs do domínio em [CONTEXT.md](CONTEXT.md) e [docs/BRIEF.md](docs/BRIEF.md).

## Rodar em dev

> Comandos em PowerShell — um por linha (o `&&` não é separador válido no Windows PowerShell 5.1).

1. Preparar o server:
   ```powershell
   cd site/server
   npm install
   copy .env.example .env   # depois preencha o .env
   ```
2. Aplique `supabase/migrations/0001_schema_inicial.sql` no projeto Supabase (SQL Editor)
3. `node --env-file-if-exists=.env scripts/seed-admin.js <seu SteamID64>`
4. `npm run dev` (API em http://localhost:3001)
5. Em outro terminal:
   ```powershell
   cd site/client
   npm install
   npm run dev   # http://localhost:5173
   ```

## Testes

`npm test` dentro de `site/server` e de `site/client`.

## Estrutura

- `site/server` — API Express (auth Steam, JWT, Postgres via pg)
- `site/client` — SPA React + Vite + Tailwind
- `supabase/migrations` — schema versionado (contrato com o Coletor)
- `coletor/` — (Fase 2) Python + demoparser2 via GitHub Actions
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test` (em `site/server`)
Expected: PASS (todos)

Run também: `npm run build` em `site/client`
Expected: build sem erros gerando `site/client/dist/`

- [ ] **Step 5: Verificação manual de ponta a ponta**

1. `.env` preenchido com DATABASE_URL real, STEAM_API_KEY real e JWT_SECRET
2. Migração aplicada + `seed-admin.js` com o SteamID64 do dono
3. Server e client rodando → abrir http://localhost:5173 → "Entrar com Steam" → login real → deve voltar logado com nick e avatar
4. Conta Steam fora da whitelist → deve cair em /acesso-negado

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat: bootstrap do server, modo produção servindo a spa e readme"
```
