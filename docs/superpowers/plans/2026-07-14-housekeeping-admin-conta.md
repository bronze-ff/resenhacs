# Housekeeping: páginas admin-only, Enviar Demo e renomear Perfil — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restringir Granadas/Táticas/Partidas Pro/Admin ao admin (nav + rota + API), redesenhar Enviar Demo, e renomear a aba "Perfil" (que hoje é config de conta, não perfil de jogador) para "Minha conta" em `/conta`.

**Architecture:** Front (React/Vite) já tem `RotaProtegida` em `App.jsx` e `jogador.isAdmin` via `useAuth()`; back já tem `requireAdmin` em `site/server/src/auth/middleware.js`. Este trabalho é composição dessas peças existentes — sem migration, sem endpoint novo.

**Tech Stack:** React Router v6, Express, Vitest + Testing Library (client), Vitest + supertest (server).

## Global Constraints

- Rota `/perfil` vira `/conta` — sem redirect de compatibilidade (spec confirmou que não há link externo apontando pra `/perfil`).
- `POST /api/taticas` continua aberto a qualquer jogador autenticado (fluxo de sugestão) — só o `GET /` de listagem vira admin-only. Não alterar o comportamento de POST.
- Todo novo trecho de UI usa os primitivos existentes (`Card`, `SectionHeader`) — não introduzir HTML cru novo nas páginas tocadas.
- Não mexer em Multi-tenancy, Times ou Ranking público — fora de escopo deste plano.

---

### Task 1: Servidor — admin-gate no `GET` de listagem de Granadas e Táticas

**Files:**
- Modify: `site/server/src/routes/granadas.js:64` (GET `/`) e `:90` (GET `/contagem`)
- Modify: `site/server/src/routes/taticas.js:7` (GET `/`)
- Test: `site/server/test/granadas.test.js`
- Test: `site/server/test/taticas.test.js`

**Interfaces:**
- Consumes: `requireAdmin` já importado em ambos os arquivos de rota (usado noutras rotas do mesmo arquivo).
- Produces: nada consumido por outra task — mudança isolada de middleware chain.

- [ ] **Step 1: Escrever/ajustar os testes que devem falhar primeiro**

Em `site/server/test/granadas.test.js`, troque o describe `GET /api/granadas` inteiro por:

```js
describe('GET /api/granadas', () => {
  it('anonimo: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/granadas')).status).toBe(401)
  })

  it('jogador comum: 403 (pagina ainda em teste, admin-only)', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/granadas').set('Cookie', cookieJogador)).status).toBe(403)
  })

  it('admin lista com filtros validados e camelCase', async () => {
    const { app, db } = appWith([['from lineups_curados', [LINHA]]])
    const res = await request(app)
      .get('/api/granadas?map=de_mirage&lado=T&tipo=smoke')
      .set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({
      id: 'g1', videoUrl: 'https://youtu.be/abcdefghijk', arremessoX: 0.2, alvoY: 0.3,
      passos: ['mire no pixel', 'jumpthrow'], tecnica: 'jumpthrow',
    })
    expect(db.query.mock.calls[0][1]).toEqual(['de_mirage', 'T', 'smoke'])
  })

  it('filtro invalido e ignorado (nao vira SQL)', async () => {
    const { app, db } = appWith([['from lineups_curados', []]])
    await request(app).get("/api/granadas?map=x';drop&lado=Z&tipo=nuke").set('Cookie', cookieAdmin)
    expect(db.query.mock.calls[0][1]).toEqual([])
  })
})
```

E o describe `GET /api/granadas/contagem`:

```js
describe('GET /api/granadas/contagem', () => {
  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/granadas/contagem').set('Cookie', cookieJogador)).status).toBe(403)
  })

  it('agrupa por mapa e tipo', async () => {
    const { app } = appWith([['group by map, tipo', [{ map: 'de_mirage', tipo: 'smoke', total: '3' }]]])
    const res = await request(app).get('/api/granadas/contagem').set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    expect(res.body[0]).toEqual({ map: 'de_mirage', tipo: 'smoke', total: 3 })
  })
})
```

Em `site/server/test/taticas.test.js`, troque o describe `GET /api/taticas` por:

```js
describe('GET /api/taticas', () => {
  it('jogador comum: 403 (pagina ainda em teste, admin-only)', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/taticas?map=de_mirage').set('Cookie', cookieJogador)).status).toBe(403)
  })

  it('admin lista só aprovadas por padrao', async () => {
    const { app, db } = appWith([['from taticas', []]])
    await request(app).get('/api/taticas?map=de_mirage').set('Cookie', cookieAdmin)
    expect(db.query.mock.calls[0][0]).toContain("status = 'aprovada'")
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd site/server && npx vitest run test/granadas.test.js test/taticas.test.js`
Expected: FAIL nos testes que esperam 403/200-com-cookieAdmin (rota ainda só exige `requireAuth`, então devolve 200 pro jogador comum e os asserts de status quebram).

- [ ] **Step 3: Aplicar `requireAdmin` nas rotas**

Em `site/server/src/routes/granadas.js`, linha 64:

```js
  router.get('/', requireAuth, requireAdmin, async (req, res) => {
```

Linha 90 (mesmo arquivo):

```js
  router.get('/contagem', requireAuth, requireAdmin, async (req, res) => {
```

Em `site/server/src/routes/taticas.js`, linha 7:

```js
  router.get('/', requireAuth, requireAdmin, async (req, res) => {
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd site/server && npx vitest run test/granadas.test.js test/taticas.test.js`
Expected: PASS (todos os testes dos dois arquivos).

- [ ] **Step 5: Rodar a suíte completa do servidor**

Run: `cd site/server && npm test`
Expected: PASS (nenhuma outra suíte depende do `GET /api/granadas` ou `GET /api/taticas` sem cookie de admin — `taticasCuradas.test.js` é rota separada, não tocada).

- [ ] **Step 6: Commit**

```bash
git add site/server/src/routes/granadas.js site/server/src/routes/taticas.js site/server/test/granadas.test.js site/server/test/taticas.test.js
git commit -m "feat: restringe listagem de granadas e taticas ao admin"
```

---

### Task 2: Client — guarda de rota admin-only + renomear `/perfil` para `/conta`

**Files:**
- Modify: `site/client/src/App.jsx`

**Interfaces:**
- Consumes: `useAuth()` (já usado em `RotaProtegida`, mesmo arquivo), componente `Shell` (mesmo arquivo).
- Produces: componente `RotaAdmin` — Task 3 não depende dele (Shell só lê `jogador.isAdmin` direto), mas é o gate real contra acesso via URL direta.

- [ ] **Step 1: Adicionar `RotaAdmin` logo abaixo de `RotaProtegida`**

Em `site/client/src/App.jsx`, após a função `RotaProtegida` (linha 25), adicionar:

```jsx
function RotaAdmin({ children }) {
  const { carregando, jogador } = useAuth()
  if (carregando) return <p className="p-8 text-texto-fraco">Carregando…</p>
  if (!jogador) return <Navigate to="/entrar" replace />
  if (!jogador.isAdmin) return <Navigate to="/" replace />
  return <Shell>{children}</Shell>
}
```

- [ ] **Step 2: Trocar as rotas de Granadas, Táticas, Admin e Partidas Pro pra usar `RotaAdmin`**

Substituir estas 4 linhas (hoje usam `RotaProtegida`):

```jsx
          <Route path="/granadas" element={<RotaProtegida><Granadas /></RotaProtegida>} />
          <Route path="/taticas" element={<RotaProtegida><Taticas /></RotaProtegida>} />
          <Route path="/perfil" element={<RotaProtegida><Perfil /></RotaProtegida>} />
          <Route path="/admin" element={<RotaProtegida><Admin /></RotaProtegida>} />
          <Route path="/partidas-pro" element={<RotaProtegida><PartidasPro /></RotaProtegida>} />
```

por:

```jsx
          <Route path="/granadas" element={<RotaAdmin><Granadas /></RotaAdmin>} />
          <Route path="/taticas" element={<RotaAdmin><Taticas /></RotaAdmin>} />
          <Route path="/conta" element={<RotaProtegida><Perfil /></RotaProtegida>} />
          <Route path="/admin" element={<RotaAdmin><Admin /></RotaAdmin>} />
          <Route path="/partidas-pro" element={<RotaAdmin><PartidasPro /></RotaAdmin>} />
```

(nota: `/perfil` virou `/conta` na mesma troca — mesmo componente `Perfil`, rota nova.)

- [ ] **Step 3: Rodar a suíte de client e confirmar que passa**

Run: `cd site/client && npm test`
Expected: PASS (o `App.test.jsx` existente não referencia `/perfil`, `/granadas` nem `/taticas` diretamente — só a Feed em `/`).

- [ ] **Step 4: Commit**

```bash
git add site/client/src/App.jsx
git commit -m "feat: guarda de rota admin-only e renomeia /perfil para /conta"
```

---

### Task 3: Client — Shell.jsx: mover Granadas/Táticas pro bloco admin, renomear item Perfil, barra inferior dinâmica

**Files:**
- Modify: `site/client/src/components/Shell.jsx`

**Interfaces:**
- Consumes: `jogador?.isAdmin` (já lido no componente `Shell`, linha 128).
- Produces: nada consumido por outra task deste plano.

- [ ] **Step 1: Tirar Granadas/Táticas do array `ITENS` e renomear/redirecionar o item de Perfil**

Substituir o array `ITENS` (linhas 7–16):

```js
const ITENS = [
  { to: '/', end: true, label: 'Partidas', num: '01', icone: 'partidas' },
  { to: '/ranking', label: 'Ranking', num: '02', icone: 'ranking' },
  { to: '/enviar-demo', label: 'Enviar demo', num: '03', icone: 'enviarDemo' },
  { to: '/jogadores', label: 'Jogadores', num: '04', icone: 'jogadores' },
  { to: '/comparar', label: 'Comparar', num: '05', icone: 'comparar' },
  { to: '/granadas', label: 'Granadas', num: '06', icone: 'granadas' },
  { to: '/taticas', label: 'Táticas', num: '07', icone: 'taticas' },
  { to: '/perfil', label: 'Meu perfil', num: '08', icone: 'perfil' },
]
```

por:

```js
const ITENS = [
  { to: '/', end: true, label: 'Partidas', num: '01', icone: 'partidas' },
  { to: '/ranking', label: 'Ranking', num: '02', icone: 'ranking' },
  { to: '/enviar-demo', label: 'Enviar demo', num: '03', icone: 'enviarDemo' },
  { to: '/jogadores', label: 'Jogadores', num: '04', icone: 'jogadores' },
  { to: '/comparar', label: 'Comparar', num: '05', icone: 'comparar' },
  { to: '/conta', label: 'Minha conta', num: '06', icone: 'perfil' },
]
```

- [ ] **Step 2: Adicionar Granadas e Táticas no bloco admin-only da sidebar, antes de Admin/Partidas Pro**

No bloco `{jogador?.isAdmin && (...)}` (linhas 201–226 antes da mudança), inserir os dois novos `NavLink` ANTES do de Admin, e renumerar Admin pra `09` e Partidas Pro pra `10` (mantendo o valor atual):

```jsx
          {jogador?.isAdmin && (
            <>
              <NavLink
                to="/granadas"
                className={classeItem}
                onClick={fecharMenu}
                title={colapsada ? 'Granadas' : undefined}
                aria-label={colapsada ? 'Granadas' : undefined}
              >
                <span className="shrink-0">{NAV_ICONES.granadas}</span>
                <span className={`font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque ${colapsada ? 'lg:hidden' : ''}`}>07</span>
                <span className={colapsada ? 'lg:hidden' : ''}>Granadas</span>
              </NavLink>
              <NavLink
                to="/taticas"
                className={classeItem}
                onClick={fecharMenu}
                title={colapsada ? 'Táticas' : undefined}
                aria-label={colapsada ? 'Táticas' : undefined}
              >
                <span className="shrink-0">{NAV_ICONES.taticas}</span>
                <span className={`font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque ${colapsada ? 'lg:hidden' : ''}`}>08</span>
                <span className={colapsada ? 'lg:hidden' : ''}>Táticas</span>
              </NavLink>
              <NavLink
                to="/admin"
                className={classeItem}
                onClick={fecharMenu}
                title={colapsada ? 'Admin' : undefined}
                aria-label={colapsada ? 'Admin' : undefined}
              >
                <span className="shrink-0">{NAV_ICONES.admin}</span>
                <span className={`font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque ${colapsada ? 'lg:hidden' : ''}`}>09</span>
                <span className={colapsada ? 'lg:hidden' : ''}>Admin</span>
              </NavLink>
              <NavLink
                to="/partidas-pro"
                className={classeItem}
                onClick={fecharMenu}
                title={colapsada ? 'Partidas pro' : undefined}
                aria-label={colapsada ? 'Partidas pro' : undefined}
              >
                <span className="shrink-0">{NAV_ICONES.partidasPro}</span>
                <span className={`font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque ${colapsada ? 'lg:hidden' : ''}`}>10</span>
                <span className={colapsada ? 'lg:hidden' : ''}>Partidas pro</span>
              </NavLink>
            </>
          )}
```

- [ ] **Step 3: Tornar `NAV_INFERIOR` (barra mobile) dinâmico por admin**

Substituir a constante `NAV_INFERIOR` (linhas 109–114):

```js
const NAV_INFERIOR = [
  { to: '/', end: true, label: 'Partidas', icone: 'partidas' },
  { to: '/ranking', label: 'Ranking', icone: 'ranking' },
  { to: '/granadas', label: 'Granadas', icone: 'granadas' },
  { to: '/taticas', label: 'Táticas', icone: 'taticas' },
]
```

por:

```js
const NAV_INFERIOR_BASE = [
  { to: '/', end: true, label: 'Partidas', icone: 'partidas' },
  { to: '/ranking', label: 'Ranking', icone: 'ranking' },
]

const NAV_INFERIOR_ADMIN = [
  { to: '/granadas', label: 'Granadas', icone: 'granadas' },
  { to: '/taticas', label: 'Táticas', icone: 'taticas' },
]
```

- [ ] **Step 4: Passar `isAdmin` pra `BarraInferior` e usar a lista dinâmica com grid dinâmico**

Trocar a chamada do componente (linha 273):

```jsx
      <BarraInferior menuAberto={menuAberto} onAbrirMenu={() => setMenuAberto(true)} />
```

por:

```jsx
      <BarraInferior menuAberto={menuAberto} onAbrirMenu={() => setMenuAberto(true)} isAdmin={jogador?.isAdmin} />
```

E o corpo do componente `BarraInferior` (linhas 281–323):

```jsx
function BarraInferior({ menuAberto, onAbrirMenu }) {
  const location = useLocation()

  function itemNavClasse({ isActive }) {
    return `flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-mono uppercase tracking-wide transition-colors ${
      isActive ? 'text-destaque' : 'text-texto-fraco'
    }`
  }

  const maisAtivo = menuAberto
  // "Mais" também deve acender quando a rota atual não é nenhuma das 4
  // principais (ex.: /jogadores, /comparar, /perfil, /admin) — senão nenhum
  // ícone fica ativo nessas telas.
  const rotaCobertaPelasPrincipais = NAV_INFERIOR.some((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)
  )

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-borda bg-superficie pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Navegação principal"
    >
      {NAV_INFERIOR.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={itemNavClasse}>
          {NAV_ICONES[item.icone]}
          {item.label}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onAbrirMenu}
        aria-label="Mais opções"
        aria-expanded={menuAberto}
        className={`flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-mono uppercase tracking-wide transition-colors ${
          maisAtivo || !rotaCobertaPelasPrincipais ? 'text-destaque' : 'text-texto-fraco'
        }`}
      >
        {NAV_ICONES.mais}
        Mais
      </button>
    </nav>
  )
}
```

vira:

```jsx
function BarraInferior({ menuAberto, onAbrirMenu, isAdmin }) {
  const location = useLocation()
  // Granadas/Táticas só entram na barra mobile pra admin — o grid tem que
  // ganhar/perder coluna junto, senão sobra espaço vazio ou "Mais" some.
  const itens = isAdmin ? [...NAV_INFERIOR_BASE, ...NAV_INFERIOR_ADMIN] : NAV_INFERIOR_BASE

  function itemNavClasse({ isActive }) {
    return `flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-mono uppercase tracking-wide transition-colors ${
      isActive ? 'text-destaque' : 'text-texto-fraco'
    }`
  }

  const maisAtivo = menuAberto
  // "Mais" também deve acender quando a rota atual não é nenhum dos itens
  // principais (ex.: /jogadores, /comparar, /conta, /admin) — senão nenhum
  // ícone fica ativo nessas telas.
  const rotaCobertaPelasPrincipais = itens.some((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)
  )

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 grid border-t border-borda bg-superficie pb-[env(safe-area-inset-bottom)] lg:hidden"
      style={{ gridTemplateColumns: `repeat(${itens.length + 1}, minmax(0, 1fr))` }}
      aria-label="Navegação principal"
    >
      {itens.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={itemNavClasse}>
          {NAV_ICONES[item.icone]}
          {item.label}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onAbrirMenu}
        aria-label="Mais opções"
        aria-expanded={menuAberto}
        className={`flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-mono uppercase tracking-wide transition-colors ${
          maisAtivo || !rotaCobertaPelasPrincipais ? 'text-destaque' : 'text-texto-fraco'
        }`}
      >
        {NAV_ICONES.mais}
        Mais
      </button>
    </nav>
  )
}
```

- [ ] **Step 5: Build e testes do client**

Run: `cd site/client && npm run build && npm test`
Expected: build limpo, testes PASS.

- [ ] **Step 6: Commit**

```bash
git add site/client/src/components/Shell.jsx
git commit -m "feat: menu — granadas/taticas viram admin-only, perfil vira minha conta"
```

---

### Task 4: Client — redesign de Enviar Demo (primitivos + dropzone)

**Files:**
- Modify: `site/client/src/pages/EnviarDemo.jsx`

**Interfaces:**
- Consumes: `Card`, `SectionHeader` de `../components/ui` (já usado em `Comparar.jsx`, `JogadorPerfil.jsx` etc.).
- Produces: nada consumido por outra task.

- [ ] **Step 1: Reescrever o componente com dropzone + Card**

Substituir o arquivo inteiro por:

```jsx
import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Card, SectionHeader } from '../components/ui'

function formatarTamanho(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function EnviarDemo() {
  const [arquivo, setArquivo] = useState(null)
  const [shareCode, setShareCode] = useState('')
  const [playedAt, setPlayedAt] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState(null)
  const [arrastando, setArrastando] = useState(false)

  function escolherArquivo(lista) {
    const f = lista?.[0]
    if (f && f.name.toLowerCase().endsWith('.dem')) setArquivo(f)
  }

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setArrastando(false)
    escolherArquivo(e.dataTransfer?.files)
  }, [])

  async function enviar(e) {
    e.preventDefault()
    if (!arquivo) return
    setEnviando(true)
    setErro(null)
    setResultado(null)
    const form = new FormData()
    form.append('demo', arquivo)
    if (shareCode) form.append('shareCode', shareCode)
    if (playedAt) form.append('playedAt', playedAt)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setResultado(body)
      } else {
        setErro(body.erro ?? 'Erro ao processar o demo')
      }
    } catch {
      setErro('Falha de rede ao enviar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <SectionHeader titulo="Enviar demo" />
      <p className="font-mono text-sm leading-relaxed text-texto-fraco">
        Baixe o .dem em CS2 → Assistir → Suas Partidas (ou do Faceit/GC) e envie aqui.
        O processamento roda no Coletor local e pode levar até um minuto.
      </p>

      <Card className="p-4 sm:p-5">
        <form onSubmit={enviar} className="space-y-4">
          <label
            htmlFor="arquivo"
            onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
            onDragLeave={() => setArrastando(false)}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 border border-dashed px-4 py-10 text-center transition-colors ${
              arrastando ? 'border-destaque bg-destaque/5' : 'border-borda hover:border-destaque/60'
            }`}
          >
            <span className="font-display text-sm font-semibold uppercase tracking-wide text-texto">
              {arquivo ? arquivo.name : 'Arraste o .dem aqui ou clique pra escolher'}
            </span>
            {arquivo && (
              <span className="font-mono text-xs text-texto-fraco">{formatarTamanho(arquivo.size)}</span>
            )}
            <input
              id="arquivo"
              type="file"
              accept=".dem"
              onChange={(e) => escolherArquivo(e.target.files)}
              className="hidden"
            />
          </label>

          <div>
            <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="shareCode">
              Share code (opcional, evita duplicar se descoberto automaticamente)
            </label>
            <input
              id="shareCode"
              value={shareCode}
              onChange={(e) => setShareCode(e.target.value)}
              placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"
              className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="playedAt">
              Quando foi jogada (opcional — sem isso, a data pode sair aproximada)
            </label>
            <input
              id="playedAt"
              type="datetime-local"
              value={playedAt}
              onChange={(e) => setPlayedAt(e.target.value)}
              className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={!arquivo || enviando}
            className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo transition-opacity disabled:opacity-40 lg:min-h-0 lg:w-auto"
          >
            {enviando ? 'Processando… (pode levar até 1 min)' : 'Enviar'}
          </button>
        </form>

        {erro && <p className="mt-4 font-mono text-sm text-perigo">{erro}</p>}
        {resultado && (
          <p className="mt-4 font-mono text-sm text-sucesso">
            Partida gravada!{' '}
            {resultado.matchId && (
              <Link to={`/partida/${resultado.matchId}`} className="underline">
                Ver partida
              </Link>
            )}
          </p>
        )}
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Build e testes do client**

Run: `cd site/client && npm run build && npm test`
Expected: build limpo, testes PASS (não há teste dedicado a `EnviarDemo.jsx` hoje — confirmar no `npm test` que nada mais quebrou).

- [ ] **Step 3: Commit**

```bash
git add site/client/src/pages/EnviarDemo.jsx
git commit -m "feat: redesign da pagina Enviar Demo com dropzone e primitivos"
```

---

### Task 5: Client — redesign de "Minha conta" (ex-Perfil) + seção reservada pra contas vinculadas

**Files:**
- Modify: `site/client/src/pages/Perfil.jsx`

**Interfaces:**
- Consumes: `Card`, `SectionHeader`, `Badge` de `../components/ui`.
- Produces: nada consumido por outra task — a seção "Contas vinculadas" é só visual (`disabled`), sem chamada de API; a Fase A do spec de FACEIT vai substituir esse bloco depois.

- [ ] **Step 1: Reescrever o componente**

Substituir o arquivo inteiro por:

```jsx
import { useState } from 'react'
import { Card, SectionHeader, Badge } from '../components/ui'

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
    <div className="max-w-lg space-y-6">
      <SectionHeader titulo="Minha conta" />

      <section className="space-y-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">
          Importação automática (Steam)
        </h3>
        <Card className="p-4 sm:p-5">
          <p className="mb-4 font-mono text-sm leading-relaxed text-texto-fraco">
            Para o Resenha achar suas Partidas de matchmaking, cole seu código de autenticação de
            histórico e um share code de partida. Pegue os dois em{' '}
            <a
              className="text-destaque underline"
              href="https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128"
              target="_blank"
              rel="noreferrer"
            >
              Steam → Ajuda → Compartilhar histórico de partidas
            </a>
            . A busca anda <span className="text-texto">pra frente</span> a partir do código informado —
            use o <span className="text-texto">"primeiro código de partilha"</span> dessa página da Steam
            pra puxar seu histórico inteiro, ou um código recente pra começar só das partidas novas.
          </p>
          <form onSubmit={salvar} className="space-y-3">
            <div>
              <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="authCode">
                Código de autenticação de histórico
              </label>
              <input
                id="authCode"
                value={matchAuthCode}
                onChange={(e) => setMatchAuthCode(e.target.value)}
                className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
                placeholder="XXXX-XXXXX-XXXX"
              />
            </div>
            <div>
              <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="shareCode">
                Share code de partida (ponto de partida da busca)
              </label>
              <input
                id="shareCode"
                value={lastShareCode}
                onChange={(e) => setLastShareCode(e.target.value)}
                className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
                placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"
              />
            </div>
            <button
              type="submit"
              className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo lg:min-h-0 lg:w-auto"
            >
              Salvar
            </button>
          </form>
          {mensagem && <p className="mt-3 font-mono text-sm text-texto-fraco">{mensagem}</p>}
        </Card>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">
          Contas vinculadas
        </h3>
        <Card className="flex items-center justify-between gap-3 p-4 sm:p-5">
          <div>
            <p className="font-display text-sm font-semibold uppercase tracking-wide text-texto">FACEIT</p>
            <p className="font-mono text-xs text-texto-fraco">Vincule pra importar suas partidas da FACEIT automaticamente.</p>
          </div>
          <Badge tom="neutro">Em breve</Badge>
        </Card>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Build e testes do client**

Run: `cd site/client && npm run build && npm test`
Expected: build limpo, testes PASS.

- [ ] **Step 3: Commit**

```bash
git add site/client/src/pages/Perfil.jsx
git commit -m "feat: redesign de Minha conta com secao reservada pra contas vinculadas"
```

---

## Fora de escopo (próximos planos)

- Multi-tenancy, Times, Ranking público — sub-projetos seguintes, cada um com seu próprio spec/plano.
- Implementação real do vínculo FACEIT (o `Badge "Em breve"` da Task 5 é só placeholder visual).
