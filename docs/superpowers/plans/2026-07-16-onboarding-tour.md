# Tour guiado + passo a passo Steam em Minha Conta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um passo a passo numerado de como pegar os códigos Steam em Minha Conta, e um tour guiado de 4 passos (boas-vindas, vincular Steam, vincular FACEIT, navegar pelo menu) que abre sozinho na primeira vez que o jogador tem um grupo ativo, e fica acessível depois via link "Ajuda".

**Architecture:** Front React (Vite) já tem `RotaProtegida`/`RotaBemVindo` em `App.jsx` fazendo gate por `jogador.grupoAtivoId` via `useAuth()`; o gate do tour é a mesma receita com uma flag nova (`tourConcluido`). Back Express já tem o padrão exato pro endpoint (`PUT /me/ranking-publico` em `players.js`) e o payload de `/api/auth/me` (`auth.js`) que ganha o campo novo. Sem biblioteca nova — só uma coluna, um endpoint, dois componentes React e um ajuste de rota.

**Tech Stack:** React 18 + Vite + Tailwind (client), Express + node-postgres (server), Vitest + Testing Library + Supertest (testes), Postgres via Supabase (migration).

## Global Constraints

- Nenhum print/screenshot real (nick, códigos) do usuário entra no repo — só texto com placeholders genéricos (`XXXX-XXXXX-XXXX`, `CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx`), mesmo padrão que já existe no formulário de Perfil.
- Todo texto de UI em PT-BR, mesmo tom/nomenclatura do resto do app ("Jogador", "Partida", "Minha conta").
- Seguir os primitivos existentes em `site/client/src/components/ui/` (`Card`, `SectionHeader`, `Badge`) e as classes utilitárias já usadas (`panel-cut-sm`, `font-mono`, `font-display`, `text-destaque`, etc.) — não introduzir estilos novos.
- Migration numerada `0029` (a última hoje é `0028_premier_rating.sql`).

---

### Task 1: Migration — `players.tour_concluido`

**Files:**
- Create: `supabase/migrations/0029_tour_concluido.sql`

**Interfaces:**
- Produces: coluna `players.tour_concluido` (`boolean not null default false`), usada pelas Tasks 2 e 3.

- [ ] **Step 1: Escrever a migration**

```sql
alter table players add column tour_concluido boolean not null default false;
```

- [ ] **Step 2: Aplicar no Supabase de produção**

Use a ferramenta MCP do Supabase (`apply_migration`, projeto `hrpgbrfqxqjxpsjeymec`, nome
`0029_tour_concluido`, mesmo SQL acima). Depois `list_tables` (ou `execute_sql` com
`select column_name from information_schema.columns where table_name = 'players'`) pra
confirmar que `tour_concluido` existe.

Se o MCP do Supabase estiver sem autenticação nesta sessão, aplique via `psycopg` usando o
`DATABASE_URL` de `site/server/.env` (Session Pooler, porta 5432, senha com `%40` no lugar de
`@`) — mesmo caminho já usado neste projeto pras migrations anteriores.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0029_tour_concluido.sql
git commit -m "feat: migration da flag tour_concluido em players"
```

---

### Task 2: Servidor — endpoint `PUT /api/players/me/tour-concluido`

**Files:**
- Modify: `site/server/src/routes/players.js`
- Test: `site/server/test/players.test.js`

**Interfaces:**
- Consumes: `req.player.steamId` (de `requireAuth`, já usado por todas as rotas `/me*` deste arquivo).
- Produces: rota `PUT /api/players/me/tour-concluido` — sem corpo de entrada, `200 { ok: true }` em sucesso, `401` sem login (via `requireAuth`, mesmo comportamento das outras rotas `/me*`).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `site/server/test/players.test.js` (depois do `describe('PUT /api/players/me/ranking-publico', ...)`):

```js
describe('PUT /api/players/me/tour-concluido', () => {
  it('sem login: 401', async () => {
    const { app } = appWith()
    expect((await request(app).put('/api/players/me/tour-concluido')).status).toBe(401)
  })

  it('marca o tour como concluido pro jogador logado', async () => {
    const { app, db } = appWith()
    const res = await request(app).put('/api/players/me/tour-concluido').set('Cookie', memberCookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(db.query.mock.calls[0][0]).toContain('update players set tour_concluido = true')
    expect(db.query.mock.calls[0][1]).toEqual(['76561198000000002'])
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd site/server && npx vitest run test/players.test.js -t "tour-concluido"`
Expected: FAIL (rota não existe, 404)

- [ ] **Step 3: Implementar a rota**

Em `site/server/src/routes/players.js`, logo depois do bloco `router.put('/me/ranking-publico', ...)` (linhas 98-102):

```js
  router.put('/me/tour-concluido', requireAuth, async (req, res) => {
    await db.query('update players set tour_concluido = true where steam_id64 = $1', [req.player.steamId])
    res.json({ ok: true })
  })
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd site/server && npx vitest run test/players.test.js -t "tour-concluido"`
Expected: PASS (2 testes)

- [ ] **Step 5: Rodar a suíte inteira do servidor pra garantir que nada quebrou**

Run: `cd site/server && npx vitest run`
Expected: todos os testes passam

- [ ] **Step 6: Commit**

```bash
git add site/server/src/routes/players.js site/server/test/players.test.js
git commit -m "feat: endpoint PUT /api/players/me/tour-concluido"
```

---

### Task 3: Servidor — expor `tourConcluido` em `GET /api/auth/me`

**Files:**
- Modify: `site/server/src/routes/auth.js:64-88`
- Test: `site/server/test/auth.test.js`

**Interfaces:**
- Produces: `GET /api/auth/me` passa a incluir `tourConcluido: boolean` no corpo da resposta, usado pelo client (Task 6, via `useAuth()`/`jogador.tourConcluido`).

- [ ] **Step 1: Atualizar a fixture e o teste que falha**

Em `site/server/test/auth.test.js`, adicionar `tour_concluido: false` à fixture `JOGADOR` (linha ~19, junto de `faceit_nick: null`):

```js
const JOGADOR = {
  steam_id64: '76561198012345678',
  nick: 'fih',
  avatar_url: 'https://avatars.steamstatic.com/x.jpg',
  is_super_admin: true,
  grupo_ativo_id: 'g1',
  ranking_publico: false,
  faceit_nick: null,
  tour_concluido: false,
}
```

E atualizar o `toEqual` do teste `'com cookie válido: retorna o jogador'` (linha ~128-137) pra incluir o campo novo:

```js
    expect(res.body).toEqual({
      steamId: JOGADOR.steam_id64,
      nick: 'fih',
      avatarUrl: JOGADOR.avatar_url,
      isSuperAdmin: true,
      grupoAtivoId: 'g1',
      rankingPublico: false,
      faceitNick: null,
      tourConcluido: false,
      souAdminDoGrupo: true,
    })
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd site/server && npx vitest run test/auth.test.js -t "retorna o jogador"`
Expected: FAIL (`tourConcluido` ausente no `res.body` recebido — `toEqual` não bate)

- [ ] **Step 3: Implementar**

Em `site/server/src/routes/auth.js`, na rota `GET /me` (linhas 63-88):

```js
  router.get('/me', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      'select steam_id64, nick, avatar_url, is_super_admin, grupo_ativo_id, ranking_publico, faceit_nick, tour_concluido from players where steam_id64 = $1',
      [req.player.steamId],
    )
    if (rows.length === 0) return res.status(401).json({ erro: 'Jogador não encontrado' })
    const p = rows[0]
    let souAdminDoGrupo
    if (p.grupo_ativo_id) {
      const papel = await db.query(
        'select role from group_members where group_id = $1 and steam_id64 = $2',
        [p.grupo_ativo_id, p.steam_id64],
      )
      souAdminDoGrupo = papel.rows[0]?.role === 'admin'
    }
    res.json({
      steamId: p.steam_id64,
      nick: p.nick,
      avatarUrl: p.avatar_url,
      isSuperAdmin: p.is_super_admin,
      grupoAtivoId: p.grupo_ativo_id,
      rankingPublico: p.ranking_publico,
      faceitNick: p.faceit_nick,
      tourConcluido: p.tour_concluido,
      ...(souAdminDoGrupo !== undefined ? { souAdminDoGrupo } : {}),
    })
  })
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd site/server && npx vitest run test/auth.test.js`
Expected: PASS (todos os testes de `auth.test.js`)

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/auth.js site/server/test/auth.test.js
git commit -m "feat: expoe tourConcluido em GET /api/auth/me"
```

---

### Task 4: Cliente — `PassoAPassoSteam` + integração em Minha Conta

**Files:**
- Create: `site/client/src/components/PassoAPassoSteam.jsx`
- Test: `site/client/src/test/PassoAPassoSteam.test.jsx`
- Modify: `site/client/src/pages/Perfil.jsx:1-60`

**Interfaces:**
- Produces: componente `<PassoAPassoSteam />` (sem props), exportado default — consumido por `Perfil.jsx` (esta task) e por `Tour.jsx` (Task 5).

- [ ] **Step 1: Escrever o teste que falha**

Criar `site/client/src/test/PassoAPassoSteam.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import PassoAPassoSteam from '../components/PassoAPassoSteam.jsx'

describe('PassoAPassoSteam', () => {
  it('mostra o link de ajuda da Steam e os dois formatos de código', () => {
    const { getByRole, getByText } = render(<PassoAPassoSteam />)
    const link = getByRole('link', { name: /steam.*ajuda/i })
    expect(link).toHaveAttribute(
      'href',
      'https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128',
    )
    expect(getByText('XXXX-XXXXX-XXXX')).toBeInTheDocument()
    expect(getByText('CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx')).toBeInTheDocument()
    expect(getByText(/gerenciar meus códigos de autenticação/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd site/client && npx vitest run src/test/PassoAPassoSteam.test.jsx`
Expected: FAIL (`Failed to resolve import "../components/PassoAPassoSteam.jsx"`)

- [ ] **Step 3: Implementar o componente**

Criar `site/client/src/components/PassoAPassoSteam.jsx`:

```jsx
// Passo a passo de como pegar os dois códigos Steam (autenticação de histórico + share
// code) — usado tanto em Minha Conta quanto no passo 2 do Tour. Só texto/instrução; o
// formulário de inputs continua em quem usa este componente.
export default function PassoAPassoSteam() {
  return (
    <div className="space-y-3 font-mono text-sm leading-relaxed text-texto-fraco">
      <p>
        Para o Resenha achar suas Partidas de matchmaking, cole seu código de autenticação de
        histórico e um share code de partida. Os dois ficam na mesma página da Steam:
      </p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          Clique no link abaixo — ele tenta abrir direto a página de códigos (pode pedir login
          se você não estiver logado no navegador):{' '}
          <a
            className="text-destaque underline"
            href="https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128"
            target="_blank"
            rel="noreferrer"
          >
            Steam → Ajuda → Compartilhar histórico de partidas
          </a>
          .
        </li>
        <li>
          Se cair na Central de Ajuda em vez de ir direto pra página de códigos: clique no
          produto <span className="text-texto">Counter-Strike 2</span> na lista de produtos
          recentes.
        </li>
        <li>
          Clique em <span className="text-texto">"Gerenciar meus códigos de autenticação"</span>{' '}
          (fica no fim da lista de opções, abaixo de "remover jogo da conta").
        </li>
        <li>
          A página mostra dois valores — copie{' '}
          <span className="text-texto">"Código de autenticação"</span> (o de histórico, formato{' '}
          <span className="text-texto">XXXX-XXXXX-XXXX</span>) no primeiro campo abaixo, e{' '}
          <span className="text-texto">"Seu token de partida mais recente"</span> (o share code,
          formato <span className="text-texto">CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx</span>) no
          segundo.
        </li>
      </ol>
      <p>
        A busca anda <span className="text-texto">pra frente</span> a partir do código
        informado — use o <span className="text-texto">"primeiro código de partilha"</span>{' '}
        dessa página da Steam pra puxar seu histórico inteiro, ou um código recente pra começar
        só das partidas novas.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd site/client && npx vitest run src/test/PassoAPassoSteam.test.jsx`
Expected: PASS

- [ ] **Step 5: Trocar o parágrafo de Perfil.jsx pelo componente**

Em `site/client/src/pages/Perfil.jsx`, adicionar o import no topo (depois da linha 3):

```jsx
import PassoAPassoSteam from '../components/PassoAPassoSteam.jsx'
```

E substituir o bloco do parágrafo único (linhas 46-60, de `<p className="mb-4 font-mono...` até o `</p>` que fecha antes de `<form onSubmit={salvar}...`) por:

```jsx
          <PassoAPassoSteam />
          <form onSubmit={salvar} className="mt-4 space-y-3">
```

(o `mt-4` no lugar do `mb-4` que estava no `<p>` original, pra manter o espaçamento entre a instrução e o formulário).

- [ ] **Step 6: Rodar a suíte do cliente pra garantir que nada quebrou**

Run: `cd site/client && npx vitest run`
Expected: todos os testes passam

- [ ] **Step 7: Conferir visualmente**

Suba o dev server do client (`cd site/client && npm run dev`) e abra `/conta` logado — confirme
que o passo a passo numerado aparece acima do formulário de códigos, com o link funcionando.

- [ ] **Step 8: Commit**

```bash
git add site/client/src/components/PassoAPassoSteam.jsx site/client/src/test/PassoAPassoSteam.test.jsx site/client/src/pages/Perfil.jsx
git commit -m "feat: passo a passo numerado de como pegar os codigos Steam em Minha Conta"
```

---

### Task 5: Cliente — página `Tour.jsx`

**Files:**
- Create: `site/client/src/pages/Tour.jsx`

**Interfaces:**
- Consumes: `useAuth()` → `jogador.faceitNick` (de `auth/AuthContext.jsx`, já existente); `<PassoAPassoSteam />` (Task 4); `Card`, `SectionHeader`, `Badge` de `../components/ui`.
- Produces: componente `Tour` (export default), consumido pela rota `/tour` na Task 6. Faz `PUT /api/players/me` (mesmo contrato já usado por `Perfil.jsx`) e `PUT /api/players/me/tour-concluido` (Task 2) diretamente, sem endpoint novo.

- [ ] **Step 1: Criar a página**

Criar `site/client/src/pages/Tour.jsx`:

```jsx
import { useState } from 'react'
import { Card, SectionHeader, Badge } from '../components/ui'
import { useAuth } from '../auth/AuthContext.jsx'
import PassoAPassoSteam from '../components/PassoAPassoSteam.jsx'

const TOTAL_PASSOS = 4

export default function Tour() {
  const { jogador } = useAuth()
  const [passo, setPasso] = useState(0)
  const [matchAuthCode, setMatchAuthCode] = useState('')
  const [lastShareCode, setLastShareCode] = useState('')
  const [mensagem, setMensagem] = useState(null)

  async function concluir() {
    await fetch('/api/players/me/tour-concluido', { method: 'PUT' })
    window.location.href = '/'
  }

  async function salvarSteam(e) {
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
    <div className="mx-auto max-w-lg space-y-6 py-10">
      <SectionHeader
        titulo="Bem-vindo ao Resenha"
        acao={
          <button
            type="button"
            onClick={concluir}
            className="font-mono text-xs uppercase tracking-wide text-texto-fraco underline"
          >
            Pular tour
          </button>
        }
      />

      {passo === 0 && (
        <Card className="p-4 sm:p-5">
          <p className="font-mono text-sm leading-relaxed text-texto-fraco">
            O Resenha acompanha as Partidas de matchmaking do seu grupo — estatísticas,
            ranking, granadas e táticas puxadas direto das suas demos. Esse tour rápido mostra
            como configurar sua conta e onde achar cada coisa no menu.
          </p>
        </Card>
      )}

      {passo === 1 && (
        <Card className="space-y-4 p-4 sm:p-5">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto">
            Vincular Steam
          </h3>
          <PassoAPassoSteam />
          <form onSubmit={salvarSteam} className="space-y-3">
            <div>
              <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="tourAuthCode">
                Código de autenticação de histórico
              </label>
              <input
                id="tourAuthCode"
                value={matchAuthCode}
                onChange={(e) => setMatchAuthCode(e.target.value)}
                className="panel-cut-sm min-h-10 w-full border border-borda bg-superficie px-3 py-2 font-mono text-sm lg:min-h-0"
                placeholder="XXXX-XXXXX-XXXX"
              />
            </div>
            <div>
              <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="tourShareCode">
                Share code de partida (ponto de partida da busca)
              </label>
              <input
                id="tourShareCode"
                value={lastShareCode}
                onChange={(e) => setLastShareCode(e.target.value)}
                className="panel-cut-sm min-h-10 w-full border border-borda bg-superficie px-3 py-2 font-mono text-sm lg:min-h-0"
                placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"
              />
            </div>
            <button
              type="submit"
              className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo lg:min-h-0 lg:w-auto"
            >
              Salvar códigos
            </button>
          </form>
          {mensagem && <p className="font-mono text-sm text-texto-fraco">{mensagem}</p>}
        </Card>
      )}

      {passo === 2 && (
        <Card className="flex items-center justify-between gap-3 p-4 sm:p-5">
          <div>
            <p className="font-display text-sm font-semibold uppercase tracking-wide text-texto">
              FACEIT (opcional)
            </p>
            <p className="font-mono text-xs text-texto-fraco">
              {jogador?.faceitNick
                ? `Vinculado como ${jogador.faceitNick}.`
                : 'Vincule pra importar suas partidas da FACEIT automaticamente — pode fazer isso depois em Minha conta também.'}
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
      )}

      {passo === 3 && (
        <Card className="space-y-3 p-4 sm:p-5 font-mono text-sm leading-relaxed text-texto-fraco">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto">
            Onde achar cada coisa
          </h3>
          <p><span className="text-texto">Partidas / Ranking / Ranking público</span> — acompanhar desempenho seu e do grupo.</p>
          <p><span className="text-texto">Enviar demo</span> — subir uma partida que não veio do matchmaking automático (ex.: scrim, campeonato).</p>
          <p><span className="text-texto">Jogadores / Comparar / Times</span> — perfis individuais e comparações entre jogadores ou times.</p>
          <p><span className="text-texto">Granadas / Táticas</span> — biblioteca de lineups e jogadas do grupo.</p>
          <p><span className="text-texto">Minha conta</span> — onde reconfigurar tudo isso (Steam, FACEIT, ranking público) depois.</p>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setPasso((p) => Math.max(0, p - 1))}
          disabled={passo === 0}
          className="panel-cut-sm min-h-10 border border-borda px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco disabled:opacity-40 lg:min-h-0"
        >
          Voltar
        </button>
        {passo < TOTAL_PASSOS - 1 ? (
          <button
            type="button"
            onClick={() => setPasso((p) => p + 1)}
            className="panel-cut-sm min-h-10 border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo lg:min-h-0"
          >
            Próximo
          </button>
        ) : (
          <button
            type="button"
            onClick={concluir}
            className="panel-cut-sm min-h-10 border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo lg:min-h-0"
          >
            Concluir
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

Sem teste isolado nesta task — a página é exercitada pelo teste de integração da Task 6
(rota `/tour` + gate). Confirmar só que não há erro de sintaxe/import:

Run: `cd site/client && npx vitest run` (nenhum teste novo ainda referencia `Tour.jsx`, então
isso só confirma que a suíte atual continua passando e o arquivo importa sem erro quando a
Task 6 o referenciar)

```bash
git add site/client/src/pages/Tour.jsx
git commit -m "feat: pagina do tour guiado (Vincular Steam/FACEIT/menu)"
```

---

### Task 6: Cliente — rota `/tour`, gate automático e link "Ajuda"

**Files:**
- Modify: `site/client/src/App.jsx`
- Modify: `site/client/src/components/Shell.jsx:263-279`
- Test: `site/client/src/test/App.test.jsx`

**Interfaces:**
- Consumes: `Tour` (Task 5), `jogador.tourConcluido` (Task 3, via `useAuth()`).
- Produces: rota `/tour`; `RotaProtegida`/`RotaAdmin` redirecionam pra `/tour` quando
  `jogador.grupoAtivoId` existe mas `!jogador.tourConcluido`; link "Ajuda" em `Shell.jsx`
  sempre visível levando pra `/tour`.

- [ ] **Step 1: Corrigir o teste existente que vai quebrar (fixture sem `tourConcluido`)**

Em `site/client/src/test/App.test.jsx`, o teste `'logado: mostra o shell com o nick do
jogador'` (linha 39-46) hoje faz `mockMe({ ..., grupoAtivoId: 'g1' })` sem `tourConcluido` —
depois desta task, `!undefined` é `true` e o gate vai redirecionar esse jogador pro tour em
vez de mostrar o Feed, quebrando o teste. Atualizar a chamada:

```js
  it('logado: mostra o shell com o nick do jogador', async () => {
    mockMe({ steamId: '765', nick: 'fih', avatarUrl: null, isSuperAdmin: false, grupoAtivoId: 'g1', tourConcluido: true })
    render(<App />)
    expect(await screen.findByText('fih')).toBeInTheDocument()
    expect(await screen.findByText(/nenhuma partida/i)).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /ajuda/i })).toHaveAttribute('href', '/tour')
  })
```

(a última linha nova cobre o link "Ajuda" da Shell, adicionado no Step 4 abaixo.)

E adicionar um teste novo logo depois, cobrindo o gate automático do tour:

```js
  it('logado com grupo mas tour nao concluido: redireciona pro tour', async () => {
    mockMe({ steamId: '765', nick: 'fih', avatarUrl: null, isSuperAdmin: false, grupoAtivoId: 'g1', tourConcluido: false })
    render(<App />)
    expect(await screen.findByText('Bem-vindo ao Resenha')).toBeInTheDocument()
    expect(await screen.findByText(/pular tour/i)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd site/client && npx vitest run src/test/App.test.jsx`
Expected: FAIL — o teste "mostra o shell" falha no `findByRole('link', { name: /ajuda/i })`
(link ainda não existe) e o teste novo falha porque `/tour` não existe (o Feed renderiza no
lugar, sem o texto "Bem-vindo ao Resenha").

- [ ] **Step 3: Adicionar a rota e o gate em `App.jsx`**

Import novo, junto dos outros (depois da linha 24):

```jsx
import Tour from './pages/Tour.jsx'
```

`RotaProtegida` (linhas 26-32) ganha a checagem de tour, depois da de `grupoAtivoId`:

```jsx
function RotaProtegida({ children }) {
  const { carregando, jogador } = useAuth()
  if (carregando) return <p className="p-8 text-texto-fraco">Carregando…</p>
  if (!jogador) return <Navigate to="/entrar" replace />
  if (!jogador.grupoAtivoId) return <Navigate to="/bem-vindo" replace />
  if (!jogador.tourConcluido) return <Navigate to="/tour" replace />
  return <Shell>{children}</Shell>
}
```

`RotaAdmin` (linhas 34-41) ganha a mesma checagem, pelo mesmo motivo (é o mesmo padrão
duplicado que já existe entre as duas funções pra `grupoAtivoId`):

```jsx
function RotaAdmin({ children }) {
  const { carregando, jogador } = useAuth()
  if (carregando) return <p className="p-8 text-texto-fraco">Carregando…</p>
  if (!jogador) return <Navigate to="/entrar" replace />
  if (!jogador.grupoAtivoId) return <Navigate to="/bem-vindo" replace />
  if (!jogador.tourConcluido) return <Navigate to="/tour" replace />
  if (!jogador.isSuperAdmin) return <Navigate to="/" replace />
  return <Shell>{children}</Shell>
}
```

Nova rota, logo depois de `/bem-vindo` (linha 53):

```jsx
          <Route path="/tour" element={<RotaTour><Tour /></RotaTour>} />
```

E a função de gate, depois de `RotaBemVindo` (final do arquivo, depois da linha 82):

```jsx
// Tour é a segunda página protegida que NÃO exige tourConcluido (é ela quem zera a flag);
// exige grupoAtivoId como as demais rotas, já que o passo 4 explica seções do menu que só
// existem depois de ter um grupo.
function RotaTour({ children }) {
  const { carregando, jogador } = useAuth()
  if (carregando) return <p className="p-8 text-texto-fraco">Carregando…</p>
  if (!jogador) return <Navigate to="/entrar" replace />
  if (!jogador.grupoAtivoId) return <Navigate to="/bem-vindo" replace />
  return children
}
```

- [ ] **Step 4: Adicionar o link "Ajuda" em `Shell.jsx`**

Em `site/client/src/components/Shell.jsx`, dentro do `<div className="flex min-w-0 items-center gap-3">` do header (linha 263), adicionar o link antes do botão "Sair" (antes da linha 273):

```jsx
            <a
              href="/tour"
              title="Como usar o Resenha"
              className="panel-cut-sm flex min-h-10 shrink-0 items-center border border-borda px-2.5 py-1 text-xs uppercase tracking-wide text-texto-fraco transition-colors hover:border-destaque/50 hover:text-destaque lg:min-h-0"
            >
              Ajuda
            </a>
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `cd site/client && npx vitest run src/test/App.test.jsx`
Expected: PASS (4 testes: sem login, logado com tour concluído, logado sem tour concluído,
mais os dois já existentes)

- [ ] **Step 6: Rodar a suíte inteira do cliente**

Run: `cd site/client && npx vitest run`
Expected: todos os testes passam

- [ ] **Step 7: Conferir visualmente**

Suba o dev server (`cd site/client && npm run dev`), entre com uma conta cujo jogador tenha
`grupoAtivoId` mas `tourConcluido: false` no banco (ou zere a coluna pra sua própria conta de
teste) e confirme que cai direto no `/tour`; clique "Pular tour" e confirme que volta a
navegar normalmente sem cair no tour de novo; confirme que o link "Ajuda" no header abre
`/tour` mesmo com o tour já concluído.

- [ ] **Step 8: Commit**

```bash
git add site/client/src/App.jsx site/client/src/components/Shell.jsx site/client/src/test/App.test.jsx
git commit -m "feat: gate automatico do tour guiado e link Ajuda na Shell"
```

---

## Fora de escopo (herdado do spec)

- Overlay/spotlight destacando elementos reais da UI — o tour é página dedicada, não coachmark.
- Assets de imagem com os prints reais enviados pelo usuário — conteúdo é só texto.
- Reabrir o tour automaticamente após já concluído (ex.: quando uma seção nova do menu for lançada).
