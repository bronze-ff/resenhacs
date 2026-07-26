# Assistir os Clipes dos outros na Competição — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar qualquer competidor assistir os Clipes enviados à Competição —
no feed de envios recentes e expandindo um Jogador no leaderboard — com contexto
suficiente pra julgar a jogada sem abrir o vídeo.

**Architecture:** O card de Clipe que hoje vive dentro de
`SeletorClipesCompeticao.jsx` vira componente próprio, com autor e ação como
variações por prop, e passa a servir três telas. O feed ganha o contexto que
falta na query (mapa, data, round, jogada) e nasce um endpoint pra buscar os
Clipes de um Jogador na Competição, com mapeamento explícito que deixa de fora os
campos de conferência do admin.

**Tech Stack:** Express (ESM) + vitest/supertest no servidor; React + Tailwind +
vitest/@testing-library no cliente; Postgres (Supabase).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-26-assistir-clipes-dos-outros-design.md`.
- Vocabulário do `CONTEXT.md`: **Partida**, **Jogador**, **Participante**,
  **Clipe**, **Highlight**. Nada de "match", "player", "user" em texto de UI,
  comentário ou mensagem de erro.
- Toda mensagem de UI e de erro de API em **PT-BR**.
- O endpoint público de Clipes de um Jogador **não** devolve `origemNaoVerificada`
  nem `plataformaManual` — são campos de conferência do admin. Mapeamento campo a
  campo, nunca espalhar o objeto.
- Todo join com `highlights` é `left join lateral … limit 1`: LEFT porque Clipes
  do fluxo novo têm `highlight_id` nulo, lateral com limit porque `highlights` não
  tem unique em `(match_id, steam_id64, round_number)` e um Jogador com `ace` e
  `clutch_1v4` no mesmo round duplicaria a linha.
- **Sem link "ver partida"** no card. A página da Partida é protegida por
  amizade/participação e o link quebraria pra maioria dos competidores.
- Um player de vídeo tocando por vez em toda a tela.
- Rodar testes: `cd site/server && npm test`; `cd site/client && npm test`;
  build com `cd site/client && npm run build`.
- Trabalhar na branch `feat/assistir-clipes-competicao`, criada a partir do
  `main` já sincronizado (ver `docs/WORKFLOW.md`) — **não** commitar código de
  feature direto no `main`.
- Nenhuma migration: todas as colunas já existem.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `site/server/src/routes/competicoes.js` | **Modificar.** Contexto no `buscarClipesRecentes`; endpoint `GET /:id/jogador/:steamId/clipes` |
| `site/server/test/competicoes.test.js` | **Modificar.** Shape do feed, endpoint novo, ausência dos campos de admin |
| `site/client/src/components/CardClipeCompeticao.jsx` | **Criar.** O card de Clipe compartilhado pelas três telas |
| `site/client/src/components/SeletorClipesCompeticao.jsx` | **Modificar.** Passa a usar o card extraído |
| `site/client/src/pages/Competicoes.jsx` | **Modificar.** Feed com cards; leaderboard expansível |
| `site/client/src/test/CardClipeCompeticao.test.jsx` | **Criar.** Testes do card |
| `site/client/src/test/Competicoes.test.jsx` | **Modificar.** Feed e expansão do leaderboard |

---

## Task 1: Contexto da jogada no feed

**Files:**
- Modify: `site/server/src/routes/competicoes.js:74-99` (`buscarClipesRecentes`)
- Test: `site/server/test/competicoes.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: cada item de `clipesRecentes` passa a ter, além do que já tinha
  (`id`, `clipUrl`, `clipSnapshotUrl`, `steamId`, `nick`, `avatarUrl`,
  `pontuacao`): `map: string`, `playedAt: string`, `roundNumber: number`,
  `kind: string | null`.

- [ ] **Step 1: Escrever os testes que falham**

Em `site/server/test/competicoes.test.js`, no bloco que já cobre
`GET /api/competicoes` (o helper `appWith` casa por trecho de SQL; siga o estilo
dos testes vizinhos):

```js
  it('clipes recentes trazem o contexto da jogada', async () => {
    const agora = new Date()
    const playedAt = new Date('2026-07-25T00:37:00Z')
    const { app } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: 'Skin',
        data_inicio: new Date(agora.getTime() - 86400000),
        data_fim: new Date(agora.getTime() + 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 3,
        vencedor_steam_id64: null,
      }]],
      ['from competicao_submissoes cs', [{
        id: 'c1', clip_url: 'https://allstar/c1', clip_snapshot_url: 'https://allstar/c1.jpg',
        steam_id64: '765', nick: 'bronze', avatar_url: null,
        map: 'de_inferno', played_at: playedAt, round_number: 18, kind: 'clutch_1v3',
        pontuacao_total: 111, pontuacao_detalhe: { kills: 3, total: 111 },
      }]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)

    const clipe = res.body.ativa.clipesRecentes[0]
    expect(clipe.map).toBe('de_inferno')
    expect(clipe.playedAt).toBe(playedAt.toISOString())
    expect(clipe.roundNumber).toBe(18)
    expect(clipe.kind).toBe('clutch_1v3')
    expect(clipe.nick).toBe('bronze')
    expect(clipe.clipUrl).toBe('https://allstar/c1')
  })

  it('clipe recente sem Highlight correspondente continua na lista, com kind nulo', async () => {
    const agora = new Date()
    const { app } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: 'Skin',
        data_inicio: new Date(agora.getTime() - 86400000),
        data_fim: new Date(agora.getTime() + 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 3,
        vencedor_steam_id64: null,
      }]],
      ['from competicao_submissoes cs', [{
        id: 'c1', clip_url: 'https://allstar/c1', clip_snapshot_url: null,
        steam_id64: '765', nick: 'bronze', avatar_url: null,
        map: 'de_dust2', played_at: new Date(), round_number: 4, kind: null,
        pontuacao_total: 30, pontuacao_detalhe: null,
      }]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)

    expect(res.body.ativa.clipesRecentes).toHaveLength(1)
    expect(res.body.ativa.clipesRecentes[0].kind).toBeNull()
    expect(res.body.ativa.clipesRecentes[0].pontuacao).toEqual({ total: 30 })
  })

  it('o feed usa left join lateral com limit 1 (Jogador com dois Highlights no mesmo round)', async () => {
    const agora = new Date()
    const { app, db } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: 'Skin',
        data_inicio: new Date(agora.getTime() - 86400000),
        data_fim: new Date(agora.getTime() + 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 3,
        vencedor_steam_id64: null,
      }]],
    ])
    await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    const q = db.query.mock.calls.find((c) => c[0].includes('from competicao_submissoes cs'))[0]
    expect(q).toContain('left join lateral')
    expect(q).toContain('limit 1')
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/server && npx vitest run test/competicoes.test.js -t "contexto da jogada"`
Expected: FAIL — `clipe.map` é `undefined`.

- [ ] **Step 3: Implementar**

Substituir o corpo de `buscarClipesRecentes` por:

```js
async function buscarClipesRecentes(db, competicaoId) {
  const { rows } = await db.query(
    `select ac.id, ac.clip_url, ac.clip_snapshot_url, ac.pontuacao_total, ac.pontuacao_detalhe,
            ac.round_number,
            cs.steam_id64, coalesce(p.nick, mp.nick) as nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url,
            cs.enviado_em, m.map, m.played_at, h.kind
     from competicao_submissoes cs
     join allstar_clips ac on ac.id = cs.allstar_clip_id
     join matches m on m.id = ac.match_id
     left join lateral (
       select h.kind from highlights h
       where h.match_id = ac.match_id
         and h.steam_id64 = ac.steam_id64
         and h.round_number = ac.round_number
       order by h.kind
       limit 1
     ) h on true
     left join players p on p.steam_id64 = cs.steam_id64
     left join match_players mp on mp.match_id = ac.match_id and mp.steam_id64 = cs.steam_id64
     left join steam_avatares sa on sa.steam_id64 = cs.steam_id64
     where cs.competicao_id = $1
     order by cs.enviado_em desc
     limit 20`,
    [competicaoId],
  )
  return rows.map((r) => ({
    id: r.id, clipUrl: r.clip_url, clipSnapshotUrl: r.clip_snapshot_url,
    steamId: r.steam_id64, nick: r.nick, avatarUrl: r.avatar_url,
    map: r.map, playedAt: r.played_at, roundNumber: r.round_number, kind: r.kind ?? null,
    pontuacao: r.pontuacao_detalhe ?? { total: r.pontuacao_total ?? 0 },
  }))
}
```

O comentário acima da função continua válido; acrescente uma linha explicando o
lateral:

```js
// O join com highlights é LEFT LATERAL com limit 1: LEFT porque Clipe do fluxo
// novo tem highlight_id nulo e sumiria; lateral+limit porque o mesmo Jogador pode
// ter dois Highlights no mesmo round (ace + clutch), o que duplicaria o Clipe.
```

- [ ] **Step 4: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/competicoes.js site/server/test/competicoes.test.js
git commit -m "feat: contexto da jogada nos clipes recentes da Competicao"
```

---

## Task 2: Endpoint dos Clipes de um Jogador

**Files:**
- Modify: `site/server/src/routes/competicoes.js` (rota nova, junto das outras de leitura)
- Test: `site/server/test/competicoes.test.js`

**Interfaces:**
- Consumes: nada da Task 1 (query própria).
- Produces: `GET /api/competicoes/:id/jogador/:steamId/clipes` → `{ clipes: [...] }`,
  cada item no **mesmo shape** do feed da Task 1: `{ id, clipUrl, clipSnapshotUrl,
  map, playedAt, roundNumber, kind, pontuacao }`. Sem `origemNaoVerificada`, sem
  `plataformaManual`.

- [ ] **Step 1: Escrever os testes que falham**

```js
describe('GET /api/competicoes/:id/jogador/:steamId/clipes', () => {
  const ID = '11111111-1111-1111-1111-111111111111'

  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get(`/api/competicoes/${ID}/jogador/765/clipes`)).status).toBe(401)
  })

  it('competicao inexistente: 404', async () => {
    const { app } = appWith([])
    const res = await request(app).get(`/api/competicoes/${ID}/jogador/765/clipes`).set('Cookie', cookieJogador)
    expect(res.status).toBe(404)
  })

  it('id nao-uuid: 404', async () => {
    const { app } = appWith([['from competicoes', [{ id: 'comp1' }]]])
    const res = await request(app).get('/api/competicoes/nao-uuid/jogador/765/clipes').set('Cookie', cookieJogador)
    expect(res.status).toBe(404)
  })

  it('devolve os clipes daquele Jogador com o contexto da jogada', async () => {
    const playedAt = new Date('2026-07-25T00:37:00Z')
    const { app, db } = appWith([
      ['from competicoes', [{ id: 'comp1' }]],
      ['from competicao_submissoes cs', [{
        id: 'c1', clip_url: 'https://allstar/c1', clip_snapshot_url: 'https://allstar/c1.jpg',
        map: 'de_inferno', played_at: playedAt, round_number: 18, kind: 'ace',
        pontuacao_total: 111, pontuacao_detalhe: { kills: 3, total: 111 },
      }]],
    ])
    const res = await request(app).get(`/api/competicoes/${ID}/jogador/765/clipes`).set('Cookie', cookieJogador)

    expect(res.status).toBe(200)
    expect(res.body.clipes).toEqual([{
      id: 'c1', clipUrl: 'https://allstar/c1', clipSnapshotUrl: 'https://allstar/c1.jpg',
      map: 'de_inferno', playedAt: playedAt.toISOString(), roundNumber: 18, kind: 'ace',
      pontuacao: { kills: 3, total: 111 },
    }])
    // escopo: a query filtra pela competição e pelo steamId da URL
    const [, params] = db.query.mock.calls.find((c) => c[0].includes('from competicao_submissoes cs'))
    expect(params).toEqual(['comp1', '765'])
  })

  it('NAO devolve os campos de conferencia do admin', async () => {
    // origemNaoVerificada e plataformaManual existem pra o admin checar o vencedor
    // antes de liberar o premio — exibir isso pros competidores foi decidido contra.
    const { app } = appWith([
      ['from competicoes', [{ id: 'comp1' }]],
      ['from competicao_submissoes cs', [{
        id: 'c1', clip_url: 'https://allstar/c1', clip_snapshot_url: null,
        map: 'de_dust2', played_at: new Date(), round_number: 4, kind: null,
        pontuacao_total: 30, pontuacao_detalhe: null,
        source: 'upload', plataforma_manual: 'faceit',
      }]],
    ])
    const res = await request(app).get(`/api/competicoes/${ID}/jogador/765/clipes`).set('Cookie', cookieJogador)

    expect(res.body.clipes[0]).not.toHaveProperty('origemNaoVerificada')
    expect(res.body.clipes[0]).not.toHaveProperty('plataformaManual')
    expect(res.body.clipes[0].pontuacao).toEqual({ total: 30 })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/server && npx vitest run test/competicoes.test.js -t "jogador"`
Expected: FAIL — 404 em tudo (rota não existe).

- [ ] **Step 3: Implementar**

Em `site/server/src/routes/competicoes.js`, junto das outras rotas de leitura
(antes de `router.post('/:id/submissoes', …)`):

```js
  // Clipes de um Jogador nesta Competição — alimenta a expansão de uma linha do
  // leaderboard. requireAuth só, igual ao GET /api/competicoes, que já devolve o
  // feed com as mesmas URLs de Clipe.
  //
  // O mapeamento é campo a campo DE PROPÓSITO: buscarSubmissoesDoJogador (usada
  // pela tela de admin) devolve origemNaoVerificada e plataformaManual, que são
  // conferência de admin e não podem chegar aos competidores. Espalhar o objeto
  // faria um campo sensível acrescentado amanhã vazar sozinho.
  router.get('/:id/jogador/:steamId/clipes', requireAuth, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'competição não encontrada' })
    const steamId = String(req.params.steamId)
    if (!/^\d{1,20}$/.test(steamId)) return res.status(404).json({ erro: 'jogador não encontrado' })

    const { rows: compRows } = await db.query('select id from competicoes where id = $1', [req.params.id])
    if (!compRows.length) return res.status(404).json({ erro: 'competição não encontrada' })

    const { rows } = await db.query(
      `select ac.id, ac.clip_url, ac.clip_snapshot_url, ac.pontuacao_total, ac.pontuacao_detalhe,
              ac.round_number, m.map, m.played_at, h.kind
       from competicao_submissoes cs
       join allstar_clips ac on ac.id = cs.allstar_clip_id
       join matches m on m.id = ac.match_id
       left join lateral (
         select h.kind from highlights h
         where h.match_id = ac.match_id
           and h.steam_id64 = ac.steam_id64
           and h.round_number = ac.round_number
         order by h.kind
         limit 1
       ) h on true
       where cs.competicao_id = $1 and cs.steam_id64 = $2
       order by cs.enviado_em desc`,
      [compRows[0].id, steamId],
    )
    res.json({
      clipes: rows.map((r) => ({
        id: r.id,
        clipUrl: r.clip_url,
        clipSnapshotUrl: r.clip_snapshot_url,
        map: r.map,
        playedAt: r.played_at,
        roundNumber: r.round_number,
        kind: r.kind ?? null,
        pontuacao: r.pontuacao_detalhe ?? { total: r.pontuacao_total ?? 0 },
      })),
    })
  })
```

- [ ] **Step 4: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/competicoes.js site/server/test/competicoes.test.js
git commit -m "feat: endpoint dos clipes de um Jogador na Competicao"
```

---

## Task 3: Extrair o card de Clipe

**Files:**
- Create: `site/client/src/components/CardClipeCompeticao.jsx`
- Create: `site/client/src/test/CardClipeCompeticao.test.jsx`
- Modify: `site/client/src/components/SeletorClipesCompeticao.jsx`

**Interfaces:**
- Consumes: `PlayerClipe`, `SnapshotPlaceholder`, `nomeDoKind` de
  `./ui/PlayerClipe.jsx`; `nomeMapa`, `dataHora` de `../lib/format.js`.
- Produces, de `site/client/src/components/CardClipeCompeticao.jsx`:
  - default `CardClipeCompeticao({ clipe, autor, aberto, onAbrir, viewerSteamId, location, acao })`
    — `clipe` exige `{ id, map, playedAt, roundNumber, kind, clipUrl,
    clipSnapshotUrl, pontuacao }` e, quando `autor` é true, `{ nick, avatarUrl }`;
    `onAbrir(idOuNull)`;
  - `partesDaPontuacao(p) -> string[]`;
  - `rotuloDaJogada(clipe) -> string`.

- [ ] **Step 1: Escrever os testes que falham**

`site/client/src/test/CardClipeCompeticao.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CardClipeCompeticao, { partesDaPontuacao, rotuloDaJogada } from '../components/CardClipeCompeticao.jsx'

const CLIPE = {
  id: 'c1', map: 'de_inferno', playedAt: '2026-07-25T03:37:00Z', roundNumber: 18,
  kind: 'clutch_1v3', clipUrl: 'https://allstar/c1', clipSnapshotUrl: 'https://allstar/c1.jpg',
  pontuacao: { kills: 3, pontosKills: 50, headshots: 2, pontosHeadshots: 16, armas: 2, pontosArmas: 10, clutch: '1v3', pontosClutch: 35, total: 111 },
  nick: 'bronze', avatarUrl: 'https://avatar/bronze.jpg',
}

describe('partesDaPontuacao', () => {
  it('so inclui o que somou', () => {
    expect(partesDaPontuacao({ kills: 2, pontosKills: 25, headshots: 0, armas: 1, pontosArmas: 5, clutch: null, total: 30 }))
      .toEqual(['2 kills 25', '1 armas 5'])
  })

  it('aguenta a forma reduzida { total }', () => {
    expect(partesDaPontuacao({ total: 30 })).toEqual([])
  })
})

describe('rotuloDaJogada', () => {
  it('usa o kind quando existe', () => {
    expect(rotuloDaJogada(CLIPE)).toBe('CLUTCH 1v3')
  })

  it('sem kind, cai pro numero de kills', () => {
    expect(rotuloDaJogada({ kind: null, pontuacao: { kills: 3 } })).toBe('3 KILLS')
  })

  it('sem kind e sem kills, MOMENTO', () => {
    expect(rotuloDaJogada({ kind: null, pontuacao: { total: 0 } })).toBe('MOMENTO')
  })
})

describe('CardClipeCompeticao', () => {
  it('mostra jogada, contexto e breakdown', () => {
    render(<CardClipeCompeticao clipe={CLIPE} aberto={false} onAbrir={() => {}} />)
    expect(screen.getByText('CLUTCH 1v3')).toBeInTheDocument()
    expect(screen.getByText(/Inferno/)).toBeInTheDocument()
    expect(screen.getByText(/round 18/)).toBeInTheDocument()
    expect(screen.getByText('111')).toBeInTheDocument()
    expect(screen.getByText(/3 kills 50/)).toBeInTheDocument()
  })

  it('com autor, mostra nick e avatar de quem enviou', () => {
    const { container } = render(<CardClipeCompeticao clipe={CLIPE} autor aberto={false} onAbrir={() => {}} />)
    expect(screen.getByText('bronze')).toBeInTheDocument()
    // duas <img> no card (avatar e snapshot), as duas com alt="" por serem
    // decorativas — localiza pelo src, não por alt.
    const fontes = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'))
    expect(fontes).toContain('https://avatar/bronze.jpg')
  })

  it('sem autor, nao mostra o nick', () => {
    render(<CardClipeCompeticao clipe={CLIPE} aberto={false} onAbrir={() => {}} />)
    expect(screen.queryByText('bronze')).toBeNull()
  })

  it('renderiza a acao quando recebe, e nada quando nao', () => {
    const { rerender } = render(
      <CardClipeCompeticao clipe={CLIPE} aberto={false} onAbrir={() => {}} acao={<button>enviar</button>} />,
    )
    expect(screen.getByRole('button', { name: 'enviar' })).toBeInTheDocument()
    rerender(<CardClipeCompeticao clipe={CLIPE} aberto={false} onAbrir={() => {}} />)
    expect(screen.queryByRole('button', { name: 'enviar' })).toBeNull()
  })

  it('clicar no thumbnail pede pra abrir; clicar em fechar pede pra fechar', () => {
    const onAbrir = vi.fn()
    const { rerender } = render(<CardClipeCompeticao clipe={CLIPE} aberto={false} onAbrir={onAbrir} />)
    fireEvent.click(screen.getByRole('button', { name: /assistir/i }))
    expect(onAbrir).toHaveBeenCalledWith('c1')

    rerender(<CardClipeCompeticao clipe={CLIPE} aberto onAbrir={onAbrir} />)
    expect(document.querySelector('iframe')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /fechar/i }))
    expect(onAbrir).toHaveBeenCalledWith(null)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/client && npx vitest run src/test/CardClipeCompeticao.test.jsx`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Criar o componente**

`site/client/src/components/CardClipeCompeticao.jsx` — o corpo vem, sem mudança
de aparência, do que hoje está inline em `SeletorClipesCompeticao.jsx`:

```jsx
// Card de um Clipe de Competição, compartilhado por três telas: a seleção de envio
// (com botão), o feed de enviados recentes e a expansão de um Jogador no
// leaderboard (as duas últimas com autor). Sem esta extração o mesmo card
// existiria em três variantes parecidas-mas-não-iguais.
import { PlayerClipe, SnapshotPlaceholder, nomeDoKind } from './ui/PlayerClipe.jsx'
import { nomeMapa, dataHora } from '../lib/format.js'

// Breakdown como TEXTO, não tooltip: a decisão "essa jogada foi boa?" é tomada
// olhando o card, e no celular não existe hover. Só entram os componentes que
// somaram. Aguenta a forma reduzida { total } dos Clipes antigos sem detalhe.
export function partesDaPontuacao(p) {
  const partes = []
  if (p.kills > 0) partes.push(`${p.kills} kills ${p.pontosKills}`)
  if (p.headshots > 0) partes.push(`${p.headshots} hs ${p.pontosHeadshots}`)
  if (p.armas > 0) partes.push(`${p.armas} armas ${p.pontosArmas}`)
  if (p.clutch) partes.push(`clutch ${p.clutch} ${p.pontosClutch}`)
  return partes
}

// Sem Highlight correspondente (kind nulo) o rótulo cai pro número de kills, que
// diz mais que o "MOMENTO" genérico pra quem está julgando a jogada.
export function rotuloDaJogada(clipe) {
  if (clipe.kind) return nomeDoKind(clipe.kind)
  const kills = clipe.pontuacao?.kills
  return kills > 0 ? `${kills} KILLS` : 'MOMENTO'
}

export default function CardClipeCompeticao({
  clipe, autor = false, aberto, onAbrir, viewerSteamId, location = 'competicao', acao = null,
}) {
  const abrirOuFechar = () => onAbrir(aberto ? null : clipe.id)
  const rotuloAssistir = `Assistir clipe de ${nomeMapa(clipe.map)} round ${clipe.roundNumber}`

  return (
    <div className="panel-cut-sm border border-borda p-3">
      {autor && (
        <div className="flex items-center gap-2">
          {clipe.avatarUrl && (
            <img src={clipe.avatarUrl} alt="" className="panel-cut-sm h-6 w-6 border border-borda object-cover" />
          )}
          <span className="min-w-0 truncate font-mono text-xs text-texto">{clipe.nick}</span>
        </div>
      )}

      {aberto ? (
        <>
          <button
            type="button"
            onClick={abrirOuFechar}
            className="mt-3 font-mono text-xs uppercase text-texto-fraco hover:text-texto"
          >
            fechar
          </button>
          <PlayerClipe
            clipUrl={clipe.clipUrl}
            viewerSteamId={viewerSteamId}
            titulo={`${nomeMapa(clipe.map)} round ${clipe.roundNumber}`}
            location={location}
          />
        </>
      ) : clipe.clipSnapshotUrl ? (
        <button
          type="button"
          onClick={abrirOuFechar}
          aria-label={rotuloAssistir}
          className="relative mt-3 block aspect-video w-full border border-borda"
        >
          <img src={clipe.clipSnapshotUrl} alt="" className="h-full w-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center bg-fundo/40 font-mono text-xs uppercase tracking-widest text-texto">
            ▶ assistir
          </span>
        </button>
      ) : (
        <button type="button" onClick={abrirOuFechar} aria-label={rotuloAssistir} className="block w-full">
          <SnapshotPlaceholder />
        </button>
      )}

      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="panel-cut-sm border border-destaque/40 bg-destaque/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-destaque">
            {rotuloDaJogada(clipe)}
          </span>
          <p className="mt-1 font-mono text-xs text-texto-fraco">
            {nomeMapa(clipe.map)} · {dataHora(clipe.playedAt)} · round {clipe.roundNumber}
          </p>
        </div>
        <span className="font-display text-lg font-bold text-destaque">{clipe.pontuacao.total}</span>
      </div>

      {partesDaPontuacao(clipe.pontuacao).length > 0 && (
        <p className="mt-1 font-mono text-[11px] text-texto-fraco">
          {partesDaPontuacao(clipe.pontuacao).join(' · ')}
        </p>
      )}

      {acao}
    </div>
  )
}
```

- [ ] **Step 4: Fazer o seletor usar o card**

Em `site/client/src/components/SeletorClipesCompeticao.jsx`:

Trocar os imports de `nomeMapa`/`dataHora`/`PlayerClipe`/`SnapshotPlaceholder`/
`nomeDoKind` e apagar as funções locais `partesDaPontuacao` e `rotuloDaJogada`,
deixando:

```jsx
import CardClipeCompeticao from './CardClipeCompeticao.jsx'
```

(`nomeMapa` continua necessário se o arquivo ainda o usar em outro ponto — se
não usar mais, remova o import; o build acusa import não usado como aviso do
lint, não como erro, então confira o arquivo depois de editar.)

Normalizar a chave do Clipe no `carregar()`, porque o endpoint `/elegiveis`
devolve `allstarClipId` e o card exige `id`:

```jsx
      .then((body) => {
        // O card compartilhado exige `id`; /elegiveis devolve `allstarClipId` por
        // contrato anterior. Normaliza aqui, na fronteira, em vez de o card
        // aceitar duas chaves.
        setClipes((body.clipes ?? []).map((c) => ({ ...c, id: c.allstarClipId })))
        setLimites(body.limites ?? null)
      })
```

E o `map` dos cards vira:

```jsx
            {clipes.map((c) => (
              <CardClipeCompeticao
                key={c.id}
                clipe={c}
                aberto={clipeAberto === c.id}
                onAbrir={setClipeAberto}
                viewerSteamId={jogador?.steamId}
                location="selecaoCompeticao"
                acao={
                  <button
                    onClick={() => enviar(c.allstarClipId)}
                    disabled={c.jaEnviado || enviando === c.allstarClipId || Boolean(motivoBloqueio)}
                    className="panel-cut-sm mt-2 min-h-10 w-full border border-borda px-3 font-mono text-xs uppercase text-texto-fraco hover:border-destaque/50 hover:text-destaque disabled:opacity-50 lg:min-h-0"
                  >
                    {c.jaEnviado ? 'já enviado' : motivoBloqueio ? motivoBloqueio : enviando === c.allstarClipId ? '…' : 'enviar'}
                  </button>
                }
              />
            ))}
```

- [ ] **Step 5: Rodar os testes e o build**

Run: `cd site/client && npm test && npm run build`
Expected: PASS — inclusive `SeletorClipesCompeticao.test.jsx` inteiro, sem
alterações nele. Se algum teste de lá quebrar, o card mudou de comportamento e
não deveria: conserte o card, não o teste.

- [ ] **Step 6: Commit**

```bash
git add site/client/src/components/CardClipeCompeticao.jsx site/client/src/components/SeletorClipesCompeticao.jsx site/client/src/test/CardClipeCompeticao.test.jsx
git commit -m "refactor: extrai o card de Clipe da Competicao pra componente proprio"
```

---

## Task 4: Feed com os Clipes assistíveis

**Files:**
- Modify: `site/client/src/pages/Competicoes.jsx` (seção "Enviados recentemente")
- Test: `site/client/src/test/Competicoes.test.jsx`

**Interfaces:**
- Consumes: `CardClipeCompeticao` (Task 3); o shape do feed com `map`,
  `playedAt`, `roundNumber`, `kind` (Task 1).
- Produces: o estado `clipeAberto` em `CardCompeticao`, compartilhado com a
  Task 5 (`const [clipeAberto, setClipeAberto] = useState(null)`).

- [ ] **Step 1: Escrever o teste que falha**

O arquivo **não tem helpers compartilhados**: cada teste monta o próprio
`global.fetch = vi.fn()` e chama `render(<Competicoes />)`. Siga esse estilo —
não crie infraestrutura nova. Acrescente `fireEvent` ao import de
`@testing-library/react`, que hoje traz só `render`, `screen` e `waitFor`.

```jsx
  it('o feed mostra o clipe de outro Jogador com contexto e deixa assistir', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ativa: {
          id: 'comp1', nome: 'Semana 1', premioDescricao: 'Skin',
          dataFim: new Date(Date.now() + 86400000).toISOString(),
          limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 3, leaderboard: [],
          clipesRecentes: [{
            id: 'c1', nick: 'adversario', avatarUrl: null,
            clipUrl: 'https://allstar/c1', clipSnapshotUrl: 'https://allstar/c1.jpg',
            map: 'de_inferno', playedAt: '2026-07-25T03:37:00Z', roundNumber: 18, kind: 'ace',
            pontuacao: { kills: 5, pontosKills: 120, total: 120 },
          }],
        },
        encerradas: [],
      }),
    })
    render(<Competicoes />)

    await waitFor(() => expect(screen.getByText('adversario')).toBeInTheDocument())
    expect(screen.getByText('ACE')).toBeInTheDocument()
    expect(screen.getByText(/Inferno/)).toBeInTheDocument()
    expect(screen.getByText(/round 18/)).toBeInTheDocument()

    expect(document.querySelector('iframe')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /assistir/i }))
    expect(document.querySelector('iframe')).toBeTruthy()
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/client && npx vitest run src/test/Competicoes.test.jsx -t "feed mostra"`
Expected: FAIL — o feed só renderiza nick e total, não há botão "assistir".

- [ ] **Step 3: Implementar**

Em `site/client/src/pages/Competicoes.jsx`, importar o card e o contexto de
autenticação (o arquivo já importa `useAuth`):

```jsx
import CardClipeCompeticao from '../components/CardClipeCompeticao.jsx'
```

Dentro de `CardCompeticao`, junto dos outros `useState`:

```jsx
  // Um player tocando por vez em toda a tela: o estado mora aqui, acima do feed e
  // do leaderboard, senão dois vídeos tocariam com áudio ao mesmo tempo.
  const [clipeAberto, setClipeAberto] = useState(null)
```

E a seção "Enviados recentemente" passa a ser:

```jsx
      {comp.clipesRecentes?.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">Enviados recentemente</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {comp.clipesRecentes.map((c) => (
              <CardClipeCompeticao
                key={c.id}
                clipe={c}
                autor
                aberto={clipeAberto === c.id}
                onAbrir={setClipeAberto}
                viewerSteamId={viewerSteamId}
                location="feedCompeticao"
              />
            ))}
          </div>
        </div>
      )}
```

`viewerSteamId` já é prop de `CardCompeticao`.

- [ ] **Step 4: Rodar os testes e o build**

Run: `cd site/client && npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/client/src/pages/Competicoes.jsx site/client/src/test/Competicoes.test.jsx
git commit -m "feat: assistir no feed os clipes enviados pra Competicao"
```

---

## Task 5: Leaderboard expansível

**Files:**
- Modify: `site/client/src/pages/Competicoes.jsx` (componente `Leaderboard`, linhas 8-29)
- Test: `site/client/src/test/Competicoes.test.jsx`

**Interfaces:**
- Consumes: `CardClipeCompeticao` (Task 3); o endpoint
  `GET /api/competicoes/:id/jogador/:steamId/clipes` (Task 2); o estado
  `clipeAberto`/`setClipeAberto` de `CardCompeticao` (Task 4).
- Produces: nada — é a última camada.

- [ ] **Step 1: Escrever os testes que falham**

Mesmo estilo do resto do arquivo: `global.fetch = vi.fn()` próprio por teste,
agora despachando por URL porque a página faz duas chamadas diferentes.

```jsx
  // Monta a resposta da competição e a dos clipes de um Jogador na mesma função,
  // despachando por URL — a página busca /api/competicoes no mount e
  // /jogador/:steamId/clipes só quando o leaderboard expande.
  function mockCompeticaoComClipesDoJogador(clipes) {
    return vi.fn().mockImplementation((url) => {
      if (String(url).includes('/jogador/999/clipes')) {
        return Promise.resolve({ ok: true, json: async () => ({ clipes }) })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ativa: {
            id: 'comp1', nome: 'Semana 1', premioDescricao: 'Skin',
            dataFim: new Date(Date.now() + 86400000).toISOString(),
            limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 3, clipesRecentes: [],
            leaderboard: [{ steamId: '999', nick: 'adversario', avatarUrl: null, total: 148, qualificado: true }],
          },
          encerradas: [],
        }),
      })
    })
  }

  const chamadasDeClipes = () =>
    global.fetch.mock.calls.filter(([url]) => String(url).includes('/jogador/999/clipes')).length

  it('expandir um Jogador do leaderboard busca e mostra os clipes dele', async () => {
    global.fetch = mockCompeticaoComClipesDoJogador([{
      id: 'c1', clipUrl: 'https://allstar/c1', clipSnapshotUrl: null,
      map: 'de_mirage', playedAt: '2026-07-25T03:37:00Z', roundNumber: 7, kind: 'quad',
      pontuacao: { kills: 4, pontosKills: 80, total: 80 },
    }])
    render(<Competicoes />)

    await waitFor(() => expect(screen.getByText('adversario')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /adversario/i }))

    await waitFor(() => expect(screen.getByText('QUAD KILL')).toBeInTheDocument())
    expect(screen.getByText(/Mirage/)).toBeInTheDocument()
  })

  it('recolher e expandir de novo nao refaz a busca', async () => {
    global.fetch = mockCompeticaoComClipesDoJogador([])
    render(<Competicoes />)
    await waitFor(() => expect(screen.getByText('adversario')).toBeInTheDocument())

    const linha = screen.getByRole('button', { name: /adversario/i })
    fireEvent.click(linha)
    await waitFor(() => expect(chamadasDeClipes()).toBe(1))
    fireEvent.click(linha)   // recolhe
    fireEvent.click(linha)   // expande de novo
    expect(chamadasDeClipes()).toBe(1)
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd site/client && npx vitest run src/test/Competicoes.test.jsx -t leaderboard`
Expected: FAIL — a linha do leaderboard não é um botão.

- [ ] **Step 3: Implementar**

Substituir o componente `Leaderboard` de `site/client/src/pages/Competicoes.jsx`
por:

```jsx
function Leaderboard({ leaderboard, minimoParaRankear, competicaoId, clipeAberto, onAbrirClipe, viewerSteamId }) {
  const qualificados = leaderboard.filter((l) => l.qualificado)
  const naoQualificados = leaderboard.filter((l) => !l.qualificado)
  const [expandido, setExpandido] = useState(null)
  // Cache por steamId: recolher e expandir de novo não refaz a busca.
  const [clipesPorJogador, setClipesPorJogador] = useState({})

  function alternar(steamId) {
    if (expandido === steamId) {
      setExpandido(null)
      return
    }
    setExpandido(steamId)
    if (clipesPorJogador[steamId]) return
    // Busca só na primeira expansão — carregar os Clipes de todos só pra mostrar
    // o ranking seria desperdício.
    fetch(`/api/competicoes/${competicaoId}/jogador/${steamId}/clipes`)
      .then((res) => (res.ok ? res.json() : { clipes: [] }))
      .then((body) => setClipesPorJogador((atual) => ({ ...atual, [steamId]: body.clipes ?? [] })))
      .catch(() => setClipesPorJogador((atual) => ({ ...atual, [steamId]: [] })))
  }

  return (
    <div className="space-y-3">
      <div className="panel-cut border border-borda">
        {qualificados.map((l, i) => (
          <div key={l.steamId} className="border-b border-borda last:border-b-0">
            <button
              type="button"
              onClick={() => alternar(l.steamId)}
              aria-expanded={expandido === l.steamId}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-superficie-alta"
            >
              <span className="font-mono text-texto-fraco">{i + 1}º</span>
              {l.avatarUrl && <img src={l.avatarUrl} alt="" className="panel-cut-sm h-6 w-6 border border-borda object-cover" />}
              <span className="flex-1 font-mono text-texto">{l.nick}</span>
              <span className="font-display font-bold text-destaque tabular-nums">{l.total}</span>
            </button>

            {expandido === l.steamId && (
              <div className="px-3 pb-3">
                {clipesPorJogador[l.steamId] === undefined ? (
                  <p className="font-mono text-xs text-texto-fraco">Carregando…</p>
                ) : clipesPorJogador[l.steamId].length === 0 ? (
                  <p className="font-mono text-xs text-texto-fraco">Nenhum clipe pra mostrar.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {clipesPorJogador[l.steamId].map((c) => (
                      <CardClipeCompeticao
                        key={c.id}
                        clipe={c}
                        aberto={clipeAberto === c.id}
                        onAbrir={onAbrirClipe}
                        viewerSteamId={viewerSteamId}
                        location="leaderboardCompeticao"
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {naoQualificados.length > 0 && (
        <p className="font-mono text-xs text-texto-fraco">
          Ainda não qualificado (mínimo {minimoParaRankear} clipes): {naoQualificados.map((l) => l.nick).join(', ')}
        </p>
      )}
    </div>
  )
}
```

E a montagem dentro de `CardCompeticao` passa as props novas:

```jsx
          <Leaderboard
            leaderboard={comp.leaderboard}
            minimoParaRankear={comp.minimoParaRankear}
            competicaoId={comp.id}
            clipeAberto={clipeAberto}
            onAbrirClipe={setClipeAberto}
            viewerSteamId={viewerSteamId}
          />
```

- [ ] **Step 4: Rodar os testes e o build**

Run: `cd site/client && npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/client/src/pages/Competicoes.jsx site/client/src/test/Competicoes.test.jsx
git commit -m "feat: expandir um Jogador do leaderboard pra ver os clipes dele"
```

---

## Verificação final

- [ ] `cd site/server && npm test` — PASS
- [ ] `cd site/client && npm test && npm run build` — PASS
- [ ] Nenhuma migration nesta branch — nada a aplicar antes do merge
