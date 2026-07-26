# Seletor de clipes da Competição — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consertar o modal de seleção de clipes (hoje recortado pelo `clip-path`
do `<Card>` que o contém) e dar ao Jogador o contexto pra escolher: preview do
Clipe, jogada, data da Partida, breakdown da pontuação e quanto ele já enviou
contra os limites da Competição.

**Architecture:** O modal passa a se renderizar via `createPortal` no
`document.body`, imune a qualquer `clip-path`/`overflow` de ancestral. O endpoint
`/elegiveis` passa a devolver `{ clipes, limites }`, com três colunas que já
estão nas tabelas que ele junta e o `kind` da jogada por `left join lateral`. A
contagem de submissões vira um helper compartilhado com o `POST /submissoes`,
corrigindo de quebra o fuso do limite diário.

**Tech Stack:** Express (ESM) + vitest/supertest no servidor; React + Tailwind +
vitest/@testing-library no cliente; Postgres (Supabase).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-26-seletor-clipes-competicao-design.md`.
- Vocabulário do `CONTEXT.md`: **Partida**, **Jogador**, **Participante**,
  **Clipe**, **Highlight**, **Demo**. Nada de "match", "player", "user" em texto
  de UI, comentário ou mensagem de erro.
- Toda mensagem de UI e de erro de API em **PT-BR**.
- O join com `highlights` é **LEFT** e tem que colapsar em no máximo uma linha
  por Clipe — `highlights` não tem unique em `(match_id, steam_id64, round_number)`.
- Fuso do limite diário: `America/Sao_Paulo`, nos dois lados da comparação.
- A validação de limite do servidor continua sendo a que vale; a do cliente é
  conveniência.
- Rodar testes: `cd site/server && npm test`; `cd site/client && npm test`;
  build do cliente com `cd site/client && npm run build`.
- Trabalhar numa branch `fix/seletor-clipes-competicao` criada a partir do
  `main` (ver `docs/WORKFLOW.md`) — **não** commitar código de feature direto no
  `main`, e **não** trabalhar em cima da branch `feat/enviar-demo-da-partida`,
  que tem PR aberta e escopo diferente.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `site/server/src/routes/competicoes.js` | **Modificar.** Helper `contarSubmissoes`; `/elegiveis` com campos novos, lateral join e bloco `limites` |
| `site/server/test/competicoes.test.js` | **Modificar.** Testes do shape novo, do LEFT join e do fuso |
| `site/client/src/components/ui/PlayerClipe.jsx` | **Criar.** `PlayerClipe`, `SnapshotPlaceholder` e `nomeDoKind` compartilhados |
| `site/client/src/components/CardClipe.jsx` | **Modificar.** Passa a importar do módulo compartilhado |
| `site/client/src/components/SeletorClipesCompeticao.jsx` | **Modificar.** Portal, `Esc`, trava de scroll, shape novo, cards enriquecidos, cabeçalho com limites |
| `site/client/src/test/SeletorClipesCompeticao.test.jsx` | **Modificar.** Shape novo + os casos novos |

---

## Task 1: Contagem de submissões única e no fuso de Brasília

**Files:**
- Modify: `site/server/src/routes/competicoes.js:337-347`
- Test: `site/server/test/competicoes.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `contarSubmissoes(db, competicaoId, steamId) -> Promise<{ hoje: number, total: number }>`,
  função de módulo em `competicoes.js` (não exportada do pacote; usada pelos dois
  endpoints do mesmo arquivo).

- [ ] **Step 1: Escrever o teste que falha**

Em `site/server/test/competicoes.test.js`, no bloco de testes de
`POST /api/competicoes/:id/submissoes`:

```js
  it('a contagem do dia usa o fuso de Brasilia, nao o do servidor', async () => {
    const agora = new Date()
    const { app, db } = appWith([
      ['from competicoes', [{
        id: 'comp1',
        data_inicio: new Date(agora.getTime() - 86400000),
        data_fim: new Date(agora.getTime() + 86400000),
        limite_diario: 2, limite_total: 10,
      }]],
      ['from allstar_clips', [{ id: 'c1', played_at: agora }]],
      ['from competicao_submissoes', [{ hoje: '0', total: '0' }]],
    ])
    await request(app)
      .post('/api/competicoes/11111111-1111-1111-1111-111111111111/submissoes')
      .set('Cookie', cookieJogador)
      .send({ allstarClipId: '22222222-2222-2222-2222-222222222222' })

    const contagem = db.query.mock.calls.find((c) => c[0].includes('count(*) filter'))
    expect(contagem[0]).toContain("at time zone 'America/Sao_Paulo'")
    // os DOIS lados da comparação precisam do at time zone — converter só um
    // compararia data de Brasília com data UTC, que é o bug original ao contrário.
    expect(contagem[0].match(/at time zone 'America\/Sao_Paulo'/g)).toHaveLength(2)
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/server && npx vitest run test/competicoes.test.js -t "fuso de Brasilia"`
Expected: FAIL — a query atual usa `enviado_em::date = now()::date`, sem `at time zone`.

- [ ] **Step 3: Extrair o helper**

Em `site/server/src/routes/competicoes.js`, junto das outras funções de módulo
do topo do arquivo (antes do `export function createCompeticoesRouter`):

```js
// Submissões do Jogador nesta Competição: no dia e no total. Fonte ÚNICA — o limite
// aplicado no POST /submissoes e o contador exibido no seletor de clipes saem daqui,
// senão a tela prometeria um envio que o servidor recusa.
//
// O fuso é explícito nos dois lados: `now()::date` sozinho usa o fuso do servidor
// Postgres (UTC), o que fazia o limite diário virar às 21h de Brasília — um clipe
// enviado às 22h contava como do dia seguinte.
async function contarSubmissoes(db, competicaoId, steamId) {
  const { rows } = await db.query(
    `select
       count(*) filter (
         where (enviado_em at time zone 'America/Sao_Paulo')::date
             = (now() at time zone 'America/Sao_Paulo')::date
       ) as hoje,
       count(*) as total
     from competicao_submissoes
     where competicao_id = $1 and steam_id64 = $2`,
    [competicaoId, steamId],
  )
  return { hoje: Number(rows[0].hoje), total: Number(rows[0].total) }
}
```

- [ ] **Step 4: Usar o helper no `POST /submissoes`**

Trocar o bloco das linhas 337-347 por:

```js
    const { hoje, total } = await contarSubmissoes(db, comp.id, req.player.steamId)
    if (hoje >= comp.limite_diario) return res.status(400).json({ erro: `limite diário de ${comp.limite_diario} clipes atingido` })
    if (total >= comp.limite_total) return res.status(400).json({ erro: `limite total de ${comp.limite_total} clipes atingido` })
```

O `Number()` sai daqui porque o helper já converte.

- [ ] **Step 5: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: PASS, incluindo os testes de limite que já existiam.

- [ ] **Step 6: Commit**

```bash
git add site/server/src/routes/competicoes.js site/server/test/competicoes.test.js
git commit -m "fix: contagem diaria de submissoes no fuso de Brasilia"
```

---

## Task 2: `/elegiveis` devolve contexto e limites

**Files:**
- Modify: `site/server/src/routes/competicoes.js:274-301`
- Test: `site/server/test/competicoes.test.js`

**Interfaces:**
- Consumes: `contarSubmissoes(db, competicaoId, steamId)` (Task 1).
- Produces: `GET /api/competicoes/:id/elegiveis` devolvendo
  `{ clipes: Array<{ allstarClipId, matchId, roundNumber, map, playedAt, kind,
  clipUrl, clipSnapshotUrl, pontuacao, jaEnviado }>, limites: { hoje,
  limiteDiario, total, limiteTotal, minimoParaRankear } }`.
  `kind` é `string | null`.

- [ ] **Step 1: Escrever os testes que falham**

```js
describe('GET /api/competicoes/:id/elegiveis', () => {
  const ID = '11111111-1111-1111-1111-111111111111'

  function appComElegiveis(clipes) {
    const agora = new Date()
    return appWith([
      ['from competicoes', [{
        id: 'comp1',
        data_inicio: new Date(agora.getTime() - 86400000),
        data_fim: new Date(agora.getTime() + 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 3,
      }]],
      ['from allstar_clips', clipes],
      ['from competicao_submissoes', [{ hoje: '1', total: '4' }]],
    ])
  }

  it('devolve clipes e limites, com contexto do clipe', async () => {
    const playedAt = new Date('2026-07-25T00:37:00Z')
    const { app } = appComElegiveis([{
      id: 'c1', match_id: 'm1', round_number: 18, map: 'de_inferno',
      played_at: playedAt, kind: 'clutch_1v3',
      clip_url: 'https://allstar/c1?x=1', clip_snapshot_url: 'https://allstar/c1.jpg',
      pontuacao_total: 111, pontuacao_detalhe: { kills: 3, total: 111 },
      ja_enviado: false,
    }])
    const res = await request(app).get(`/api/competicoes/${ID}/elegiveis`).set('Cookie', cookieJogador)

    expect(res.status).toBe(200)
    expect(res.body.clipes).toHaveLength(1)
    expect(res.body.clipes[0]).toEqual({
      allstarClipId: 'c1', matchId: 'm1', roundNumber: 18, map: 'de_inferno',
      playedAt: playedAt.toISOString(), kind: 'clutch_1v3',
      clipUrl: 'https://allstar/c1?x=1', clipSnapshotUrl: 'https://allstar/c1.jpg',
      pontuacao: { kills: 3, total: 111 }, jaEnviado: false,
    })
    expect(res.body.limites).toEqual({
      hoje: 1, limiteDiario: 2, total: 4, limiteTotal: 10, minimoParaRankear: 3,
    })
  })

  it('clipe sem highlight correspondente continua na lista, com kind nulo', async () => {
    // Regressão: clipes do fluxo novo têm highlight_id nulo. Um join INNER faria
    // eles sumirem da lista de elegíveis.
    const { app } = appComElegiveis([{
      id: 'c1', match_id: 'm1', round_number: 18, map: 'de_inferno',
      played_at: new Date(), kind: null,
      clip_url: 'https://allstar/c1', clip_snapshot_url: null,
      pontuacao_total: 30, pontuacao_detalhe: null, ja_enviado: false,
    }])
    const res = await request(app).get(`/api/competicoes/${ID}/elegiveis`).set('Cookie', cookieJogador)

    expect(res.body.clipes).toHaveLength(1)
    expect(res.body.clipes[0].kind).toBeNull()
    expect(res.body.clipes[0].pontuacao).toEqual({ total: 30 })
  })

  it('o join com highlights e LEFT e colapsa em uma linha por clipe', async () => {
    const { app, db } = appComElegiveis([])
    await request(app).get(`/api/competicoes/${ID}/elegiveis`).set('Cookie', cookieJogador)
    const q = db.query.mock.calls.find((c) => c[0].includes('from allstar_clips'))[0]
    expect(q).toContain('left join lateral')
    // sem o limit 1, um round com ace E clutch duplicaria o clipe na lista
    expect(q).toContain('limit 1')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/server && npx vitest run test/competicoes.test.js -t elegiveis`
Expected: FAIL — `res.body.clipes` é `undefined` (hoje o endpoint devolve array cru).

- [ ] **Step 3: Implementar**

Trocar o handler inteiro de `router.get('/:id/elegiveis', …)` por:

```js
  router.get('/:id/elegiveis', requireAuth, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'competição não encontrada' })
    const { rows: compRows } = await db.query(
      'select id, data_inicio, data_fim, limite_diario, limite_total, minimo_para_rankear from competicoes where id = $1',
      [req.params.id],
    )
    if (!compRows.length) return res.status(404).json({ erro: 'competição não encontrada' })
    const comp = compRows[0]
    // allstar_clips guarda match_id/steam_id64/round_number direto (migração 0042) —
    // o join com highlights é LEFT LATERAL, nunca inner: clipes gerados pelo fluxo
    // novo (highlight_id nulo) sumiriam da lista, e o mesmo Jogador pode ter DOIS
    // highlights no mesmo round (ace + clutch), o que duplicaria a linha do Clipe.
    const { rows } = await db.query(
      `select ac.id, ac.match_id, ac.round_number, ac.pontuacao_total, ac.pontuacao_detalhe,
              ac.clip_url, ac.clip_snapshot_url,
              m.map, m.played_at, h.kind,
              exists (select 1 from competicao_submissoes cs where cs.competicao_id = $1 and cs.allstar_clip_id = ac.id) as ja_enviado
       from allstar_clips ac
       join matches m on m.id = ac.match_id
       left join lateral (
         select h.kind from highlights h
         where h.match_id = ac.match_id
           and h.steam_id64 = ac.steam_id64
           and h.round_number = ac.round_number
         order by h.kind
         limit 1
       ) h on true
       where ac.steam_id64 = $2 and ac.status = 'Processed'
         and m.played_at >= $3 and m.played_at <= $4
       order by m.played_at desc`,
      [comp.id, req.player.steamId, comp.data_inicio, comp.data_fim],
    )
    const { hoje, total } = await contarSubmissoes(db, comp.id, req.player.steamId)
    res.json({
      clipes: rows.map((r) => ({
        allstarClipId: r.id, matchId: r.match_id, roundNumber: r.round_number,
        map: r.map, playedAt: r.played_at, kind: r.kind ?? null,
        clipUrl: r.clip_url, clipSnapshotUrl: r.clip_snapshot_url,
        pontuacao: r.pontuacao_detalhe ?? { total: r.pontuacao_total ?? 0 },
        jaEnviado: r.ja_enviado,
      })),
      limites: {
        hoje, limiteDiario: comp.limite_diario,
        total, limiteTotal: comp.limite_total,
        minimoParaRankear: comp.minimo_para_rankear,
      },
    })
  })
```

- [ ] **Step 4: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/competicoes.js site/server/test/competicoes.test.js
git commit -m "feat: elegiveis devolve contexto do clipe e limites da competicao"
```

---

## Task 3: Módulo compartilhado do player de Clipe

**Files:**
- Create: `site/client/src/components/ui/PlayerClipe.jsx`
- Modify: `site/client/src/components/CardClipe.jsx:8-45`
- Test: `site/client/src/test/Clipes.test.jsx` (só rodar, não alterar — é a
  regressão de que o `CardClipe` continua funcionando)

**Interfaces:**
- Consumes: nada.
- Produces, exportados de `site/client/src/components/ui/PlayerClipe.jsx`:
  - `PlayerClipe({ clipUrl, viewerSteamId, titulo, location })` — `location`
    default `'melhoresClipes'`;
  - `SnapshotPlaceholder()`;
  - `nomeDoKind(kind) -> string` — `'MOMENTO'` quando `kind` é falsy.

- [ ] **Step 1: Criar o módulo compartilhado**

`site/client/src/components/ui/PlayerClipe.jsx`:

```jsx
// Player e rótulos de Clipe da Allstar, compartilhados entre o card da página
// Clipes (CardClipe.jsx) e o seletor de clipes da Competição — as duas telas
// mostram o mesmo iframe com o mesmo poster, e a terceira cópia ia nascer aqui.
// (Partida.jsx tem um painel próprio, fora do escopo desta unificação.)

const NOME_KIND = {
  ace: 'ACE', quad: 'QUAD KILL', triple: 'TRIPLE KILL',
  clutch_1v5: 'CLUTCH 1v5', clutch_1v4: 'CLUTCH 1v4', clutch_1v3: 'CLUTCH 1v3',
  clutch_1v2: 'CLUTCH 1v2', clutch_1v1: 'CLUTCH 1v1',
}

// kind vem null quando o round que a Allstar escolheu (gerar clipe por JOGADOR, não
// mais por highlight) não bate com nenhum Highlight nosso pra esse jogador/round — só
// afeta o rótulo exibido, a pontuação (clipesScore.js) não depende de kind.
export function nomeDoKind(kind) {
  if (!kind) return 'MOMENTO'
  return NOME_KIND[kind] ?? kind
}

export function SnapshotPlaceholder() {
  return (
    <div className="mt-3 flex aspect-video w-full items-center justify-center border border-borda bg-superficie-alta text-texto-fraco">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8">
        <rect x="3" y="5" width="18" height="14" rx="1" />
        <path d="M9 9L15 12L9 15V9Z" fill="currentColor" stroke="none" />
      </svg>
    </div>
  )
}

// `location` é telemetria da Allstar e difere por tela — a página Clipes manda
// 'melhoresClipes', o seletor da Competição manda 'selecaoCompeticao'.
export function PlayerClipe({ clipUrl, viewerSteamId, titulo, location = 'melhoresClipes' }) {
  return (
    <div className="mt-3 aspect-video w-full">
      <iframe
        src={`${clipUrl}&UID=${viewerSteamId ?? ''}&location=${location}`}
        allow="autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen"
        allowFullScreen
        className="h-full w-full border border-borda"
        title={titulo ?? 'Clipe Allstar'}
      />
    </div>
  )
}
```

- [ ] **Step 2: Fazer o `CardClipe` importar de lá**

Em `site/client/src/components/CardClipe.jsx`, apagar as definições locais de
`NOME_KIND`, `nomeDoKind`, `SnapshotPlaceholder` e `PlayerClipe` (linhas 8-45) e
acrescentar o import junto dos que já existem:

```jsx
import { PlayerClipe, SnapshotPlaceholder, nomeDoKind } from './ui/PlayerClipe.jsx'
```

O resto do arquivo não muda: `nomeDoKind(clipe.kind)` e os usos de
`<PlayerClipe …/>` / `<SnapshotPlaceholder />` continuam com a mesma assinatura,
e sem `location` o default `'melhoresClipes'` preserva o comportamento atual.

- [ ] **Step 3: Rodar a suíte do cliente**

Run: `cd site/client && npm test`
Expected: PASS — nenhum teste deveria mudar de resultado; esta task é
refatoração pura, e `Clipes.test.jsx` é a rede que prova isso.

- [ ] **Step 4: Build**

Run: `cd site/client && npm run build`
Expected: build sem erro (pega import quebrado que o teste não pegaria).

- [ ] **Step 5: Commit**

```bash
git add site/client/src/components/ui/PlayerClipe.jsx site/client/src/components/CardClipe.jsx
git commit -m "refactor: extrai player e rotulos de Clipe pra modulo compartilhado"
```

---

## Task 4: Portal, `Esc` e trava de scroll no seletor

**Files:**
- Modify: `site/client/src/components/SeletorClipesCompeticao.jsx`
- Test: `site/client/src/test/SeletorClipesCompeticao.test.jsx`

**Interfaces:**
- Consumes: o shape `{ clipes, limites }` de `/elegiveis` (Task 2).
- Produces: nada novo — mesma assinatura
  `<SeletorClipesCompeticao competicaoId onFechar onEnviado />`.

- [ ] **Step 1: Escrever os testes que falham**

Substituir o mock das duas suítes existentes em
`site/client/src/test/SeletorClipesCompeticao.test.jsx` pelo shape novo — hoje
elas devolvem um array cru, que deixa de ser o contrato:

```js
function respostaElegiveis(clipes, limites = {}) {
  return {
    clipes,
    limites: {
      hoje: 0, limiteDiario: 2, total: 0, limiteTotal: 10, minimoParaRankear: 3,
      ...limites,
    },
  }
}
```

O primeiro teste vira:

```js
  it('lista os clipes elegiveis com pontuacao e marca os ja enviados', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => respostaElegiveis([
        { allstarClipId: 'c1', matchId: 'm1', roundNumber: 9, map: 'de_dust2', playedAt: '2026-07-25T00:37:00Z', kind: 'ace', clipUrl: 'https://a/c1', clipSnapshotUrl: null, pontuacao: { total: 100 }, jaEnviado: false },
        { allstarClipId: 'c2', matchId: 'm2', roundNumber: 4, map: 'de_mirage', playedAt: '2026-07-25T00:37:00Z', kind: null, clipUrl: 'https://a/c2', clipSnapshotUrl: null, pontuacao: { total: 80 }, jaEnviado: true },
      ]),
    })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />)
    await waitFor(() => expect(screen.getByText(/Dust2/)).toBeInTheDocument())
    expect(screen.getByText(/enviado/i)).toBeInTheDocument()
  })
```

O segundo teste (POST) recebe o mesmo tratamento no `mockImplementation`: o GET
passa a devolver `respostaElegiveis([...])`.

E os testes novos:

```js
  it('renderiza no body, fora do elemento pai (o clip-path do Card recortava o modal)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respostaElegiveis([]) })
    const { container } = render(
      <SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />,
    )
    await waitFor(() => expect(screen.getByText(/Selecionar clipes/i)).toBeInTheDocument())
    // o container do render é o pai; o overlay tem que estar FORA dele
    expect(container).toBeEmptyDOMElement()
    expect(document.body).toContainElement(screen.getByText(/Selecionar clipes/i))
  })

  it('Esc fecha o modal', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respostaElegiveis([]) })
    const onFechar = vi.fn()
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={onFechar} onEnviado={() => {}} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    vi.advanceTimersByTime(250)
    expect(onFechar).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('trava o scroll do fundo enquanto aberto e restaura ao desmontar', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respostaElegiveis([]) })
    const { unmount } = render(
      <SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />,
    )
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/client && npx vitest run src/test/SeletorClipesCompeticao.test.jsx`
Expected: FAIL — o overlay está dentro do `container`, `Esc` não faz nada, e a
lista não carrega com o shape novo.

- [ ] **Step 3: Implementar**

Em `site/client/src/components/SeletorClipesCompeticao.jsx`:

Import novo no topo:

```jsx
import { createPortal } from 'react-dom'
```

O `carregar` passa a ler o shape novo e guardar os limites:

```jsx
  const [clipes, setClipes] = useState(null)
  const [limites, setLimites] = useState(null)
```

```jsx
  function carregar() {
    fetch(`/api/competicoes/${competicaoId}/elegiveis`)
      .then((res) => (res.ok ? res.json() : { clipes: [], limites: null }))
      .then((body) => { setClipes(body.clipes ?? []); setLimites(body.limites ?? null) })
      .catch(() => { setClipes([]); setLimites(null) })
  }
```

`Esc` e trava de scroll, num `useEffect` só (os dois vivem e morrem juntos com o
modal):

```jsx
  // O modal cobre a tela inteira: sem travar o scroll, rolar dentro dele leva a
  // página de trás junto; sem o Esc, a única saída é o clique no backdrop.
  useEffect(() => {
    function aoTeclar(e) { if (e.key === 'Escape') fechar() }
    document.addEventListener('keydown', aoTeclar)
    const anterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.body.style.overflow = anterior
    }
  }, [])
```

E o `return` do componente vira um portal:

```jsx
  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-fundo/80 p-4 transition-opacity duration-200 ${visivel ? 'opacity-100' : 'opacity-0'}`}
      onClick={fechar}
    >
      … (o conteúdo do painel continua exatamente como está) …
    </div>,
    document.body,
  )
```

Acrescentar o comentário explicando o porquê, logo acima do `createPortal`:

```jsx
  // Portal pro body de propósito: na aba Competições este seletor é montado dentro
  // de um <Card>, cuja classe panel-cut é um clip-path — e clip-path RECORTA os
  // descendentes, inclusive os position:fixed. Sem o portal o modal aparece
  // truncado na caixa do card. O portal imuniza qualquer ponto de montagem futuro.
```

- [ ] **Step 4: Rodar os testes e o build**

Run: `cd site/client && npm test && npm run build`
Expected: PASS + build limpo.

- [ ] **Step 5: Commit**

```bash
git add site/client/src/components/SeletorClipesCompeticao.jsx site/client/src/test/SeletorClipesCompeticao.test.jsx
git commit -m "fix: seletor de clipes em portal, Esc e trava de scroll"
```

---

## Task 5: Cards com contexto, preview e limites

**Files:**
- Modify: `site/client/src/components/SeletorClipesCompeticao.jsx`
- Test: `site/client/src/test/SeletorClipesCompeticao.test.jsx`

**Interfaces:**
- Consumes: `PlayerClipe`, `SnapshotPlaceholder`, `nomeDoKind` de
  `./ui/PlayerClipe.jsx` (Task 3); o shape `{ clipes, limites }` (Task 2); o
  portal e o estado `limites` (Task 4).
- Produces: nada — é a camada de apresentação final.

- [ ] **Step 1: Escrever os testes que falham**

```js
  const CLIPE_COMPLETO = {
    allstarClipId: 'c1', matchId: 'm1', roundNumber: 18, map: 'de_inferno',
    playedAt: '2026-07-25T03:37:00Z', kind: 'clutch_1v3',
    clipUrl: 'https://allstar/c1?x=1', clipSnapshotUrl: 'https://allstar/c1.jpg',
    pontuacao: { kills: 3, pontosKills: 50, headshots: 2, pontosHeadshots: 16, armas: 2, pontosArmas: 10, clutch: '1v3', pontosClutch: 35, total: 111 },
    jaEnviado: false,
  }

  it('mostra jogada, contexto da Partida e o breakdown da pontuacao', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => respostaElegiveis([CLIPE_COMPLETO]) })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />)
    await waitFor(() => expect(screen.getByText('CLUTCH 1v3')).toBeInTheDocument())
    expect(screen.getByText(/Inferno/)).toBeInTheDocument()
    expect(screen.getByText(/round 18/)).toBeInTheDocument()
    expect(screen.getByText('111')).toBeInTheDocument()
    expect(screen.getByText(/3 kills 50/)).toBeInTheDocument()
    expect(screen.getByText(/2 hs 16/)).toBeInTheDocument()
    expect(screen.getByText(/clutch 1v3 35/)).toBeInTheDocument()
  })

  it('no breakdown so aparece o que somou', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => respostaElegiveis([{
        ...CLIPE_COMPLETO, kind: null,
        pontuacao: { kills: 2, pontosKills: 25, headshots: 0, pontosHeadshots: 0, armas: 1, pontosArmas: 5, clutch: null, pontosClutch: 0, total: 30 },
      }]),
    })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />)
    await waitFor(() => expect(screen.getByText(/2 kills 25/)).toBeInTheDocument())
    expect(screen.queryByText(/hs/)).toBeNull()
    expect(screen.queryByText(/clutch/)).toBeNull()
    // sem kind, o rótulo cai pro número de kills
    expect(screen.getByText('2 KILLS')).toBeInTheDocument()
  })

  it('abrir o player de um clipe fecha o do outro', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => respostaElegiveis([
        CLIPE_COMPLETO,
        { ...CLIPE_COMPLETO, allstarClipId: 'c2', roundNumber: 2 },
      ]),
    })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /assistir/i })).toHaveLength(2))
    const [play1, play2] = screen.getAllByRole('button', { name: /assistir/i })

    fireEvent.click(play1)
    expect(document.querySelectorAll('iframe')).toHaveLength(1)

    fireEvent.click(play2)
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
  })

  it('limite diario estourado desabilita o envio e diz o motivo', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => respostaElegiveis([CLIPE_COMPLETO], { hoje: 2, limiteDiario: 2 }),
    })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />)
    await waitFor(() => expect(screen.getByText(/limite diário atingido/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /limite diário atingido/i })).toBeDisabled()
  })

  it('mostra o contador de envios no cabecalho', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => respostaElegiveis([], { hoje: 1, limiteDiario: 2, total: 4, limiteTotal: 10, minimoParaRankear: 3 }),
    })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />)
    await waitFor(() => expect(screen.getByText(/1 de 2 enviados hoje/i)).toBeInTheDocument())
    expect(screen.getByText(/4 de 10 no total/i)).toBeInTheDocument()
    expect(screen.getByText(/mínimo 3 pra rankear/i)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/client && npx vitest run src/test/SeletorClipesCompeticao.test.jsx`
Expected: FAIL — o card atual só mostra `mapa · round N` e o total.

- [ ] **Step 3: Implementar o breakdown e o rótulo**

No topo de `SeletorClipesCompeticao.jsx`, junto dos imports:

```jsx
import { nomeMapa, dataHora } from '../lib/format.js'
import { PlayerClipe, SnapshotPlaceholder, nomeDoKind } from './ui/PlayerClipe.jsx'
```

E duas funções de módulo:

```jsx
// Breakdown como TEXTO, não tooltip: a decisão "qual clipe vale mais" é tomada
// aqui, e no celular não existe hover. Só entram os componentes que somaram.
function partesDaPontuacao(p) {
  const partes = []
  if (p.kills > 0) partes.push(`${p.kills} kills ${p.pontosKills}`)
  if (p.headshots > 0) partes.push(`${p.headshots} hs ${p.pontosHeadshots}`)
  if (p.armas > 0) partes.push(`${p.armas} armas ${p.pontosArmas}`)
  if (p.clutch) partes.push(`clutch ${p.clutch} ${p.pontosClutch}`)
  return partes
}

// Sem Highlight correspondente (kind nulo) o rótulo cai pro número de kills, que
// é mais informativo que o "MOMENTO" genérico quando o Jogador está escolhendo.
function rotuloDaJogada(clipe) {
  if (clipe.kind) return nomeDoKind(clipe.kind)
  const kills = clipe.pontuacao?.kills
  return kills > 0 ? `${kills} KILLS` : 'MOMENTO'
}
```

- [ ] **Step 4: Implementar o card e o cabeçalho**

Estado novo, junto dos que já existem:

```jsx
  const [clipeAberto, setClipeAberto] = useState(null)
```

Motivo do bloqueio, derivado dos limites:

```jsx
  const motivoBloqueio = !limites
    ? null
    : limites.hoje >= limites.limiteDiario
      ? 'limite diário atingido'
      : limites.total >= limites.limiteTotal
        ? 'limite total atingido'
        : null
```

Abaixo do `<h2>` do cabeçalho:

```jsx
        {limites && (
          <p className="mt-1 font-mono text-xs text-texto-fraco">
            {limites.hoje} de {limites.limiteDiario} enviados hoje · {limites.total} de {limites.limiteTotal} no total · mínimo {limites.minimoParaRankear} pra rankear
          </p>
        )}
```

E o corpo do card, substituindo o `<div>` de cada clipe:

```jsx
              <div key={c.allstarClipId} className="panel-cut-sm border border-borda p-3">
                {clipeAberto === c.allstarClipId ? (
                  <PlayerClipe
                    clipUrl={c.clipUrl}
                    titulo={`${nomeMapa(c.map)} round ${c.roundNumber}`}
                    location="selecaoCompeticao"
                  />
                ) : c.clipSnapshotUrl ? (
                  <button
                    type="button"
                    onClick={() => setClipeAberto(c.allstarClipId)}
                    aria-label={`Assistir clipe de ${nomeMapa(c.map)} round ${c.roundNumber}`}
                    className="relative mt-3 block aspect-video w-full border border-borda"
                  >
                    <img src={c.clipSnapshotUrl} alt="" className="h-full w-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center bg-fundo/40 font-mono text-xs uppercase tracking-widest text-texto">
                      ▶ assistir
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setClipeAberto(c.allstarClipId)}
                    aria-label={`Assistir clipe de ${nomeMapa(c.map)} round ${c.roundNumber}`}
                    className="block w-full"
                  >
                    <SnapshotPlaceholder />
                  </button>
                )}

                <div className="mt-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="panel-cut-sm border border-destaque/40 bg-destaque/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-destaque">
                      {rotuloDaJogada(c)}
                    </span>
                    <p className="mt-1 font-mono text-xs text-texto-fraco">
                      {nomeMapa(c.map)} · {dataHora(c.playedAt)} · round {c.roundNumber}
                    </p>
                  </div>
                  <span className="font-display text-lg font-bold text-destaque">{c.pontuacao.total}</span>
                </div>

                {partesDaPontuacao(c.pontuacao).length > 0 && (
                  <p className="mt-1 font-mono text-[11px] text-texto-fraco">
                    {partesDaPontuacao(c.pontuacao).join(' · ')}
                  </p>
                )}

                <button
                  onClick={() => enviar(c.allstarClipId)}
                  disabled={c.jaEnviado || enviando === c.allstarClipId || Boolean(motivoBloqueio)}
                  className="panel-cut-sm mt-2 min-h-10 w-full border border-borda px-3 font-mono text-xs uppercase text-texto-fraco hover:border-destaque/50 hover:text-destaque disabled:opacity-50 lg:min-h-0"
                >
                  {c.jaEnviado ? 'já enviado' : motivoBloqueio ? motivoBloqueio : enviando === c.allstarClipId ? '…' : 'enviar'}
                </button>
              </div>
```

- [ ] **Step 5: Rodar os testes e o build**

Run: `cd site/client && npm test && npm run build`
Expected: PASS + build limpo.

- [ ] **Step 6: Verificar no browser**

Abrir a aba Competições, clicar em "Enviar clipe" e confirmar com um screenshot
que o modal aparece inteiro, centralizado, sem recorte — e que os cards mostram
thumbnail, jogada, contexto e breakdown.

- [ ] **Step 7: Commit**

```bash
git add site/client/src/components/SeletorClipesCompeticao.jsx site/client/src/test/SeletorClipesCompeticao.test.jsx
git commit -m "feat: cards do seletor com preview, jogada, contexto e breakdown"
```

---

## Verificação final

- [ ] `cd site/server && npm test` — PASS
- [ ] `cd site/client && npm test && npm run build` — PASS
- [ ] Modal conferido no browser, sem recorte, na aba Competições
- [ ] Nenhuma migration nesta branch — nada a aplicar antes do merge
