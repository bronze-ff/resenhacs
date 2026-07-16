# Integração FACEIT — Fase A (vínculo OAuth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botão "Vincular FACEIT" em Minha Conta — OAuth2/OIDC com PKCE (sem client secret,
já que o app foi criado como "Authorization Code with PKCE" em developers.faceit.com), grava
`faceit_id`/`faceit_nick` no jogador logado, e mostra um badge PREMIER/FACEIT no Feed e no
histórico do perfil.

**Architecture:** `players` (tabela global) ganha 2 colunas. 2 rotas novas (`/api/faceit/login`,
`/api/faceit/callback`) fazem o fluxo OIDC padrão contra os endpoints reais da FACEIT
(descobertos via `https://api.faceit.com/auth/v1/openid_configuration`). `code_verifier`/`state`
guardados em cookies httpOnly de curta duração — mesmo padrão já usado pro `resenha_post_login`
em `auth.js`.

**Tech Stack:** Node `crypto` (nativo, sem dependência nova) pra gerar `code_verifier`/
`code_challenge` (S256) e o `state` anti-CSRF.

## Global Constraints

- Endpoints reais da FACEIT (confirmados via discovery document, não inventados):
  - `authorization_endpoint`: `https://accounts.faceit.com`
  - `token_endpoint`: `https://api.faceit.com/auth/v1/oauth/token`
  - `userinfo_endpoint`: `https://api.faceit.com/auth/v1/resources/userinfo`
  - scopes suportados: `openid`, `email`, `profile`, `membership`.
- `FACEIT_CLIENT_ID` é público (`ed8a32aa-38c9-4e5d-a76b-012576acc6ff`) — vai como env var
  `FACEIT_CLIENT_ID` (não como secret, mas também não hardcoded no código-fonte, pra poder
  trocar sem novo deploy). **Nunca** printar/pedir `FACEIT_CLIENT_SECRET` — o app é PKCE puro,
  não deveria precisar de um.
- **Risco conhecido, documentado no Step de teste manual do Task 2**: alguns apps FACEIT
  criados como PKCE ainda exigem `client_secret` no POST do token endpoint (a doc geral da
  FACEIT Connect menciona Basic Auth com client_id+secret para clients confidenciais). Se o
  primeiro teste real do fluxo devolver 401 no callback, o admin precisa checar em
  developers.faceit.com se esse Client ID tem um secret associado e adicionar
  `FACEIT_CLIENT_SECRET` ao env — nesse caso, uma pequena revisão no Task 2 Step 3
  (Authorization Basic no POST) resolve. Não é possível confirmar isso sem testar com
  credenciais reais.
- `players` continua global (identidade Steam) — vínculo FACEIT não tem nada a ver com
  `group_id`/multi-tenancy.

---

### Task 1: Migration — `players.faceit_id`, `players.faceit_nick`

**Files:**
- Create: `supabase/migrations/0022_faceit_vinculo.sql`

- [ ] **Step 1: Escrever a migration**

```sql
alter table players add column faceit_id text;
alter table players add column faceit_nick text;
```

- [ ] **Step 2: Aplicar no Supabase de produção**

Peça confirmação explícita nomeando a migration (`0022_faceit_vinculo`) antes de chamar
`apply_migration` no projeto `hrpgbrfqxqjxpsjeymec` — mesmo padrão das migrations anteriores
desta sessão. Depois `list_tables` (verbose) pra confirmar as duas colunas em `players`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0022_faceit_vinculo.sql
git commit -m "feat: migration do vinculo FACEIT (faceit_id, faceit_nick)"
```

---

### Task 2: Servidor — rotas OAuth de vínculo

**Files:**
- Modify: `site/server/src/config.js`
- Create: `site/server/src/routes/faceit.js`
- Modify: `site/server/src/app.js`
- Test: `site/server/test/faceit.test.js`

**Interfaces:**
- Produces: `GET /api/faceit/login` (requireAuth), `GET /api/faceit/callback` (requireAuth).

- [ ] **Step 1: `config.js` — `faceitClientId` opcional**

Adicionar, no objeto retornado por `loadConfig` (depois de `r2Bucket`):

```js
    // OAuth de vínculo FACEIT (Fase A) — client id é público, mas fica em env var pra
    // poder trocar sem novo deploy. Sem ele, a rota de vínculo devolve 503 (mesmo padrão
    // do upload manual quando falta config de Coletor).
    faceitClientId: env.FACEIT_CLIENT_ID ?? null,
```

- [ ] **Step 2: `faceit.js` — gerar PKCE + redirecionar**

```js
import { Router } from 'express'
import { randomBytes, createHash } from 'node:crypto'

const AUTHORIZE_URL = 'https://accounts.faceit.com'
const TOKEN_URL = 'https://api.faceit.com/auth/v1/oauth/token'
const USERINFO_URL = 'https://api.faceit.com/auth/v1/resources/userinfo'

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function createFaceitRouter({ config, db, fetchImpl = fetch }) {
  const router = Router()

  router.get('/login', (req, res) => {
    if (!config.faceitClientId) return res.status(503).json({ erro: 'Vínculo FACEIT não configurado' })
    const state = base64url(randomBytes(16))
    const verifier = base64url(randomBytes(32))
    const challenge = base64url(createHash('sha256').update(verifier).digest())

    res.cookie('resenha_faceit_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 5 * 60 * 1000 })
    res.cookie('resenha_faceit_verifier', verifier, { httpOnly: true, sameSite: 'lax', maxAge: 5 * 60 * 1000 })

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.faceitClientId,
      redirect_uri: `${config.appUrl}/api/faceit/callback`,
      scope: 'openid profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    res.redirect(`${AUTHORIZE_URL}?${params}`)
  })

  router.get('/callback', async (req, res) => {
    const erroRedirect = `${config.appUrl}/conta?erro=faceit-invalido`
    const { code, state } = req.query
    const stateCookie = req.cookies?.resenha_faceit_state
    const verifier = req.cookies?.resenha_faceit_verifier
    res.clearCookie('resenha_faceit_state')
    res.clearCookie('resenha_faceit_verifier')
    if (!code || !state || !stateCookie || !verifier || state !== stateCookie) {
      return res.redirect(erroRedirect)
    }

    const tokenRes = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: `${config.appUrl}/api/faceit/callback`,
        client_id: config.faceitClientId,
        code_verifier: verifier,
      }),
    })
    if (!tokenRes.ok) return res.redirect(erroRedirect)
    const tokenBody = await tokenRes.json()

    const userRes = await fetchImpl(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    })
    if (!userRes.ok) return res.redirect(erroRedirect)
    const userBody = await userRes.json()
    const faceitId = userBody.guid ?? userBody.sub
    const faceitNick = userBody.nickname ?? null
    if (!faceitId) return res.redirect(erroRedirect)

    await db.query('update players set faceit_id = $2, faceit_nick = $3 where steam_id64 = $1', [
      req.player.steamId,
      faceitId,
      faceitNick,
    ])
    res.redirect(`${config.appUrl}/conta?faceit=vinculado`)
  })

  return router
}
```

**Nota:** o `req.player.steamId` usado no `callback` exige que o jogador já esteja logado
no Resenha quando clica "Vincular FACEIT" — a rota `/login` e o `/callback` precisam de
`requireAuth` montado no `app.js` (Step 3), não dentro do router (para reaproveitar o cookie
de sessão já ativo, igual às demais rotas protegidas).

- [ ] **Step 3: Montar em `app.js`**

Adicionar import `import { createFaceitRouter } from './routes/faceit.js'` e, depois da linha
de `/api/players`:

```js
  app.use('/api/faceit', requireAuth, createFaceitRouter({ config, db }))
```

- [ ] **Step 4: Teste manual end-to-end (não automatizável sem credenciais reais)**

Depois de deployado com `FACEIT_CLIENT_ID` configurado, clicar em "Vincular FACEIT" (Task 3)
logado no Resenha e completar o login na FACEIT de verdade. Se o callback redirecionar com
`?erro=faceit-invalido`, checar os logs do servidor (Vercel) pra ver se o erro veio do
`tokenRes` (nesse caso, ver o risco de `client_secret` documentado nos Global Constraints) ou
do `userRes`.

- [ ] **Step 5: Escrever `site/server/test/faceit.test.js`**

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, faceitClientId: 'client-123' }
const cookie = `resenha_token=${signToken({ steamId: '111' }, config.jwtSecret)}`

function appWith({ rows = [] } = {}) {
  const db = { query: vi.fn().mockResolvedValue({ rows }) }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/faceit/login', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    expect((await request(app).get('/api/faceit/login')).status).toBe(401)
  })

  it('redireciona pra accounts.faceit.com com PKCE e seta cookies', async () => {
    const { app } = appWith()
    const res = await request(app).get('/api/faceit/login').set('Cookie', cookie)
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('https://accounts.faceit.com')
    expect(res.headers.location).toContain('code_challenge_method=S256')
    const cookies = res.headers['set-cookie'].join(';')
    expect(cookies).toContain('resenha_faceit_state=')
    expect(cookies).toContain('resenha_faceit_verifier=')
  })

  it('sem FACEIT_CLIENT_ID configurado: 503', async () => {
    const db = { query: vi.fn() }
    const app = createApp({ config: { ...config, faceitClientId: null }, db })
    const res = await request(app).get('/api/faceit/login').set('Cookie', cookie)
    expect(res.status).toBe(503)
  })
})

describe('GET /api/faceit/callback', () => {
  it('state ausente ou divergente: redireciona com erro', async () => {
    const { app } = appWith()
    const res = await request(app).get('/api/faceit/callback?code=x&state=y').set('Cookie', cookie)
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('erro=faceit-invalido')
  })

  it('troca code por token, busca userinfo e grava faceit_id', async () => {
    const { app, db } = appWith()
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ guid: 'abc-123', nickname: 'ProPlayer' }) })
    const appComFetch = createApp({ config, db, faceitFetchImpl: fetchImpl })
    // Nota pro implementador: createApp precisa aceitar e repassar faceitFetchImpl pro
    // createFaceitRouter (fetchImpl), senão este teste não consegue mockar o fetch real.
    // Ver ajuste no app.js: `createFaceitRouter({ config, db, fetchImpl: faceitFetchImpl ?? fetch })`.
    const loginRes = await request(appComFetch).get('/api/faceit/login').set('Cookie', cookie)
    const setCookies = loginRes.headers['set-cookie']
    const stateCookie = setCookies.find((c) => c.startsWith('resenha_faceit_state=')).split(';')[0]
    const verifierCookie = setCookies.find((c) => c.startsWith('resenha_faceit_verifier=')).split(';')[0]
    const stateValue = stateCookie.split('=')[1]
    const res = await request(appComFetch)
      .get(`/api/faceit/callback?code=abc&state=${stateValue}`)
      .set('Cookie', [cookie, stateCookie, verifierCookie].join('; '))
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('faceit=vinculado')
    expect(db.query.mock.calls[0][1]).toEqual(['111', 'abc-123', 'ProPlayer'])
  })
})
```

- [ ] **Step 6: Ajustar `app.js` e `faceit.js` pra aceitar `faceitFetchImpl` injetável (necessário
pro teste do Step 5)**

Em `app.js`, `createApp({ config, db, ..., faceitFetchImpl })` — passar
`fetchImpl: faceitFetchImpl` pro `createFaceitRouter` só se `faceitFetchImpl` foi passado
(senão o router usa o `fetch` global default já definido em `faceit.js`):

```js
  app.use('/api/faceit', requireAuth, createFaceitRouter({ config, db, ...(faceitFetchImpl ? { fetchImpl: faceitFetchImpl } : {}) }))
```

E adicionar `faceitFetchImpl` à assinatura de `createApp` (mesmo padrão de `execFileImpl` já
usado pro upload router).

- [ ] **Step 7: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add site/server/src/config.js site/server/src/routes/faceit.js site/server/src/app.js site/server/test/faceit.test.js
git commit -m "feat: rotas de vinculo OAuth FACEIT (PKCE)"
```

---

### Task 3: Client — botão "Vincular FACEIT" em Minha Conta

**Files:**
- Modify: `site/client/src/pages/Perfil.jsx`
- Modify: `site/server/src/routes/auth.js` (expor `faceitNick` em `/me`)
- Modify: `site/server/test/auth.test.js`

**Interfaces:**
- Consumes: `jogador.faceitNick` (de `GET /api/auth/me`), `GET /api/faceit/login` (via link
  simples, não fetch — é um redirect de navegador).

- [ ] **Step 1: `auth.js` — incluir `faceit_nick` no select/response de `/me`**

Trocar o `select` de `/me`:

```js
      'select steam_id64, nick, avatar_url, is_super_admin, grupo_ativo_id, ranking_publico, faceit_nick from players where steam_id64 = $1',
```

E adicionar `faceitNick: p.faceit_nick,` no `res.json({...})`.

- [ ] **Step 2: Atualizar `auth.test.js`**

Adicionar `faceit_nick: null` no fixture `JOGADOR` e `faceitNick: null` no `toEqual` do teste
de `/me`.

- [ ] **Step 3: Trocar o placeholder "Em breve" por um link real em `Perfil.jsx`**

Substituir a seção "Contas vinculadas":

```jsx
      <section className="space-y-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">
          Contas vinculadas
        </h3>
        <Card className="flex items-center justify-between gap-3 p-4 sm:p-5">
          <div>
            <p className="font-display text-sm font-semibold uppercase tracking-wide text-texto">FACEIT</p>
            <p className="font-mono text-xs text-texto-fraco">
              {jogador?.faceitNick
                ? `Vinculado como ${jogador.faceitNick}.`
                : 'Vincule pra importar suas partidas da FACEIT automaticamente.'}
            </p>
          </div>
          {jogador?.faceitNick ? (
            <Badge tom="sucesso">Vinculado</Badge>
          ) : (
            <a
              href="/api/faceit/login"
              className="panel-cut-sm border border-destaque px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-destaque hover:bg-destaque/10"
            >
              Vincular
            </a>
          )}
        </Card>
      </section>
```

(o import de `Card`/`Badge` já existe no topo do arquivo; `jogador` já vem de `useAuth()`.)

- [ ] **Step 4: Build e testes**

Run: `cd site/client && npm run build && npm test`
Run: `cd site/server && npm test`
Expected: ambos limpos/PASS.

- [ ] **Step 5: Commit**

```bash
git add site/client/src/pages/Perfil.jsx site/server/src/routes/auth.js site/server/test/auth.test.js
git commit -m "feat: botao vincular FACEIT em minha conta"
```

---

### Task 4: Client — badge PREMIER/FACEIT no Feed e no histórico do perfil

> **Nota de atualização (2026-07-16):** este Task foi escrito em 2026-07-14, antes do redesign
> visual completo do site (commit `476d11b`). `Feed.jsx` não tem mais duas árvores JSX
> mobile/desktop separadas — é um `CardPartida` único e responsivo. A query de `recentes` em
> `profile.js` também já foi modificada por uma feature posterior (Premier Rating) e hoje já
> inclui `mp.premier_rating_before`/`mp.premier_rating_after`. Os Steps abaixo foram corrigidos
> pra bater com o código atual — sem mudar a intenção original.

**Files:**
- Modify: `site/client/src/lib/format.js`
- Modify: `site/client/src/pages/Feed.jsx`
- Modify: `site/server/src/routes/profile.js`
- Modify: `site/client/src/pages/JogadorPerfil.jsx`

**Interfaces:**
- Produces: `plataformaPartida(source)` em `format.js`.

- [ ] **Step 1: `plataformaPartida` em `format.js`**

Adicionar, logo abaixo de `origemPartida` (`site/client/src/lib/format.js:29-33`):

```js
// Badge de plataforma (Premier da Valve vs FACEIT) — null pra upload/pro, que já têm
// suas próprias tags (MANUAL/AUTO e PRO) e não precisam de uma terceira.
export function plataformaPartida(source) {
  if (source === 'valve_mm') return { label: 'PREMIER', tom: 'neutro' }
  if (source === 'faceit') return { label: 'FACEIT', tom: 'destaque' }
  return null
}
```

- [ ] **Step 2: `Feed.jsx` — badge ao lado do `origem` já existente (CORRIGIDO: um único bloco, não dois)**

Import (`site/client/src/pages/Feed.jsx:3`): trocar
`import { nomeMapa, dataHora, origemPartida, corRating } from '../lib/format.js'`
por `import { nomeMapa, dataHora, origemPartida, plataformaPartida, corRating } from '../lib/format.js'`.

Dentro de `CardPartida` (`Feed.jsx:58-60`), logo após `const origem = origemPartida(m.source)`:

```js
  const plataforma = plataformaPartida(m.source)
```

`Feed.jsx` tem HOJE um único bloco de badges (não mobile/desktop separados — unificado no
redesign de `476d11b`), em `Feed.jsx:72-73`. Trocar:

```jsx
          {m.source === 'pro' && <Badge tom="destaque" className="shrink-0">PRO</Badge>}
          <Badge tom="neutro" title={origem.title} className="shrink-0">{origem.label}</Badge>
```

por:

```jsx
          {m.source === 'pro' && <Badge tom="destaque" className="shrink-0">PRO</Badge>}
          {plataforma && <Badge tom={plataforma.tom} className="shrink-0">{plataforma.label}</Badge>}
          <Badge tom="neutro" title={origem.title} className="shrink-0">{origem.label}</Badge>
```

(um único ponto de inserção, não dois — confirmar contra o arquivo atual antes de editar, já
que o redesign pode ter deslocado a linha exata desde esta nota.)

- [ ] **Step 3: `profile.js` — incluir `m.source` na query de `recentes` (CORRIGIDO: query já tem colunas de Premier)**

A query de `recentes` (`site/server/src/routes/profile.js:408-417`, dentro de `GET /:steamId`)
já foi estendida por uma feature posterior (Premier Rating) e hoje é:

```js
      db.query(
        `select m.id, m.map, m.played_at, m.score_a, m.score_b,
                mp.kills, mp.deaths, mp.assists, mp.rating, mp.won,
                mp.damage, mp.rounds_played, mp.headshot_kills,
                mp.premier_rating_before, mp.premier_rating_after
         from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = $1 and m.status = 'parsed'${recentesPeriodo}${recentesGrupo}
         order by m.played_at desc nulls last limit 20`,
        recentesParams,
      ),
```

Só adicionar `m.source` ao SELECT (junto de `m.score_a, m.score_b`), sem tocar nas colunas de
Premier já presentes:

```js
      db.query(
        `select m.id, m.map, m.played_at, m.score_a, m.score_b, m.source,
                mp.kills, mp.deaths, mp.assists, mp.rating, mp.won,
                mp.damage, mp.rounds_played, mp.headshot_kills,
                mp.premier_rating_before, mp.premier_rating_after
         from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = $1 and m.status = 'parsed'${recentesPeriodo}${recentesGrupo}
         order by m.played_at desc nulls last limit 20`,
        recentesParams,
      ),
```

E no mapeamento de `recentes` (`profile.js:490-503`), adicionar `source: r.source,` junto dos
outros campos (não remover `premierBefore`/`premierAfter` que já estão lá):

```js
        adr: r.rounds_played ? Math.round((r.damage / r.rounds_played) * 10) / 10 : 0,
        hsPct: r.kills ? Math.round((r.headshot_kills / r.kills) * 100) : 0,
        premierBefore: r.premier_rating_before == null ? null : Number(r.premier_rating_before),
        premierAfter: r.premier_rating_after == null ? null : Number(r.premier_rating_after),
        source: r.source,
      })),
```

- [ ] **Step 4: `JogadorPerfil.jsx` — badge no card mobile e na tabela desktop (linhas atualizadas)**

Import: adicionar `plataformaPartida` ao import de `../lib/format.js` no topo do arquivo (mesmo
padrão do Step 2). `Badge` já está importado de `../components/ui` (`JogadorPerfil.jsx:4`) —
não precisa adicionar.

No card mobile (`JogadorPerfil.jsx:296-297`, dentro do `.map` de `recentes`), trocar:

```jsx
                        <MapIcon map={r.map} size={18} />
                        <span className="truncate font-mono text-xs text-texto-fraco">{nomeMapa(r.map)}</span>
```

por:

```jsx
                        <MapIcon map={r.map} size={18} />
                        <span className="truncate font-mono text-xs text-texto-fraco">{nomeMapa(r.map)}</span>
                        {plataformaPartida(r.source) && (
                          <Badge tom={plataformaPartida(r.source).tom} className="shrink-0">{plataformaPartida(r.source).label}</Badge>
                        )}
```

Na tabela desktop (`JogadorPerfil.jsx:360-365`), trocar a célula "Mapa":

```jsx
                      <td className="px-3 py-2 font-mono text-texto-fraco">
                        <span className="flex items-center gap-2">
                          <MapIcon map={r.map} size={20} />
                          {nomeMapa(r.map)}
                        </span>
                      </td>
```

por:

```jsx
                      <td className="px-3 py-2 font-mono text-texto-fraco">
                        <span className="flex items-center gap-2">
                          <MapIcon map={r.map} size={20} />
                          {nomeMapa(r.map)}
                          {plataformaPartida(r.source) && (
                            <Badge tom={plataformaPartida(r.source).tom} className="shrink-0">{plataformaPartida(r.source).label}</Badge>
                          )}
                        </span>
                      </td>
```

- [ ] **Step 5: Build e testes**

Run: `cd site/client && npm run build && npm test`
Run: `cd site/server && npm test`
Expected: ambos limpos/PASS. (Sem `source='faceit'` em produção ainda — o badge FACEIT só vai
aparecer de verdade depois da Fase B; PREMIER já aparece hoje pra toda partida `valve_mm`.)

- [ ] **Step 6: Commit**

```bash
git add site/client/src/lib/format.js site/client/src/pages/Feed.jsx site/client/src/pages/JogadorPerfil.jsx site/server/src/routes/profile.js
git commit -m "feat: badge PREMIER/FACEIT no feed e historico do perfil"
```

---

## Fora de escopo (Fase B — bloqueada até `FACEIT_API_KEY` estar configurada)

- Ingestão de stats/demos da FACEIT pelo Coletor.
- Webhook "Match Demo Ready".
- Refinar PREMIER vs Competitivo casual (depende de dado que só vem no header do demo).
