# Clipes no Perfil + Filtro por Jogador na Aba Clipes — Plano de Implementação

> **Para quem for executar:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans pra rodar este plano tarefa por tarefa. Passos usam checkbox (`- [ ]`) pra acompanhamento.

**Objetivo:** o perfil de um jogador (`/jogador/:steamId`) ganha uma seção "Clipes" com
os 6 melhores clipes dele (por pontuação), com link "Ver todos →" que abre a aba Clipes
já filtrada nele; e a aba Clipes ganha um filtro por jogador (dropdown + deep link
`?jogador=<steamId>`), combinável com o filtro de período existente.

**Arquitetura:** o payload único do perfil (`GET /api/profile/:steamId`) ganha o campo
`clipes` (query nova no `Promise.all` existente, reaproveitando `periodoWhere`/
`visivelWhere`); o card de clipe hoje inline em `Clipes.jsx` é extraído pra
`components/CardClipe.jsx` e reutilizado nas duas telas; o filtro por jogador é
client-side sobre a lista que a aba já carrega inteira (sem mudança no endpoint
`GET /api/clipes`), com estado espelhado na URL via `useSearchParams`.

**Tech Stack:** Node/Express + `pg` (server), React + Vite + Tailwind + react-router
(client), Vitest + Testing Library (testes).

## Global Constraints

- O shape de cada item de clipe é IDÊNTICO ao da aba Clipes (`clipes.js:47-62`):
  `{ id, matchId, steamId, nick, avatarUrl, clipUrl, clipSnapshotUrl, kind, roundNumber, map, playedAt, pontuacao }` —
  o card reutilizado não pode precisar de adaptação por tela.
- `kind` vem por subquery em `highlights`, NUNCA join inner (excluiria clipes do fluxo
  por-jogador, migração 0042 — regra documentada em `clipes.js:16-22`).
- Visibilidade por amizade nos clipes do perfil: mesma regra `visivelWhere`/
  `partidaVisivelExpr` das outras queries do perfil — clipe de partida invisível ao
  viewer não chega ao client.
- Prévia do perfil: **6 clipes**, ordenados por `pontuacao_total desc nulls last`.
- Sem mudança no endpoint `GET /api/clipes` — filtro por jogador é 100% client-side.
- Refactor do card: zero mudança de comportamento — os 4 testes existentes de
  `Clipes.test.jsx` passam SEM alteração após a extração.
- Referência: `docs/superpowers/specs/2026-07-24-clipes-no-perfil-e-filtro-jogador-design.md`
  (spec completa, aprovada).

---

### Task 1: Frontend — extrai `CardClipe` pra componente reutilizável

**Files:**
- Create: `site/client/src/components/CardClipe.jsx`
- Modify: `site/client/src/pages/Clipes.jsx`
- Test: `site/client/src/test/Clipes.test.jsx` (NENHUMA mudança — critério de aceite é
  os testes existentes passarem intactos)

**Interfaces:**
- Produces: `components/CardClipe.jsx` com export default `CardClipe({ clipe, aberto, onAbrir, viewerSteamId })`
  e mesmo comportamento atual — Task 3 importa exatamente esse componente.

- [ ] **Step 1: Criar o componente extraído**

Criar `site/client/src/components/CardClipe.jsx` movendo, SEM alterar lógica, os
seguintes blocos de `site/client/src/pages/Clipes.jsx` (linhas 12-102): `NOME_KIND`,
`nomeDoKind`, `SnapshotPlaceholder`, `PlayerClipe`, `tituloPontuacao` e `CardClipe`.
Conteúdo do arquivo novo:

```jsx
// site/client/src/components/CardClipe.jsx
// Card de clipe da Allstar — extraído de Clipes.jsx pra reuso na seção de clipes do
// perfil do jogador (mesma interface, mesmo comportamento nas duas telas).
import { Card, Badge } from './ui'

const NOME_KIND = {
  ace: 'ACE', quad: 'QUAD KILL', triple: 'TRIPLE KILL',
  clutch_1v5: 'CLUTCH 1v5', clutch_1v4: 'CLUTCH 1v4', clutch_1v3: 'CLUTCH 1v3',
  clutch_1v2: 'CLUTCH 1v2', clutch_1v1: 'CLUTCH 1v1',
}

// kind vem null quando o round que a Allstar escolheu (gerar clipe por JOGADOR, não
// mais por highlight) não bate com nenhum highlight nosso pra esse jogador/round — só
// afeta o rótulo exibido, a pontuação (clipesScore.js) não depende de kind.
function nomeDoKind(kind) {
  if (!kind) return 'MOMENTO'
  return NOME_KIND[kind] ?? kind
}

function SnapshotPlaceholder() {
  return (
    <div className="mt-3 flex aspect-video w-full items-center justify-center border border-borda bg-superficie-alta text-texto-fraco">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8">
        <rect x="3" y="5" width="18" height="14" rx="1" />
        <path d="M9 9L15 12L9 15V9Z" fill="currentColor" stroke="none" />
      </svg>
    </div>
  )
}

function PlayerClipe({ clipUrl, viewerSteamId, titulo }) {
  return (
    <div className="mt-3 aspect-video w-full">
      <iframe
        src={`${clipUrl}&UID=${viewerSteamId ?? ''}&location=melhoresClipes`}
        allow="autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen"
        allowFullScreen
        className="h-full w-full border border-borda"
        title={titulo ?? 'Clipe Allstar'}
      />
    </div>
  )
}

// Tooltip explica o calculo — mesma logica de transparencia da spec (Competicoes
// tambem mostra o detalhamento), aqui e so leitura sobre o clipe.
function tituloPontuacao(p) {
  const partes = [`${p.kills} kills (${p.pontosKills})`]
  if (p.headshots > 0) partes.push(`${p.headshots} headshots (+${p.pontosHeadshots})`)
  if (p.clutch) partes.push(`clutch ${p.clutch} (+${p.pontosClutch})`)
  if (p.armas > 0) partes.push(`${p.armas} armas distintas (+${p.pontosArmas})`)
  return `${partes.join(' + ')} = ${p.total}`
}

export default function CardClipe({ clipe, aberto, onAbrir, viewerSteamId }) {
  const { pontuacao } = clipe
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {clipe.avatarUrl && (
            <img src={clipe.avatarUrl} alt="" className="panel-cut-sm h-8 w-8 shrink-0 border border-borda object-cover" />
          )}
          <div className="min-w-0">
            <Badge tom="destaque">{nomeDoKind(clipe.kind)}</Badge>
            <p className="mt-1 truncate font-mono text-sm text-texto">
              <span>{clipe.nick}</span> · round {clipe.roundNumber} · {clipe.map}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display text-lg font-bold text-destaque" title={tituloPontuacao(pontuacao)}>
            {pontuacao.total}
          </div>
        </div>
      </div>
      {!aberto && (clipe.clipSnapshotUrl
        ? <img src={clipe.clipSnapshotUrl} alt="" className="mt-3 aspect-video w-full border border-borda object-cover" />
        : <SnapshotPlaceholder />)}
      <button
        type="button"
        onClick={() => onAbrir(aberto ? null : clipe.id)}
        className="panel-cut-sm mt-3 min-h-10 w-full border border-borda px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-texto-fraco hover:border-destaque/50 hover:text-destaque lg:min-h-0"
      >
        {aberto ? 'Fechar' : '▶ Assistir'}
      </button>
      {aberto && (
        <PlayerClipe
          clipUrl={clipe.clipUrl}
          viewerSteamId={viewerSteamId}
          titulo={`Clipe Allstar de ${clipe.nick} — ${nomeDoKind(clipe.kind)} round ${clipe.roundNumber}`}
        />
      )}
    </Card>
  )
}
```

- [ ] **Step 2: Atualizar `Clipes.jsx` pra importar o componente**

Em `site/client/src/pages/Clipes.jsx`: remover os blocos movidos (linhas 12-102 —
`NOME_KIND`, `nomeDoKind`, `SnapshotPlaceholder`, `PlayerClipe`, `tituloPontuacao`,
`CardClipe`), remover `Badge` do import de `../components/ui` (fica só
`Card, SectionHeader` — conferir se `Card` ainda é usado no arquivo; se não for, remover
também), e adicionar:

```javascript
import CardClipe from '../components/CardClipe.jsx'
```

O `PERIODOS` (linhas 6-10) e o componente `Clipes` (104-156) ficam. Nada mais muda.

- [ ] **Step 3: Rodar os testes existentes pra confirmar que passam intactos**

Run: `cd site/client && npx vitest run src/test/Clipes.test.jsx`
Expected: PASS — os 4 testes existentes, sem nenhuma alteração no arquivo de teste.

- [ ] **Step 4: Commit**

```bash
git add site/client/src/components/CardClipe.jsx site/client/src/pages/Clipes.jsx
git commit -m "refactor: extrai CardClipe pra componente reutilizavel"
```

---

### Task 2: Backend — campo `clipes` no payload do perfil

**Files:**
- Modify: `site/server/src/routes/profile.js:431-441` (declaração dos params), `:443-503`
  (`Promise.all`), `:514-569` (resposta)
- Test: `site/server/test/profile.test.js`

**Interfaces:**
- Consumes: helpers `periodoWhere`/`visivelWhere` já existentes no arquivo (linhas 13-35).
- Produces: campo `clipes` na resposta de `GET /api/profile/:steamId`, array de itens no
  shape exato da aba Clipes — Task 3 (frontend) consome esse campo.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final do `describe('GET /api/profile/:steamId', ...)` em
`site/server/test/profile.test.js` (seguir o padrão `appWith(handlers)` do arquivo — o
needle novo `'from allstar_clips ac'` não colide com nenhum outro handler do arquivo):

```javascript
  it('inclui clipes do jogador (6 melhores por pontuacao) com shape da aba Clipes', async () => {
    const { app } = appWith([
      ['where p.steam_id64 = $1', [{ steam_id64: '765', nick: 'bronze', avatar_url: 'https://a/av.jpg' }]],
      ['from allstar_clips ac', [{
        id: 'c1', clip_url: 'https://allstar.gg/clip/1', clip_snapshot_url: null,
        pontuacao_total: 154, pontuacao_detalhe: { total: 154, kills: 5 },
        round_number: 5, match_id: 'm1', kind: 'ace', map: 'de_mirage', played_at: '2026-07-20T00:00:00Z',
      }]],
    ])
    const res = await request(app).get('/api/profile/765').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.clipes).toEqual([{
      id: 'c1', matchId: 'm1', steamId: '765', nick: 'bronze', avatarUrl: 'https://a/av.jpg',
      clipUrl: 'https://allstar.gg/clip/1', clipSnapshotUrl: null,
      kind: 'ace', roundNumber: 5, map: 'de_mirage', playedAt: '2026-07-20T00:00:00Z',
      pontuacao: { total: 154, kills: 5 },
    }])
  })

  it('clipes do perfil: query filtra por steam_id64 com visibilidade por amizade e limita a 6', async () => {
    const { app, db } = appWith([
      ['where p.steam_id64 = $1', [{ steam_id64: '765', nick: 'bronze', avatar_url: null }]],
      ['from allstar_clips ac', []],
    ])
    const res = await request(app).get('/api/profile/765').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.clipes).toEqual([])
    const chamada = db.query.mock.calls.find(([sql]) => sql.includes('from allstar_clips ac'))
    expect(chamada).toBeTruthy()
    const [sql, params] = chamada
    expect(sql).toContain('from friendships f')
    expect(sql).not.toContain('group_id')
    expect(sql).toContain('limit 6')
    expect(sql).toContain("ac.status = 'Processed'")
    // kind por subquery em highlights, nunca join inner (migração 0042)
    expect(sql).toContain('select h.kind from highlights h')
    expect(sql).not.toMatch(/join highlights/)
    expect(params[0]).toBe('765')
    expect(params).toContain(STEAM_ID)
  })

  it('clipes com pontuacao_detalhe nulo caem no fallback { total }', async () => {
    const { app } = appWith([
      ['where p.steam_id64 = $1', [{ steam_id64: '765', nick: 'bronze', avatar_url: null }]],
      ['from allstar_clips ac', [{
        id: 'c2', clip_url: 'https://allstar.gg/clip/2', clip_snapshot_url: null,
        pontuacao_total: 80, pontuacao_detalhe: null,
        round_number: 3, match_id: 'm2', kind: null, map: 'de_dust2', played_at: '2026-07-21T00:00:00Z',
      }]],
    ])
    const res = await request(app).get('/api/profile/765').set('Cookie', cookie)
    expect(res.body.clipes[0].pontuacao).toEqual({ total: 80 })
    expect(res.body.clipes[0].kind).toBeNull()
  })
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd site/server && npx vitest run test/profile.test.js -t "clipes"`
Expected: FAIL — `res.body.clipes` é `undefined` nos três (campo não existe ainda).

- [ ] **Step 3: Implementar**

Em `site/server/src/routes/profile.js`:

1. Junto das declarações de params (depois da linha 441, `premierVisivel`):

```javascript
    const clipesParams = [steamId]
    const clipesPeriodo = periodoWhere(from, to, clipesParams)
    const clipesVisivel = visivelWhere(req.player.steamId, clipesParams)
```

2. No `Promise.all` (linha 443), adicionar `clipes` à desestruturação (depois de
`premierRow`) e a query ao final do array (depois da query do premier, linha 502):

```javascript
      // Prévia dos melhores clipes do jogador pro perfil — mesmo shape da aba Clipes
      // (clipes.js), MESMA regra de visibilidade por amizade (clipe de partida que o
      // viewer não pode ver não vaza) e mesmo cuidado com kind: subquery em highlights,
      // nunca join inner (excluiria clipes do fluxo por-jogador, migração 0042).
      db.query(
        `select ac.id, ac.clip_url, ac.clip_snapshot_url, ac.pontuacao_total, ac.pontuacao_detalhe,
                ac.round_number, ac.match_id,
                (select h.kind from highlights h
                 where h.match_id = ac.match_id and h.steam_id64 = ac.steam_id64 and h.round_number = ac.round_number
                 limit 1) as kind,
                m.map, m.played_at
         from allstar_clips ac
         join matches m on m.id = ac.match_id
         where ac.steam_id64 = $1 and ac.status = 'Processed'${clipesPeriodo}${clipesVisivel}
         order by ac.pontuacao_total desc nulls last
         limit 6`,
        clipesParams,
      ),
```

A desestruturação vira:

```javascript
    const [stats, porMapa, recentes, sinergia, evolucao, statsGerais, sequencia, estilo, destaques, armas, economia, premierRow, clipes] = await Promise.all([
```

3. Na resposta (`res.json`, linha 514), adicionar depois de `destaques`:

```javascript
      clipes: clipes.rows.map((c) => ({
        id: c.id, matchId: c.match_id, steamId,
        nick: jogador.nick, avatarUrl: jogador.avatar_url,
        clipUrl: c.clip_url, clipSnapshotUrl: c.clip_snapshot_url,
        kind: c.kind, roundNumber: c.round_number, map: c.map, playedAt: c.played_at,
        pontuacao: c.pontuacao_detalhe ?? { total: c.pontuacao_total ?? 0 },
      })),
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/server && npx vitest run test/profile.test.js`
Expected: PASS (arquivo inteiro, incluindo os testes pré-existentes).

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/profile.js site/server/test/profile.test.js
git commit -m "feat: payload do perfil inclui os 6 melhores clipes do jogador"
```

---

### Task 3: Frontend — seção "Clipes" no perfil

**Files:**
- Modify: `site/client/src/pages/JogadorPerfil.jsx`
- Test: `site/client/src/test/JogadorPerfil.test.jsx` (novo arquivo)

**Interfaces:**
- Consumes: campo `clipes` do payload (Task 2) e `components/CardClipe.jsx` (Task 1).

- [ ] **Step 1: Escrever os testes que falham**

Criar `site/client/src/test/JogadorPerfil.test.jsx`. Escopo mínimo: só a seção de
clipes (a página não tinha teste — não tentar cobrir tudo). O payload mock precisa de
todos os campos que o destructuring da página exige:

```jsx
// site/client/src/test/JogadorPerfil.test.jsx
// Escopo deliberadamente mínimo: só a seção de Clipes (a página não tinha teste antes).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import JogadorPerfil from '../pages/JogadorPerfil.jsx'

const PERFIL_BASE = {
  jogador: { steamId: '765', nick: 'bronze', avatarUrl: null, faceitNick: null, faceitElo: null, faceitSkillLevel: null },
  premierAtual: null,
  stats: {
    partidas: 10, vitorias: 5, kills: 100, deaths: 90, assists: 30, hs: 40,
    rating: 1.01, kd: 1.11, adr: 80, hsPct: 40, winrate: 50,
    utilityDamage: 100, accuracy: 20, entryKills: 5, entryDeaths: 3, entryWins: 4,
    tradeKills: 6, tradedDeaths: 2, clutchWins: 1, clutchAttempts: 4, aces: 1,
    flashAssists: 2, enemiesFlashed: 10, teamKills: 0, rounds: 200,
  },
  evolucao: [], badges: [], estilo: null, armas: [], economia: null,
  destaques: [], porMapa: [], recentes: [], sinergia: [],
  clipes: [],
}

function renderPerfil(payload) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload })
  return render(
    <MemoryRouter initialEntries={['/jogador/765']}>
      <Routes>
        <Route path="/jogador/:steamId" element={<JogadorPerfil />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { vi.restoreAllMocks() })

describe('JogadorPerfil — seção Clipes', () => {
  it('mostra a seção com o clipe e o link "Ver todos" filtrado no jogador', async () => {
    renderPerfil({
      ...PERFIL_BASE,
      clipes: [{
        id: 'c1', matchId: 'm1', steamId: '765', nick: 'bronze', avatarUrl: null,
        clipUrl: 'https://allstar.gg/clip/1', clipSnapshotUrl: null,
        kind: 'ace', roundNumber: 5, map: 'de_mirage', playedAt: '2026-07-20T00:00:00Z',
        pontuacao: { kills: 5, pontosKills: 120, headshots: 3, pontosHeadshots: 24, clutch: null, pontosClutch: 0, armas: 2, pontosArmas: 10, total: 154 },
      }],
    })
    await waitFor(() => expect(screen.getByText('154')).toBeInTheDocument())
    expect(screen.getByText('ACE')).toBeInTheDocument()
    const verTodos = screen.getByRole('link', { name: /ver todos/i })
    expect(verTodos).toHaveAttribute('href', '/clipes?jogador=765')
  })

  it('sem clipes: seção não aparece', async () => {
    renderPerfil(PERFIL_BASE)
    await waitFor(() => expect(screen.getAllByText(/bronze/i).length).toBeGreaterThan(0))
    expect(screen.queryByRole('link', { name: /ver todos/i })).not.toBeInTheDocument()
  })
})
```

Nota pro implementador: se o render do `PERFIL_BASE` estourar por algum campo de stats
faltando no mock (o destructuring/uso real da página é extenso), adicione o campo
faltante ao `PERFIL_BASE` — o objetivo é o mock mínimo que renderiza, não replicar o
shape inteiro do servidor.

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd site/client && npx vitest run src/test/JogadorPerfil.test.jsx`
Expected: FAIL — a seção/link "Ver todos" não existe ainda.

- [ ] **Step 3: Implementar**

Em `site/client/src/pages/JogadorPerfil.jsx`:

1. Imports (linha 4-8): adicionar `CardClipe` e `useAuth`:

```javascript
import CardClipe from '../components/CardClipe.jsx'
import { useAuth } from '../auth/AuthContext.jsx'
```

2. Componente local `SecaoClipes`, logo depois de `SecaoHighlights` (que termina antes
da linha 167):

```jsx
// Seção de Clipes do perfil — prévia dos 6 melhores (por pontuação, backend já ordena e
// limita), reusando o CardClipe da aba Clipes; "Ver todos" abre a aba já filtrada nele.
function SecaoClipes({ clipes, steamId, viewerSteamId }) {
  const [clipeAberto, setClipeAberto] = useState(null)
  return (
    <section>
      <SectionHeader
        titulo="Clipes"
        acao={
          <Link
            to={`/clipes?jogador=${steamId}`}
            className="panel-cut-sm min-h-10 border border-borda px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-texto-fraco hover:border-destaque/50 hover:text-destaque lg:min-h-0"
          >
            Ver todos →
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {clipes.map((c) => (
          <CardClipe key={c.id} clipe={c} aberto={clipeAberto === c.id} onAbrir={setClipeAberto} viewerSteamId={viewerSteamId} />
        ))}
      </div>
    </section>
  )
}
```

3. No componente da página: obter o viewer (`const { jogador: viewer } = useAuth()`,
junto dos outros hooks no topo — atenção ao conflito de nome com o `jogador` do payload,
por isso o alias `viewer`), adicionar `clipes` ao destructuring da linha 194 (com
fallback: `const clipes = data.clipes ?? []`), e renderizar a seção logo depois da
`SecaoHighlights` (linha 403):

```jsx
      {/* 4b. Clipes — prévia dos melhores momentos em vídeo, reusando o card da aba Clipes. */}
      {clipes.length > 0 && <SecaoClipes clipes={clipes} steamId={jogador.steamId} viewerSteamId={viewer?.steamId} />}
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/client && npx vitest run src/test/JogadorPerfil.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/client/src/pages/JogadorPerfil.jsx site/client/src/test/JogadorPerfil.test.jsx
git commit -m "feat: secao de clipes no perfil do jogador com link pra aba filtrada"
```

---

### Task 4: Frontend — filtro por jogador na aba Clipes (dropdown + deep link)

**Files:**
- Modify: `site/client/src/pages/Clipes.jsx`
- Test: `site/client/src/test/Clipes.test.jsx`

**Interfaces:**
- Consumes: query param `?jogador=<steamId>` (formato que a Task 3 gera no link
  "Ver todos").

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `describe('Clipes', ...)` em `site/client/src/test/Clipes.test.jsx` (os 4
testes existentes ficam intactos). A resposta mock precisa de 2 jogadores pra exercitar
o filtro — adicionar uma constante nova no topo do arquivo (sem mexer em `RESPOSTA`):

```javascript
const RESPOSTA_DOIS_JOGADORES = {
  clipes: [
    {
      id: 'c1', matchId: 'm1', steamId: '111', nick: 'bronze', avatarUrl: null,
      clipUrl: 'https://allstar.gg/clip/1', clipSnapshotUrl: null,
      kind: 'ace', roundNumber: 5, map: 'de_mirage', playedAt: '2026-07-20T00:00:00Z',
      pontuacao: { kills: 5, pontosKills: 120, headshots: 3, pontosHeadshots: 24, clutch: null, pontosClutch: 0, armas: 2, pontosArmas: 10, total: 154 },
    },
    {
      id: 'c2', matchId: 'm2', steamId: '222', nick: 'troya', avatarUrl: null,
      clipUrl: 'https://allstar.gg/clip/2', clipSnapshotUrl: null,
      kind: 'quad', roundNumber: 9, map: 'de_inferno', playedAt: '2026-07-21T00:00:00Z',
      pontuacao: { kills: 4, pontosKills: 80, headshots: 1, pontosHeadshots: 8, clutch: null, pontosClutch: 0, armas: 1, pontosArmas: 5, total: 93 },
    },
  ],
}
```

E os testes:

```javascript
  it('deep link ?jogador= chega com a lista ja filtrada nesse jogador', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPOSTA_DOIS_JOGADORES })
    render(
      <MemoryRouter initialEntries={['/clipes?jogador=222']}>
        <Clipes />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('troya')).toBeInTheDocument())
    expect(screen.queryByText('bronze')).not.toBeInTheDocument()
  })

  it('filtro "Todos" (default) mostra clipes de todo mundo', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPOSTA_DOIS_JOGADORES })
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('troya')).toBeInTheDocument())
    expect(screen.getByText('bronze')).toBeInTheDocument()
  })

  it('deep link pra jogador sem clipe mostra estado vazio especifico', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPOSTA_DOIS_JOGADORES })
    render(
      <MemoryRouter initialEntries={['/clipes?jogador=999']}>
        <Clipes />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText(/nenhum clipe desse jogador/i)).toBeInTheDocument())
  })
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd site/client && npx vitest run src/test/Clipes.test.jsx`
Expected: FAIL — os 3 novos falham (`?jogador=` é ignorado hoje, 'bronze' aparece mesmo
filtrado); os 4 antigos passam.

- [ ] **Step 3: Implementar**

Em `site/client/src/pages/Clipes.jsx`:

1. Imports: adicionar `useSearchParams` do react-router e `useMemo` do react, e `Select`
ao import de `../components/ui`:

```javascript
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, SectionHeader, Select } from '../components/ui'
```

(Se `Card` tiver saído no refactor da Task 1, ajustar conforme o estado real do arquivo.)

2. No componente `Clipes`:

```javascript
export default function Clipes() {
  const { jogador } = useAuth()
  const [periodo, setPeriodo] = useState('sempre')
  const [dados, setDados] = useState(null)
  const [clipeAberto, setClipeAberto] = useState(null)
  // Filtro por jogador espelhado na URL (?jogador=steamId) — o link "Ver todos" do
  // perfil chega aqui já filtrado, e trocar o filtro atualiza a URL (compartilhável).
  const [searchParams, setSearchParams] = useSearchParams()
  const jogadorFiltro = searchParams.get('jogador') ?? ''

  function setJogadorFiltro(valor) {
    const proximos = new URLSearchParams(searchParams)
    if (valor) proximos.set('jogador', valor)
    else proximos.delete('jogador')
    setSearchParams(proximos, { replace: true })
  }

  useEffect(() => {
    setDados(null)
    fetch(`/api/clipes?periodo=${periodo}`)
      .then((res) => (res.ok ? res.json() : { clipes: [] }))
      .then(setDados)
      .catch(() => setDados({ clipes: [] }))
  }, [periodo])

  // Opções do dropdown derivadas da lista carregada (a aba carrega tudo de uma vez, sem
  // paginação) — pares steamId/nick distintos, ordenados por nick.
  const opcoesJogador = useMemo(() => {
    if (!dados) return []
    const vistos = new Map()
    for (const c of dados.clipes) if (!vistos.has(c.steamId)) vistos.set(c.steamId, c.nick)
    return [...vistos.entries()]
      .map(([steamId, nick]) => ({ valor: steamId, label: nick }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [dados])

  const clipesFiltrados = dados === null
    ? null
    : jogadorFiltro
      ? dados.clipes.filter((c) => c.steamId === jogadorFiltro)
      : dados.clipes
```

3. No JSX, dentro do `acao` do `SectionHeader`, adicionar o `Select` antes dos botões de
período (conferir a API real do `Select` em `components/ui` — ele é o dropdown
customizado do design system; adaptar `props` conforme a assinatura dele, mantendo:
opção "Todos" com valor vazio + `opcoesJogador`):

```jsx
        acao={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={jogadorFiltro}
              onChange={setJogadorFiltro}
              options={[{ valor: '', label: 'Todos' }, ...opcoesJogador]}
              aria-label="Filtrar por jogador"
            />
            {PERIODOS.map((p) => (
              /* ...botões de período inalterados... */
            ))}
          </div>
        }
```

4. Na renderização da lista, usar `clipesFiltrados` e diferenciar o estado vazio:

```jsx
      {clipesFiltrados === null ? (
        <p className="font-mono text-sm text-texto-fraco">Carregando…</p>
      ) : clipesFiltrados.length === 0 ? (
        <p className="font-mono text-sm text-texto-fraco">
          {jogadorFiltro ? 'Nenhum clipe desse jogador nesse período.' : 'Nenhum clipe nesse período ainda.'}
        </p>
      ) : (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clipesFiltrados.map((c) => (
            <CardClipe key={c.id} clipe={c} aberto={clipeAberto === c.id} onAbrir={setClipeAberto} viewerSteamId={jogador?.steamId} />
          ))}
        </section>
      )}
```

Nota pro implementador: a assinatura exata do `Select` do design system pode diferir
(ex.: `onChange` recebendo evento vs. valor direto, `options` com outras chaves). LEIA
`site/client/src/components/ui` (o arquivo do Select) antes e adapte o uso — o requisito
é comportamento (dropdown com "Todos" + jogadores, acessível por `aria-label`/label),
não uma assinatura específica.

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/client && npx vitest run src/test/Clipes.test.jsx`
Expected: PASS — os 7 (4 antigos + 3 novos).

- [ ] **Step 5: Commit**

```bash
git add site/client/src/pages/Clipes.jsx site/client/src/test/Clipes.test.jsx
git commit -m "feat: filtro por jogador na aba Clipes com deep link ?jogador="
```

---

### Task 5: Regressão completa

**Files:** nenhum arquivo novo — só verificação.

**Interfaces:** nenhuma.

- [ ] **Step 1: Rodar a suíte inteira do servidor**

Run: `cd site/server && npx vitest run`
Expected: PASS, sem nenhum teste quebrado.

- [ ] **Step 2: Rodar a suíte inteira do client**

Run: `cd site/client && npx vitest run`
Expected: PASS, sem nenhum teste quebrado.

- [ ] **Step 3: Commit final (se sobrar algo solto)**

```bash
git status --short
```

Se tudo já foi commitado nas tasks anteriores, não há nada a fazer aqui.
