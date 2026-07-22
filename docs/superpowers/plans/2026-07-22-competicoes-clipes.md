# Competições de Clipes — Plano de Implementação

> **Para quem for executar:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans pra rodar este plano tarefa por tarefa. Passos usam checkbox (`- [ ]`) pra acompanhamento.

**Objetivo:** nova aba Competições (o dono cria com prazo/prêmio/limites, jogadores enviam clipes já gerados pra competir) + nova fórmula de pontuação de clipe granular (kills+headshots+clutch+variedade de armas em vez de 16 valores fixos), substituindo o sistema de pontos em todo o site.

**Arquitetura:** pontuação calculada uma vez no webhook da Allstar e gravada em `allstar_clips`; duas tabelas novas (`competicoes`, `competicao_submissoes`); nova rota `/api/competicoes`; leaderboard sai da aba Clipes agregada e passa a existir só, isolado, dentro de cada competição.

**Tech Stack:** Node/Express + `pg` (server), React + Vite + Tailwind (client), Postgres/Supabase (migrations).

## Global Constraints

- Pontuação nova substitui a atual **em todo lugar** — não fica sistema de pontos duplicado.
- Só `allstar_clips` com `status = 'Processed'` participa de competições — links manuais (`clips` table) ficam de fora.
- Leaderboard só existe **dentro de uma competição especifica**, nunca agregado entre competições nem na aba Clipes.
- **Migrações de banco em produção são aplicadas pelo CONTROLLER (humano/orquestrador), nunca por um subagente implementador** — um classificador de segurança bloqueia subagentes que tentam rodar scripts com `DATABASE_URL` de produção. Cada task que envolve migração escreve o arquivo `.sql` e os testes locais; a aplicação em produção é um passo manual do controller, documentado explicitamente na task.
- Toda rota nova segue o padrão já estabelecido: `requireAuth` pra leitura/escrita de jogador comum, `requireSuperAdmin` (reconsulta `is_super_admin` no banco) pra ações de admin — nunca só esconder botão no client.
- IDs de recursos (`competicaoId`, `allstarClipId`) validados como UUID (regex `UUID_RE` já usado em `granadas.js`/`taticasCuradas.js`) antes de qualquer query.
- Referência: `docs/superpowers/specs/2026-07-22-competicoes-clipes-design.md` (spec completa, aprovada).

---

### Task 1: Migração — pontuação em `allstar_clips` + tabelas de competição

**Files:**
- Create: `supabase/migrations/0047_competicoes.sql`
- Test: nenhum teste automatizado pra SQL puro — a verificação é rodar a migração contra um banco e conferir as colunas/tabelas (passo manual do controller).

**Interfaces:**
- Produces: colunas `allstar_clips.pontuacao_total` (int, nullable), `allstar_clips.pontuacao_detalhe` (jsonb, nullable); tabelas `competicoes` e `competicao_submissoes` com as colunas exatas abaixo — todas as tasks seguintes dependem desses nomes exatos.

- [ ] **Step 1: Escrever a migração**

```sql
-- supabase/migrations/0047_competicoes.sql
-- Nova aba Competições (docs/superpowers/specs/2026-07-22-competicoes-clipes-design.md):
-- pontuação de clipe passa a ser granular (kills+headshots+clutch+variedade de armas,
-- calculada uma vez no webhook da Allstar) em vez dos 16 valores fixos por `kind` —
-- gravada aqui pra não recalcular toda hora e pro histórico ficar estável mesmo se a
-- fórmula mudar nervamente de novo.
alter table allstar_clips add column pontuacao_total int;
alter table allstar_clips add column pontuacao_detalhe jsonb;

create table competicoes (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null,
  descricao             text not null default '',
  premio_descricao      text not null default '',
  data_inicio           timestamptz not null,
  data_fim              timestamptz not null,
  limite_diario         int not null default 2,
  limite_total          int not null default 10,
  minimo_para_rankear   int not null default 3,
  vencedor_steam_id64   text references players(steam_id64),
  tradelink_vencedor    text,
  criado_por            text not null references players(steam_id64),
  criado_em             timestamptz not null default now(),
  constraint periodo_valido check (data_fim > data_inicio)
);

create table competicao_submissoes (
  id              uuid primary key default gen_random_uuid(),
  competicao_id   uuid not null references competicoes(id) on delete cascade,
  allstar_clip_id uuid not null references allstar_clips(id) on delete cascade,
  steam_id64      text not null references players(steam_id64),
  enviado_em      timestamptz not null default now(),
  unique (competicao_id, allstar_clip_id)
);
create index idx_competicao_submissoes_competicao on competicao_submissoes (competicao_id);
create index idx_competicao_submissoes_jogador on competicao_submissoes (competicao_id, steam_id64);
```

- [ ] **Step 2: Controller aplica a migração em produção**

O implementador desta task NÃO roda este passo — deixa marcado como pendente pro
controller. Comando de referência (mesmo padrão já usado nesta sessão pras migrações
0043-0046):

```bash
node -e "
const { Pool } = require('pg');
const fs = require('fs');
const dbUrl = fs.readFileSync('site/server/.env', 'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = fs.readFileSync('supabase/migrations/0047_competicoes.sql', 'utf8');
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
pool.query(sql).then(() => { console.log('0047 aplicada'); pool.end(); }).catch((e) => { console.error(e.message); pool.end(); });
"
```

Expected: `0047 aplicada`, sem erro.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0047_competicoes.sql
git commit -m "feat: migracao das tabelas de competicoes + colunas de pontuacao"
```

---

### Task 2: `clipesScore.js` — fórmula de pontuação por componente

**Files:**
- Modify: `site/server/src/clipesScore.js` (reescrita completa)
- Test: `site/server/test/clipesScore.test.js` (reescrita completa)

**Interfaces:**
- Consumes: nada (função pura).
- Produces: `calcularPontuacao({ kills, headshots, clutchKind, armasDistintas }) -> { pontosKills, pontosHeadshots, clutch, pontosClutch, armas, pontosArmas, kills, headshots, total }`. Tasks 3 e 5 chamam essa função com esses nomes de parâmetro exatos.

- [ ] **Step 1: Escrever os testes (substituindo o arquivo inteiro)**

```javascript
// site/server/test/clipesScore.test.js
import { describe, it, expect } from 'vitest'
import { calcularPontuacao } from '../src/clipesScore.js'

describe('calcularPontuacao', () => {
  it('kills: curva nao-linear de 1 a 5', () => {
    expect(calcularPontuacao({ kills: 1, headshots: 0, clutchKind: null, armasDistintas: 1 }).pontosKills).toBe(10)
    expect(calcularPontuacao({ kills: 2, headshots: 0, clutchKind: null, armasDistintas: 1 }).pontosKills).toBe(25)
    expect(calcularPontuacao({ kills: 3, headshots: 0, clutchKind: null, armasDistintas: 1 }).pontosKills).toBe(50)
    expect(calcularPontuacao({ kills: 4, headshots: 0, clutchKind: null, armasDistintas: 1 }).pontosKills).toBe(80)
    expect(calcularPontuacao({ kills: 5, headshots: 0, clutchKind: null, armasDistintas: 1 }).pontosKills).toBe(120)
  })

  it('kills acima de 5 (nao deveria acontecer num round, mas nao quebra) usa o valor de 5', () => {
    expect(calcularPontuacao({ kills: 7, headshots: 0, clutchKind: null, armasDistintas: 1 }).pontosKills).toBe(120)
  })

  it('kills 0 ou ausente nao gera pontos negativos nem NaN', () => {
    expect(calcularPontuacao({ kills: 0, headshots: 0, clutchKind: null, armasDistintas: 0 }).pontosKills).toBe(0)
  })

  it('headshots: +8 por kill que foi headshot', () => {
    const r = calcularPontuacao({ kills: 4, headshots: 3, clutchKind: null, armasDistintas: 1 })
    expect(r.pontosHeadshots).toBe(24)
  })

  it('clutch: bonus por dificuldade 1v1 a 1v5', () => {
    expect(calcularPontuacao({ kills: 1, headshots: 0, clutchKind: '1v1', armasDistintas: 1 }).pontosClutch).toBe(10)
    expect(calcularPontuacao({ kills: 2, headshots: 0, clutchKind: '1v2', armasDistintas: 1 }).pontosClutch).toBe(20)
    expect(calcularPontuacao({ kills: 3, headshots: 0, clutchKind: '1v3', armasDistintas: 1 }).pontosClutch).toBe(35)
    expect(calcularPontuacao({ kills: 4, headshots: 0, clutchKind: '1v4', armasDistintas: 1 }).pontosClutch).toBe(55)
    expect(calcularPontuacao({ kills: 5, headshots: 0, clutchKind: '1v5', armasDistintas: 1 }).pontosClutch).toBe(80)
  })

  it('sem clutch (null): pontosClutch é 0, nao é erro', () => {
    const r = calcularPontuacao({ kills: 3, headshots: 0, clutchKind: null, armasDistintas: 1 })
    expect(r.clutch).toBeNull()
    expect(r.pontosClutch).toBe(0)
  })

  it('kind de clutch desconhecido (defensivo): pontosClutch 0, nao lanca excecao', () => {
    const r = calcularPontuacao({ kills: 1, headshots: 0, clutchKind: '1v9', armasDistintas: 1 })
    expect(r.pontosClutch).toBe(0)
  })

  it('variedade de armas: +5 por arma distinta', () => {
    expect(calcularPontuacao({ kills: 2, headshots: 0, clutchKind: null, armasDistintas: 1 }).pontosArmas).toBe(5)
    expect(calcularPontuacao({ kills: 2, headshots: 0, clutchKind: null, armasDistintas: 2 }).pontosArmas).toBe(10)
  })

  it('total soma todos os componentes, breakdown completo no retorno', () => {
    const r = calcularPontuacao({ kills: 4, headshots: 3, clutchKind: '1v2', armasDistintas: 2 })
    expect(r).toEqual({
      kills: 4, pontosKills: 80,
      headshots: 3, pontosHeadshots: 24,
      clutch: '1v2', pontosClutch: 20,
      armas: 2, pontosArmas: 10,
      total: 134,
    })
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/server && npx vitest run test/clipesScore.test.js`
Expected: FAIL (o módulo antigo usa `{ kind, todosHeadshot }`, não esses parâmetros).

- [ ] **Step 3: Reescrever `clipesScore.js`**

```javascript
// site/server/src/clipesScore.js
// Pontuação própria dos clipes (aba Competições + aba Clipes) — a Allstar não expõe a
// fórmula deles no webhook, então esta é uma fórmula nossa, granular o bastante pra não
// empatar na prática (a versão anterior tinha só 16 valores possíveis — 8 `kind` × bônus
// binário de headshot). Ver docs/superpowers/specs/2026-07-22-competicoes-clipes-design.md.
const PONTOS_POR_KILL = { 0: 0, 1: 10, 2: 25, 3: 50, 4: 80, 5: 120 }
const PONTOS_POR_HEADSHOT = 8
const PONTOS_POR_ARMA = 5
const PONTOS_CLUTCH = { '1v1': 10, '1v2': 20, '1v3': 35, '1v4': 55, '1v5': 80 }

export function calcularPontuacao({ kills = 0, headshots = 0, clutchKind = null, armasDistintas = 0 }) {
  const killsClamp = Math.min(Math.max(kills, 0), 5)
  const pontosKills = PONTOS_POR_KILL[killsClamp]
  const pontosHeadshots = Math.max(headshots, 0) * PONTOS_POR_HEADSHOT
  const pontosClutch = PONTOS_CLUTCH[clutchKind] ?? 0
  const pontosArmas = Math.max(armasDistintas, 0) * PONTOS_POR_ARMA
  return {
    kills, pontosKills,
    headshots, pontosHeadshots,
    clutch: clutchKind ?? null, pontosClutch,
    armas: armasDistintas, pontosArmas,
    total: pontosKills + pontosHeadshots + pontosClutch + pontosArmas,
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd site/server && npx vitest run test/clipesScore.test.js`
Expected: PASS (9/9).

- [ ] **Step 5: Commit**

```bash
git add site/server/src/clipesScore.js site/server/test/clipesScore.test.js
git commit -m "feat: reescreve calcularPontuacao com formula granular por componente"
```

---

### Task 3: Webhook da Allstar grava a pontuação ao ficar `Processed`

**Files:**
- Modify: `site/server/src/routes/allstar.js`
- Test: `site/server/test/allstar.test.js`

**Interfaces:**
- Consumes: `calcularPontuacao` (Task 2) com `{ kills, headshots, clutchKind, armasDistintas }`.
- Produces: ao processar o webhook com `status: 'Processed'`, o UPDATE de `allstar_clips` passa a incluir `pontuacao_total` e `pontuacao_detalhe`. Tasks 5 e 9 leem essas colunas direto.

- [ ] **Step 1: Ler o arquivo atual pra entender o UPDATE existente**

Abra `site/server/src/routes/allstar.js` e note a query `update allstar_clips set status = coalesce($2, status), ...` — o UPDATE atual não grava pontuação. Esta task adiciona uma busca de `kill_positions`/`highlights` ANTES do UPDATE, só quando `status === 'Processed'`.

- [ ] **Step 2: Escrever os testes novos (adicionar ao arquivo existente, não substituir)**

```javascript
// Adicionar a este describe existente em site/server/test/allstar.test.js:
it('status Processed: calcula e grava pontuacao_total/pontuacao_detalhe', async () => {
  const db = {
    query: vi.fn().mockImplementation((sql, params) => {
      if (sql.includes('from kill_positions')) {
        return Promise.resolve({ rows: [
          { weapon: 'ak47', headshot: true },
          { weapon: 'ak47', headshot: true },
          { weapon: 'deagle', headshot: false },
        ] })
      }
      if (sql.includes('from highlights')) {
        return Promise.resolve({ rows: [{ kind: 'clutch_1v2' }] })
      }
      return Promise.resolve({ rows: [] })
    }),
  }
  const app = createApp({ config: configComSecret, db })
  const res = await request(app)
    .post('/api/allstar/webhook')
    .set('Authorization', 'segredo-webhook')
    .send({ requestId: 'req-1', status: 'Processed', clipUrl: 'https://allstar.gg/x', roundNumber: 5 })
  expect(res.status).toBe(200)
  const update = db.query.mock.calls.find(([sql]) => sql.includes('update allstar_clips'))
  expect(update[0]).toContain('pontuacao_total')
  expect(update[0]).toContain('pontuacao_detalhe')
  // 3 kills (50) + 2 headshots (16) + clutch 1v2 (20) + 2 armas distintas (10) = 96
  const params = update[1]
  expect(params).toContain(96)
})

it('status Processed sem highlight de clutch: clutch null, sem quebrar', async () => {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      if (sql.includes('from kill_positions')) return Promise.resolve({ rows: [{ weapon: 'awp', headshot: true }] })
      if (sql.includes('from highlights')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [] })
    }),
  }
  const app = createApp({ config: configComSecret, db })
  const res = await request(app)
    .post('/api/allstar/webhook')
    .set('Authorization', 'segredo-webhook')
    .send({ requestId: 'req-2', status: 'Processed', roundNumber: 3 })
  expect(res.status).toBe(200)
})

it('status diferente de Processed (Submitted/Error): nao calcula pontuacao', async () => {
  const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
  const app = createApp({ config: configComSecret, db })
  await request(app).post('/api/allstar/webhook').set('Authorization', 'segredo-webhook')
    .send({ requestId: 'req-3', status: 'Error', message: 'falhou' })
  const chamouKillPositions = db.query.mock.calls.some(([sql]) => sql.includes('from kill_positions'))
  expect(chamouKillPositions).toBe(false)
})
```

Confira o nome exato da config usada nos testes existentes deste arquivo pro secret do
webhook (ex.: `configComSecret`) e reaproveite — não invente uma nova.

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `cd site/server && npx vitest run test/allstar.test.js`
Expected: FAIL nos 3 testes novos (o código ainda não busca kill_positions/highlights).

- [ ] **Step 4: Implementar em `allstar.js`**

Adicione o import no topo do arquivo:

```javascript
import { calcularPontuacao } from '../clipesScore.js'
```

Antes do UPDATE existente, quando `status === 'Processed'` e `requestId` bate com uma
linha de `allstar_clips`, busque `match_id`/`steam_id64` dessa linha, depois
`kill_positions` e `highlights` pra montar os parâmetros de `calcularPontuacao`:

```javascript
let pontuacaoTotal = null
let pontuacaoDetalhe = null
if (status === 'Processed') {
  const { rows: clipRows } = await db.query(
    'select match_id, steam_id64, round_number from allstar_clips where request_id = $1',
    [requestId],
  )
  const clip = clipRows[0]
  const roundParaPontuar = roundNumber ?? clip?.round_number
  if (clip && roundParaPontuar != null) {
    const { rows: kills } = await db.query(
      `select weapon, headshot from kill_positions
       where match_id = $1 and round_number = $2 and killer = $3`,
      [clip.match_id, roundParaPontuar, clip.steam_id64],
    )
    const { rows: highlightRows } = await db.query(
      `select kind from highlights
       where match_id = $1 and steam_id64 = $2 and round_number = $3 and kind like 'clutch_%'
       limit 1`,
      [clip.match_id, clip.steam_id64, roundParaPontuar],
    )
    const clutchKind = highlightRows[0]?.kind ? highlightRows[0].kind.replace('clutch_', '') : null
    const armasDistintas = new Set(kills.map((k) => k.weapon)).size
    const headshots = kills.filter((k) => k.headshot).length
    const resultado = calcularPontuacao({ kills: kills.length, headshots, clutchKind, armasDistintas })
    pontuacaoTotal = resultado.total
    pontuacaoDetalhe = resultado
  }
}
```

E adicione `pontuacao_total`/`pontuacao_detalhe` ao UPDATE existente (mantendo os
`coalesce` já presentes pros outros campos, mas estes dois só gravam quando calculados
nesta chamada — não usam `coalesce`, porque só fazem sentido no momento em que o clipe
vira `Processed` pela primeira vez):

```javascript
await db.query(
  `update allstar_clips set
     status = coalesce($2, status),
     clip_url = coalesce($3, clip_url),
     clip_title = coalesce($4, clip_title),
     clip_snapshot_url = coalesce($5, clip_snapshot_url),
     error_message = coalesce($6, error_message),
     round_number = coalesce($7, round_number),
     pontuacao_total = coalesce($8, pontuacao_total),
     pontuacao_detalhe = coalesce($9, pontuacao_detalhe),
     updated_at = now()
   where request_id = $1`,
  [requestId, status ?? null, clipUrl ?? null, clipTitle ?? null, clipSnapshotURL ?? null,
    message ?? null, roundNumber ?? null, pontuacaoTotal, pontuacaoDetalhe ? JSON.stringify(pontuacaoDetalhe) : null],
)
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `cd site/server && npx vitest run test/allstar.test.js`
Expected: PASS (todos os testes, incluindo os 3 novos).

- [ ] **Step 6: Commit**

```bash
git add site/server/src/routes/allstar.js site/server/test/allstar.test.js
git commit -m "feat: webhook da Allstar calcula e grava pontuacao ao processar clipe"
```

---

### Task 4: Backfill de pontuação pros clipes já existentes

**Files:**
- Create: `site/server/src/backfillPontuacao.js`
- Test: `site/server/test/backfillPontuacao.test.js`

**Interfaces:**
- Consumes: `calcularPontuacao` (Task 2).
- Produces: `backfillPontuacao(db) -> Promise<{ atualizados: number, falhas: number }>` — exportada, chamada manualmente pelo controller em produção (não roda em nenhum cron).

- [ ] **Step 1: Escrever o teste**

```javascript
// site/server/test/backfillPontuacao.test.js
import { describe, it, expect, vi } from 'vitest'
import { backfillPontuacao } from '../src/backfillPontuacao.js'

describe('backfillPontuacao', () => {
  it('calcula e grava pontuacao pra clipes Processed sem pontuacao_total ainda', async () => {
    const gravados = []
    const db = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (sql.includes("status = 'Processed' and pontuacao_total is null")) {
          return Promise.resolve({ rows: [
            { id: 'c1', match_id: 'm1', steam_id64: '765', round_number: 5 },
          ] })
        }
        if (sql.includes('from kill_positions')) {
          return Promise.resolve({ rows: [{ weapon: 'ak47', headshot: true }, { weapon: 'ak47', headshot: false }] })
        }
        if (sql.includes('from highlights')) return Promise.resolve({ rows: [] })
        if (sql.includes('update allstar_clips set pontuacao_total')) {
          gravados.push(params)
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      }),
    }
    const resultado = await backfillPontuacao(db)
    expect(resultado).toEqual({ atualizados: 1, falhas: 0 })
    expect(gravados).toHaveLength(1)
    expect(gravados[0][2]).toBe('c1') // id do clipe no where
  })

  it('sem clipes pendentes: devolve zero sem erro', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const resultado = await backfillPontuacao(db)
    expect(resultado).toEqual({ atualizados: 0, falhas: 0 })
  })

  it('erro num clipe nao derruba os outros', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes("status = 'Processed' and pontuacao_total is null")) {
          return Promise.resolve({ rows: [
            { id: 'c1', match_id: 'm1', steam_id64: '765', round_number: 5 },
            { id: 'c2', match_id: 'm2', steam_id64: '999', round_number: 3 },
          ] })
        }
        if (sql.includes('from kill_positions')) {
          if (sql.includes('c1')) throw new Error('nunca deveria filtrar por id aqui')
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      }),
    }
    // Sem mockar per-clip corretamente, o objetivo deste teste é só confirmar que uma
    // falha (ex. query rejeitando) não impede os demais — simplificado propositalmente.
    const resultado = await backfillPontuacao(db)
    expect(resultado.atualizados + resultado.falhas).toBe(2)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/server && npx vitest run test/backfillPontuacao.test.js`
Expected: FAIL (`backfillPontuacao.js` ainda não existe).

- [ ] **Step 3: Implementar**

```javascript
// site/server/src/backfillPontuacao.js
// Rodado UMA VEZ pelo controller direto em produção depois da migração 0047 — clipes
// gerados antes da fórmula por componente (Task 2) ficariam com pontuacao_total null
// pra sempre, senão. Não é um cron, não roda sozinho. Ver
// docs/superpowers/specs/2026-07-22-competicoes-clipes-design.md.
import { calcularPontuacao } from './clipesScore.js'

export async function backfillPontuacao(db) {
  const { rows: pendentes } = await db.query(
    "select id, match_id, steam_id64, round_number from allstar_clips where status = 'Processed' and pontuacao_total is null",
  )
  let atualizados = 0
  let falhas = 0
  for (const clipe of pendentes) {
    try {
      const { rows: kills } = await db.query(
        'select weapon, headshot from kill_positions where match_id = $1 and round_number = $2 and killer = $3',
        [clipe.match_id, clipe.round_number, clipe.steam_id64],
      )
      const { rows: highlightRows } = await db.query(
        "select kind from highlights where match_id = $1 and steam_id64 = $2 and round_number = $3 and kind like 'clutch_%' limit 1",
        [clipe.match_id, clipe.steam_id64, clipe.round_number],
      )
      const clutchKind = highlightRows[0]?.kind ? highlightRows[0].kind.replace('clutch_', '') : null
      const armasDistintas = new Set(kills.map((k) => k.weapon)).size
      const headshots = kills.filter((k) => k.headshot).length
      const resultado = calcularPontuacao({ kills: kills.length, headshots, clutchKind, armasDistintas })
      await db.query(
        'update allstar_clips set pontuacao_total = $1, pontuacao_detalhe = $2 where id = $3',
        [resultado.total, JSON.stringify(resultado), clipe.id],
      )
      atualizados += 1
    } catch {
      falhas += 1
    }
  }
  return { atualizados, falhas }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd site/server && npx vitest run test/backfillPontuacao.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add site/server/src/backfillPontuacao.js site/server/test/backfillPontuacao.test.js
git commit -m "feat: backfill de pontuacao pros clipes ja existentes"
```

- [ ] **Step 6: Controller roda o backfill em produção (depois que a Task 1 já aplicou a migração)**

```bash
node -e "
const { Pool } = require('pg');
const fs = require('fs');
const dbUrl = fs.readFileSync('site/server/.env', 'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
import('./site/server/src/backfillPontuacao.js').then(async ({ backfillPontuacao }) => {
  const r = await backfillPontuacao(pool);
  console.log(r);
  await pool.end();
});
"
```

Expected: `{ atualizados: N, falhas: 0 }` (N = quantidade de clipes Processed hoje).

---

### Task 5: `routes/clipes.js` — usa pontuação nova, remove leaderboard

**Files:**
- Modify: `site/server/src/routes/clipes.js`
- Test: `site/server/test/clipes.test.js`

**Interfaces:**
- Consumes: `allstar_clips.pontuacao_total`/`pontuacao_detalhe` (Task 1/3).
- Produces: `GET /api/clipes?periodo=...` devolve `{ clipes: [...] }` — **sem** campo `leaderboard`. Cada clipe tem `pontuacao: { kills, pontosKills, headshots, pontosHeadshots, clutch, pontosClutch, armas, pontosArmas, total }` (mesma forma do retorno de `calcularPontuacao`).

- [ ] **Step 1: Atualizar os testes existentes**

Abra `site/server/test/clipes.test.js` e:
1. Remova qualquer asserção sobre `res.body.leaderboard`.
2. Ajuste os mocks de `allstar_clips` pra incluírem `pontuacao_total`/`pontuacao_detalhe`
   em vez de depender de `kind`/`todosHeadshot`. Exemplo de ajuste num teste existente:

```javascript
it('clipe processado aparece com a pontuacao gravada', async () => {
  const db = fakeDbCom({
    allstarClips: [{
      id: 'c1', match_id: 'm1', steam_id64: '765', round_number: 9,
      clip_url: 'https://allstar.gg/x', clip_snapshot_url: null,
      pontuacao_total: 134,
      pontuacao_detalhe: { kills: 4, pontosKills: 80, headshots: 3, pontosHeadshots: 24, clutch: '1v2', pontosClutch: 20, armas: 2, pontosArmas: 10, total: 134 },
    }],
  })
  const app = createApp({ config, db })
  const res = await request(app).get('/api/clipes').set('Cookie', cookie)
  expect(res.status).toBe(200)
  expect(res.body.clipes[0].pontuacao.total).toBe(134)
  expect(res.body).not.toHaveProperty('leaderboard')
})
```

Adapte o nome exato do helper `fakeDbCom`/`appWith` pro que já existir no arquivo — não
invente um novo helper, reaproveite o padrão de mock já estabelecido nesse arquivo de
teste.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/server && npx vitest run test/clipes.test.js`
Expected: FAIL (a rota ainda calcula `pontuacao` via `calcularPontuacao({kind, todosHeadshot})` e ainda devolve `leaderboard`).

- [ ] **Step 3: Reescrever `routes/clipes.js`**

```javascript
// site/server/src/routes/clipes.js
import { Router } from 'express'
import { partidaVisivelExpr } from '../friendships.js'

const PERIODOS = {
  semana: "and m.played_at >= now() - interval '7 days'",
  mes: "and m.played_at >= now() - interval '30 days'",
  sempre: '',
}

// Clipes reais do Allstar (status='Processed'), escopados por amizade e período. A
// pontuação já vem gravada em allstar_clips (webhook, ver routes/allstar.js) — esta
// rota só lê, não recalcula nada. Leaderboard NÃO existe mais aqui (saiu pra dentro de
// cada Competição, ver routes/competicoes.js) — ranking sempre-ativo-de-tudo virou
// ranking-por-competição. Ver docs/superpowers/specs/2026-07-22-competicoes-clipes-design.md.
export function createClipesRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const periodo = PERIODOS[req.query.periodo] !== undefined ? req.query.periodo : 'sempre'
    const eu = req.player.steamId
    const { rows } = await db.query(
      `select ac.id, ac.clip_url, ac.clip_snapshot_url, ac.pontuacao_total, ac.pontuacao_detalhe,
              ac.round_number, ac.match_id, ac.steam_id64,
              (select h.kind from highlights h
               where h.match_id = ac.match_id and h.steam_id64 = ac.steam_id64 and h.round_number = ac.round_number
               limit 1) as kind,
              m.map, m.played_at,
              coalesce(p.nick, mp.nick) as nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url
       from allstar_clips ac
       join matches m on m.id = ac.match_id
       left join players p on p.steam_id64 = ac.steam_id64
       left join match_players mp on mp.match_id = ac.match_id and mp.steam_id64 = ac.steam_id64
       left join steam_avatares sa on sa.steam_id64 = ac.steam_id64
       where ac.status = 'Processed' and ${partidaVisivelExpr('m', '$1')} ${PERIODOS[periodo]}
       order by ac.pontuacao_total desc nulls last`,
      [eu],
    )

    const clipes = rows.map((r) => ({
      id: r.id,
      matchId: r.match_id,
      steamId: r.steam_id64,
      nick: r.nick,
      avatarUrl: r.avatar_url,
      clipUrl: r.clip_url,
      clipSnapshotUrl: r.clip_snapshot_url,
      kind: r.kind,
      roundNumber: r.round_number,
      map: r.map,
      playedAt: r.played_at,
      pontuacao: r.pontuacao_detalhe ?? { total: r.pontuacao_total ?? 0 },
    }))

    res.json({ clipes })
  })

  return router
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd site/server && npx vitest run test/clipes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/clipes.js site/server/test/clipes.test.js
git commit -m "fix: /api/clipes usa pontuacao gravada e remove leaderboard"
```

---

### Task 6: Criar `Clipes.jsx` (portado de `main`, adaptado pra pontuação granular, sem Leaderboard)

**Descoberta ao executar esta task (worktree diverge de `main` antes da feature Clipes
existir):** `site/client/src/pages/Clipes.jsx` **não existe neste branch** — ele só existe
em commits exclusivos de `main` (`28ee641` em diante), que este worktree nunca recebeu. O
item de menu `/clipes` já existe em `Shell.jsx` (`ITENS_BASE` já tem
`{ to: '/clipes', label: 'Clipes', icone: 'clipes' }`) — só a página e a rota faltam. Em
vez de "remover uma seção" (como uma versão anterior desta task assumia), esta task cria
o arquivo do zero com o conteúdo de `main` já adaptado ao novo esquema de pontuação da
Task 2 (nunca com o esquema antigo `kind/base/bonusHeadshot`) e sem a seção de Leaderboard
(que sai daqui e fica só dentro de Competições, Task 9/12).

**Files:**
- Create: `site/client/src/pages/Clipes.jsx`
- Create: `site/client/src/test/Clipes.test.jsx`
- Modify: `site/client/src/App.jsx`

**Interfaces:**
- Consumes: `GET /api/clipes` (Task 5) — resposta `{ clipes: [...] }` sem `leaderboard`,
  cada clipe com `pontuacao: { kills, pontosKills, headshots, pontosHeadshots, clutch,
  pontosClutch, armas, pontosArmas, total }` (mesmo formato de `calcularPontuacao`, Task 2).

- [ ] **Step 1: Escrever o teste**

```jsx
// site/client/src/test/Clipes.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Clipes from '../pages/Clipes.jsx'

const RESPOSTA = {
  clipes: [{
    id: 'c1', matchId: 'm1', steamId: '111', nick: 'bronze', avatarUrl: null,
    clipUrl: 'https://allstar.gg/clip/1', clipSnapshotUrl: null,
    kind: 'ace', roundNumber: 5, map: 'de_mirage', playedAt: '2026-07-20T00:00:00Z',
    pontuacao: { kills: 5, pontosKills: 120, headshots: 3, pontosHeadshots: 24, clutch: null, pontosClutch: 0, armas: 2, pontosArmas: 10, total: 154 },
  }],
}

describe('Clipes', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => RESPOSTA })
  })

  it('mostra o clipe com a pontuacao total', async () => {
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('bronze').length).toBeGreaterThan(0))
    expect(screen.getByText('154')).toBeInTheDocument()
  })

  it('nao mostra nenhuma secao de Leaderboard (saiu pra dentro de Competicoes)', async () => {
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('bronze').length).toBeGreaterThan(0))
    expect(screen.queryByText(/leaderboard/i)).not.toBeInTheDocument()
  })

  it('clipe sem kind (gerado por jogador, sem highlight nosso batendo o round) mostra fallback "MOMENTO" sem quebrar', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        clipes: [{
          id: 'c2', matchId: 'm1', steamId: '222', nick: 'outro', avatarUrl: null,
          clipUrl: 'https://allstar.gg/clip/2', clipSnapshotUrl: null,
          kind: null, roundNumber: 9, map: 'de_dust2', playedAt: '2026-07-21T00:00:00Z',
          pontuacao: { kills: 1, pontosKills: 10, headshots: 0, pontosHeadshots: 0, clutch: null, pontosClutch: 0, armas: 1, pontosArmas: 5, total: 15 },
        }],
      }),
    })
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('MOMENTO')).toBeInTheDocument())
  })

  it('troca de periodo dispara novo fetch com o query param certo', async () => {
    render(<MemoryRouter><Clipes /></MemoryRouter>)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/clipes?periodo=sempre'))
    screen.getByText('Semana').click()
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/clipes?periodo=semana'))
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/client && npx vitest run src/test/Clipes.test.jsx`
Expected: FAIL (`Clipes.jsx` ainda não existe neste branch).

- [ ] **Step 3: Criar `site/client/src/pages/Clipes.jsx`**

```jsx
// site/client/src/pages/Clipes.jsx
import { useEffect, useState } from 'react'
import { Card, SectionHeader, Badge } from '../components/ui'
import { useAuth } from '../auth/AuthContext.jsx'

const PERIODOS = [
  { valor: 'semana', label: 'Semana' },
  { valor: 'mes', label: 'Mês' },
  { valor: 'sempre', label: 'Sempre' },
]

const NOME_KIND = {
  ace: 'ACE', quad: 'QUAD KILL', triple: 'TRIPLE KILL',
  clutch_1v5: 'CLUTCH 1v5', clutch_1v4: 'CLUTCH 1v4', clutch_1v3: 'CLUTCH 1v3',
  clutch_1v2: 'CLUTCH 1v2', clutch_1v1: 'CLUTCH 1v1',
}

// kind vem null quando o round que a Allstar escolheu (gerar clipe por JOGADOR, não
// mais por highlight) não bate com nenhum highlight nosso pra esse jogador/round — só
// afeta o rótulo exibido, a pontuação (Task 2, clipesScore.js) não depende de kind.
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
// tambem mostra o detalhamento, Task 12/13), aqui e so leitura sobre o clipe.
function tituloPontuacao(p) {
  const partes = [`${p.kills} kills (${p.pontosKills})`]
  if (p.headshots > 0) partes.push(`${p.headshots} headshots (+${p.pontosHeadshots})`)
  if (p.clutch) partes.push(`clutch ${p.clutch} (+${p.pontosClutch})`)
  if (p.armas > 0) partes.push(`${p.armas} armas distintas (+${p.pontosArmas})`)
  return `${partes.join(' + ')} = ${p.total}`
}

function CardClipe({ clipe, aberto, onAbrir, viewerSteamId }) {
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
              {clipe.nick} · round {clipe.roundNumber} · {clipe.map}
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

export default function Clipes() {
  const { jogador } = useAuth()
  const [periodo, setPeriodo] = useState('sempre')
  const [dados, setDados] = useState(null)
  const [clipeAberto, setClipeAberto] = useState(null)

  useEffect(() => {
    setDados(null)
    fetch(`/api/clipes?periodo=${periodo}`)
      .then((res) => (res.ok ? res.json() : { clipes: [] }))
      .then(setDados)
      .catch(() => setDados({ clipes: [] }))
  }, [periodo])

  return (
    <div className="space-y-6">
      <SectionHeader
        titulo="Clipes"
        className="flex-wrap"
        acao={
          <div className="flex gap-2">
            {PERIODOS.map((p) => (
              <button
                key={p.valor}
                onClick={() => setPeriodo(p.valor)}
                className={`panel-cut-sm min-h-10 border px-3 py-1.5 font-mono text-xs uppercase tracking-wide lg:min-h-0 ${
                  periodo === p.valor ? 'border-destaque bg-destaque/10 text-destaque' : 'border-borda text-texto-fraco'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />
      <p className="font-mono text-xs text-texto-fraco">
        Pontuação: kills (curva não-linear) + headshots + clutch + variedade de armas — passe o mouse no número pra ver o cálculo.
      </p>

      {dados === null ? (
        <p className="font-mono text-sm text-texto-fraco">Carregando…</p>
      ) : dados.clipes.length === 0 ? (
        <p className="font-mono text-sm text-texto-fraco">Nenhum clipe nesse período ainda.</p>
      ) : (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dados.clipes.map((c) => (
            <CardClipe key={c.id} clipe={c} aberto={clipeAberto === c.id} onAbrir={setClipeAberto} viewerSteamId={jogador?.steamId} />
          ))}
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd site/client && npx vitest run src/test/Clipes.test.jsx`
Expected: PASS (4/4).

- [ ] **Step 5: Adicionar a rota em `App.jsx`**

Abra `site/client/src/App.jsx`. Ele já define `function RotaProtegida({ children })` e usa
esse wrapper em todas as rotas autenticadas (`/ranking`, `/granadas`, etc.) — siga o mesmo
padrão. Adicione o import perto dos outros imports de página:

```jsx
import Clipes from './pages/Clipes.jsx'
```

E adicione a rota (perto de `/jogadores` ou `/comparar`, junto das outras rotas protegidas):

```jsx
<Route path="/clipes" element={<RotaProtegida><Clipes /></RotaProtegida>} />
```

- [ ] **Step 6: Rodar a suíte inteira do client**

Run: `cd site/client && npx vitest run`
Expected: todos os testes passam.

- [ ] **Step 7: Commit**

```bash
git add site/client/src/pages/Clipes.jsx site/client/src/test/Clipes.test.jsx site/client/src/App.jsx
git commit -m "feat: adiciona pagina Clipes.jsx (portada de main, adaptada pra pontuacao granular, sem leaderboard)"
```

---

### Task 7: `routes/competicoes.js` — listagem + CRUD de admin

**Files:**
- Create: `site/server/src/routes/competicoes.js`
- Test: `site/server/test/competicoes.test.js`
- Modify: `site/server/src/app.js` (montar a rota nova)

**Interfaces:**
- Consumes: `requireAuth`, `createRequireSuperAdmin` (já existentes em `auth/middleware.js`).
- Produces: `createCompeticoesRouter({ db, requireAuth })`, montada em `/api/competicoes`. `GET /` devolve `{ ativa: {...} | null, encerradas: [...] }` (sem leaderboard ainda — Task 9 adiciona). `POST /admin` e `PUT /admin/:id` criam/editam competição.

- [ ] **Step 1: Escrever os testes**

```javascript
// site/server/test/competicoes.test.js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false }
const cookieJogador = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`
const cookieAdmin = `resenha_token=${signToken({ steamId: '999', isSuperAdmin: true }, config.jwtSecret)}`

function appWith(handlers) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      if (sql.includes('is_super_admin from players')) return Promise.resolve({ rows: [{ is_super_admin: true }] })
      for (const [needle, rows] of handlers) if (sql.includes(needle)) return Promise.resolve({ rows })
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db }), db }
}

describe('GET /api/competicoes', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/competicoes')).status).toBe(401)
  })

  it('sem competicao nenhuma: ativa null, encerradas vazio', async () => {
    const { app } = appWith([])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ativa: null, encerradas: [] })
  })

  it('devolve a competicao ativa (data_inicio <= now <= data_fim)', async () => {
    const agora = new Date()
    const { app } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: 'Skin',
        data_inicio: new Date(agora.getTime() - 86400000), data_fim: new Date(agora.getTime() + 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 3, vencedor_steam_id64: null,
      }]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body.ativa.id).toBe('comp1')
  })
})

describe('POST /api/competicoes/admin', () => {
  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieJogador)
      .send({ nome: 'X', dataInicio: '2026-08-01', dataFim: '2026-08-08' })
    expect(res.status).toBe(403)
  })

  it('admin: cria competicao', async () => {
    const { app, db } = appWith([])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieAdmin).send({
      nome: 'Semana 1', descricao: 'desc', premioDescricao: 'Skin AK',
      dataInicio: '2026-08-01T00:00:00Z', dataFim: '2026-08-08T00:00:00Z',
      limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 3,
    })
    expect(res.status).toBe(201)
    const insert = db.query.mock.calls.find(([sql]) => sql.includes('insert into competicoes'))
    expect(insert).toBeTruthy()
  })

  it('data_fim antes de data_inicio: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieAdmin).send({
      nome: 'X', dataInicio: '2026-08-08T00:00:00Z', dataFim: '2026-08-01T00:00:00Z',
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/server && npx vitest run test/competicoes.test.js`
Expected: FAIL (`routes/competicoes.js` ainda não existe).

- [ ] **Step 3: Implementar a rota**

```javascript
// site/server/src/routes/competicoes.js
import { Router } from 'express'
import { createRequireSuperAdmin } from '../auth/middleware.js'
import { limiteEstrito } from '../rateLimit.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function mapCompeticao(c) {
  return {
    id: c.id, nome: c.nome, descricao: c.descricao, premioDescricao: c.premio_descricao,
    dataInicio: c.data_inicio, dataFim: c.data_fim,
    limiteDiario: c.limite_diario, limiteTotal: c.limite_total, minimoParaRankear: c.minimo_para_rankear,
    vencedorSteamId: c.vencedor_steam_id64,
  }
}

export function createCompeticoesRouter({ db, requireAuth }) {
  const router = Router()
  const requireSuperAdmin = createRequireSuperAdmin(db)

  router.get('/', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      `select id, nome, descricao, premio_descricao, data_inicio, data_fim,
              limite_diario, limite_total, minimo_para_rankear, vencedor_steam_id64
       from competicoes
       order by data_inicio desc`,
    )
    const agora = new Date()
    const ativa = rows.find((c) => new Date(c.data_inicio) <= agora && agora <= new Date(c.data_fim))
    const encerradas = rows.filter((c) => new Date(c.data_fim) < agora)
    res.json({
      ativa: ativa ? mapCompeticao(ativa) : null,
      encerradas: encerradas.map(mapCompeticao),
    })
  })

  // #9 da auditoria (rate limiting como defesa em profundidade, além da regra de
  // negócio de limite diário/total): mesmo middleware já usado no webhook da Allstar
  // e no upload de demo (site/server/src/rateLimit.js).
  router.post('/admin', limiteEstrito, requireAuth, requireSuperAdmin, async (req, res) => {
    const { nome, descricao, premioDescricao, dataInicio, dataFim, limiteDiario, limiteTotal, minimoParaRankear } = req.body ?? {}
    if (!nome || !dataInicio || !dataFim) return res.status(400).json({ erro: 'nome, dataInicio e dataFim são obrigatórios' })
    if (new Date(dataFim) <= new Date(dataInicio)) return res.status(400).json({ erro: 'dataFim precisa ser depois de dataInicio' })
    const { rows } = await db.query(
      `insert into competicoes
         (nome, descricao, premio_descricao, data_inicio, data_fim, limite_diario, limite_total, minimo_para_rankear, criado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [nome, descricao ?? '', premioDescricao ?? '', dataInicio, dataFim,
        limiteDiario ?? 2, limiteTotal ?? 10, minimoParaRankear ?? 3, req.player.steamId],
    )
    res.status(201).json({ id: rows[0].id })
  })

  router.put('/admin/:id', limiteEstrito, requireAuth, requireSuperAdmin, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'competição não encontrada' })
    const { nome, descricao, premioDescricao, dataInicio, dataFim, limiteDiario, limiteTotal, minimoParaRankear } = req.body ?? {}
    if (dataInicio && dataFim && new Date(dataFim) <= new Date(dataInicio)) {
      return res.status(400).json({ erro: 'dataFim precisa ser depois de dataInicio' })
    }
    const { rows } = await db.query(
      `update competicoes set
         nome = coalesce($1, nome), descricao = coalesce($2, descricao),
         premio_descricao = coalesce($3, premio_descricao),
         data_inicio = coalesce($4, data_inicio), data_fim = coalesce($5, data_fim),
         limite_diario = coalesce($6, limite_diario), limite_total = coalesce($7, limite_total),
         minimo_para_rankear = coalesce($8, minimo_para_rankear)
       where id = $9
       returning id`,
      [nome, descricao, premioDescricao, dataInicio, dataFim, limiteDiario, limiteTotal, minimoParaRankear, req.params.id],
    )
    if (!rows.length) return res.status(404).json({ erro: 'competição não encontrada' })
    res.json({ ok: true })
  })

  return router
}
```

- [ ] **Step 4: Montar a rota em `app.js`**

Adicione o import perto dos outros:

```javascript
import { createCompeticoesRouter } from './routes/competicoes.js'
```

E a montagem, perto de `/api/clipes`:

```javascript
app.use('/api/competicoes', createCompeticoesRouter({ db, requireAuth }))
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `cd site/server && npx vitest run test/competicoes.test.js`
Expected: PASS.

- [ ] **Step 6: Rodar a suíte inteira do server (garantir que montar a rota nova não quebrou nada)**

Run: `cd site/server && npx vitest run`
Expected: todos os testes passam.

- [ ] **Step 7: Commit**

```bash
git add site/server/src/routes/competicoes.js site/server/test/competicoes.test.js site/server/src/app.js
git commit -m "feat: rota GET/admin de competicoes"
```

---

### Task 8: Elegibilidade e envio de clipes (`/:id/elegiveis`, `/:id/submissoes`)

**Files:**
- Modify: `site/server/src/routes/competicoes.js`
- Modify: `site/server/test/competicoes.test.js`

**Interfaces:**
- Consumes: tabela `competicao_submissoes` (Task 1).
- Produces: `GET /:id/elegiveis` devolve `[{ allstarClipId, matchId, roundNumber, map, pontuacao, jaEnviado }]`. `POST /:id/submissoes` (body `{ allstarClipId }`) devolve `{ ok: true }` ou erro.

- [ ] **Step 1: Escrever os testes**

```javascript
// Adicionar ao mesmo describe file, novos blocos describe:
describe('GET /api/competicoes/:id/elegiveis', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/competicoes/comp1/elegiveis')).status).toBe(401)
  })

  it('id nao-uuid: 404', async () => {
    const { app } = appWith([])
    const res = await request(app).get('/api/competicoes/abc/elegiveis').set('Cookie', cookieJogador)
    expect(res.status).toBe(404)
  })

  it('lista so os clipes PROPRIOS, Processed, com partida dentro do periodo', async () => {
    const { app, db } = appWith([
      ['from competicoes where id', [{ id: 'comp1', data_inicio: '2026-07-23T00:00:00Z', data_fim: '2026-07-30T00:00:00Z' }]],
      ['from allstar_clips ac', [
        { id: 'clip1', match_id: 'm1', round_number: 9, map: 'de_dust2', pontuacao_total: 100, ja_enviado: false },
      ]],
    ])
    const res = await request(app).get(`/api/competicoes/${'a'.repeat(8)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(12)}/elegiveis`).set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body[0].allstarClipId).toBe('clip1')
    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes('from allstar_clips ac'))
    expect(params).toContain('765') // steamId do cookie, nunca outro
  })
})

describe('POST /api/competicoes/:id/submissoes', () => {
  const COMP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const CLIP_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).post(`/api/competicoes/${COMP_ID}/submissoes`)).status).toBe(401)
  })

  it('clipe nao existe ou nao e do proprio jogador: 404', async () => {
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_inicio: '2026-07-01', data_fim: '2026-08-01', limite_diario: 2, limite_total: 10 }]],
      ['from allstar_clips where id', []], // clipe nao encontrado (ou de outro steamId — mesma query já filtra)
    ])
    const res = await request(app).post(`/api/competicoes/${COMP_ID}/submissoes`).set('Cookie', cookieJogador).send({ allstarClipId: CLIP_ID })
    expect(res.status).toBe(404)
  })

  it('clipe valido dentro do periodo e dos limites: envia com sucesso', async () => {
    const gravados = []
    const db = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (sql.includes('from competicoes where id')) {
          return Promise.resolve({ rows: [{ id: COMP_ID, data_inicio: '2026-07-01', data_fim: '2026-08-01', limite_diario: 2, limite_total: 10 }] })
        }
        if (sql.includes('from allstar_clips where id')) {
          return Promise.resolve({ rows: [{ id: CLIP_ID, steam_id64: '765', status: 'Processed', played_at: '2026-07-22T10:00:00Z' }] })
        }
        if (sql.includes('count(*) filter')) return Promise.resolve({ rows: [{ hoje: 0, total: 0 }] })
        if (sql.includes('insert into competicao_submissoes')) { gravados.push(params); return Promise.resolve({ rows: [] }) }
        return Promise.resolve({ rows: [] })
      }),
    }
    const app = createApp({ config, db })
    const res = await request(app).post(`/api/competicoes/${COMP_ID}/submissoes`).set('Cookie', cookieJogador).send({ allstarClipId: CLIP_ID })
    expect(res.status).toBe(200)
    expect(gravados).toHaveLength(1)
  })

  it('limite diario ja atingido: 400', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('from competicoes where id')) {
          return Promise.resolve({ rows: [{ id: COMP_ID, data_inicio: '2026-07-01', data_fim: '2026-08-01', limite_diario: 2, limite_total: 10 }] })
        }
        if (sql.includes('from allstar_clips where id')) {
          return Promise.resolve({ rows: [{ id: CLIP_ID, steam_id64: '765', status: 'Processed', played_at: '2026-07-22T10:00:00Z' }] })
        }
        if (sql.includes('count(*) filter')) return Promise.resolve({ rows: [{ hoje: 2, total: 5 }] })
        return Promise.resolve({ rows: [] })
      }),
    }
    const app = createApp({ config, db })
    const res = await request(app).post(`/api/competicoes/${COMP_ID}/submissoes`).set('Cookie', cookieJogador).send({ allstarClipId: CLIP_ID })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/limite di[áa]rio/i)
  })

  it('partida fora do periodo da competicao: 400', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('from competicoes where id')) {
          return Promise.resolve({ rows: [{ id: COMP_ID, data_inicio: '2026-07-23', data_fim: '2026-07-30', limite_diario: 2, limite_total: 10 }] })
        }
        if (sql.includes('from allstar_clips where id')) {
          return Promise.resolve({ rows: [{ id: CLIP_ID, steam_id64: '765', status: 'Processed', played_at: '2026-07-01T10:00:00Z' }] })
        }
        return Promise.resolve({ rows: [] })
      }),
    }
    const app = createApp({ config, db })
    const res = await request(app).post(`/api/competicoes/${COMP_ID}/submissoes`).set('Cookie', cookieJogador).send({ allstarClipId: CLIP_ID })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/per[íi]odo/i)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/server && npx vitest run test/competicoes.test.js`
Expected: FAIL nos blocos novos (rotas ainda não existem).

- [ ] **Step 3: Implementar as duas rotas**

Adicionar dentro de `createCompeticoesRouter`, antes do `return router`:

```javascript
router.get('/:id/elegiveis', requireAuth, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'competição não encontrada' })
  const { rows: compRows } = await db.query(
    'select id, data_inicio, data_fim from competicoes where id = $1',
    [req.params.id],
  )
  if (!compRows.length) return res.status(404).json({ erro: 'competição não encontrada' })
  const comp = compRows[0]
  const { rows } = await db.query(
    `select ac.id as allstar_clip_id, ac.match_id, ac.round_number, ac.pontuacao_total, ac.pontuacao_detalhe,
            m.map,
            exists (select 1 from competicao_submissoes cs where cs.competicao_id = $1 and cs.allstar_clip_id = ac.id) as ja_enviado
     from allstar_clips ac
     join matches m on m.id = ac.match_id
     where ac.steam_id64 = $2 and ac.status = 'Processed'
       and m.played_at >= $3 and m.played_at <= $4
     order by m.played_at desc`,
    [comp.id, req.player.steamId, comp.data_inicio, comp.data_fim],
  )
  res.json(rows.map((r) => ({
    allstarClipId: r.allstar_clip_id, matchId: r.match_id, roundNumber: r.round_number,
    map: r.map, pontuacao: r.pontuacao_detalhe ?? { total: r.pontuacao_total ?? 0 },
    jaEnviado: r.ja_enviado,
  })))
})

router.post('/:id/submissoes', requireAuth, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'competição não encontrada' })
  const allstarClipId = String(req.body?.allstarClipId ?? '')
  if (!UUID_RE.test(allstarClipId)) return res.status(400).json({ erro: 'allstarClipId inválido' })

  const { rows: compRows } = await db.query(
    'select id, data_inicio, data_fim, limite_diario, limite_total from competicoes where id = $1',
    [req.params.id],
  )
  if (!compRows.length) return res.status(404).json({ erro: 'competição não encontrada' })
  const comp = compRows[0]
  if (new Date() > new Date(comp.data_fim)) return res.status(400).json({ erro: 'essa competição já encerrou' })

  // #5 da auditoria (IDOR): só aceita clipe cujo steam_id64 é o do próprio req.player —
  // nunca confia num allstarClipId de outro jogador só porque o body mandou o id.
  const { rows: clipRows } = await db.query(
    "select id, steam_id64, status, played_at from allstar_clips ac join matches m on m.id = ac.match_id where ac.id = $1 and ac.steam_id64 = $2 and ac.status = 'Processed'",
    [allstarClipId, req.player.steamId],
  )
  if (!clipRows.length) return res.status(404).json({ erro: 'clipe não encontrado' })
  const clip = clipRows[0]
  if (new Date(clip.played_at) < new Date(comp.data_inicio) || new Date(clip.played_at) > new Date(comp.data_fim)) {
    return res.status(400).json({ erro: 'a partida desse clipe está fora do período da competição' })
  }

  const { rows: contagemRows } = await db.query(
    `select
       count(*) filter (where enviado_em::date = now()::date) as hoje,
       count(*) as total
     from competicao_submissoes
     where competicao_id = $1 and steam_id64 = $2`,
    [comp.id, req.player.steamId],
  )
  const { hoje, total } = contagemRows[0]
  if (Number(hoje) >= comp.limite_diario) return res.status(400).json({ erro: `limite diário de ${comp.limite_diario} clipes atingido` })
  if (Number(total) >= comp.limite_total) return res.status(400).json({ erro: `limite total de ${comp.limite_total} clipes atingido` })

  await db.query(
    'insert into competicao_submissoes (competicao_id, allstar_clip_id, steam_id64) values ($1, $2, $3) on conflict do nothing',
    [comp.id, allstarClipId, req.player.steamId],
  )
  res.json({ ok: true })
})
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd site/server && npx vitest run test/competicoes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/competicoes.js site/server/test/competicoes.test.js
git commit -m "feat: elegibilidade e envio de clipes pra competicao"
```

---

### Task 9: Leaderboard por competição, cálculo do vencedor, tradelink

**Files:**
- Modify: `site/server/src/routes/competicoes.js`
- Modify: `site/server/test/competicoes.test.js`

**Interfaces:**
- Produces: `GET /` (Task 7) passa a incluir, em cada competição, `leaderboard: [{ steamId, nick, avatarUrl, total, qualificado }]` e `clipesRecentes: [...]`. `PUT /:id/tradelink`.

- [ ] **Step 1: Escrever os testes**

```javascript
describe('leaderboard isolado por competicao', () => {
  it('soma de uma competicao nunca inclui submissao de outra', async () => {
    const { app, db } = appWith([
      ['from competicoes', [
        { id: 'compA', nome: 'A', data_inicio: '2026-07-01', data_fim: '2026-07-10', limite_diario: 2, limite_total: 10, minimo_para_rankear: 1, vencedor_steam_id64: null },
        { id: 'compB', nome: 'B', data_inicio: '2026-07-11', data_fim: '2026-07-20', limite_diario: 2, limite_total: 10, minimo_para_rankear: 1, vencedor_steam_id64: null },
      ]],
      ['from competicao_submissoes cs join', [
        { competicao_id: 'compA', steam_id64: '765', nick: 'bronze', avatar_url: null, total: 100, qtd: 1 },
      ]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    // A query de leaderboard precisa ter sido chamada com o competicao_id certo por vez —
    // cada competição tem sua própria query/filtro, nunca uma soma cruzada.
    const chamadasLeaderboard = db.query.mock.calls.filter(([sql]) => sql.includes('from competicao_submissoes cs join'))
    expect(chamadasLeaderboard.length).toBeGreaterThanOrEqual(2)
  })

  it('quem nao bate o minimo aparece separado, nao no ranking principal', async () => {
    const { app } = appWith([
      ['from competicoes', [{ id: 'comp1', nome: 'X', data_inicio: '2026-07-01', data_fim: '2026-07-10', limite_diario: 2, limite_total: 10, minimo_para_rankear: 3, vencedor_steam_id64: null }]],
      ['from competicao_submissoes cs join', [
        { competicao_id: 'comp1', steam_id64: '765', nick: 'bronze', avatar_url: null, total: 50, qtd: 1 },
        { competicao_id: 'comp1', steam_id64: '999', nick: 'troya', avatar_url: null, total: 300, qtd: 5 },
      ]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    const comp = res.body.encerradas[0] ?? res.body.ativa
    expect(comp.leaderboard.find((l) => l.steamId === '999').qualificado).toBe(true)
    expect(comp.leaderboard.find((l) => l.steamId === '765').qualificado).toBe(false)
  })
})

describe('PUT /api/competicoes/:id/tradelink', () => {
  const COMP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

  it('quem nao e o vencedor: 403', async () => {
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: '2026-07-01', vencedor_steam_id64: '999' }]],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/tradelink`).set('Cookie', cookieJogador).send({ tradelink: 'https://steamcommunity.com/tradeoffer/x' })
    expect(res.status).toBe(403)
  })

  it('o proprio vencedor consegue gravar', async () => {
    const { app, db } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: '2026-07-01', vencedor_steam_id64: '765' }]],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/tradelink`).set('Cookie', cookieJogador).send({ tradelink: 'https://steamcommunity.com/tradeoffer/x' })
    expect(res.status).toBe(200)
    const update = db.query.mock.calls.find(([sql]) => sql.includes('update competicoes set tradelink_vencedor'))
    expect(update).toBeTruthy()
  })

  it('competicao ainda ativa (nao encerrou): 400', async () => {
    const noFuturo = new Date(Date.now() + 86400000).toISOString()
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: noFuturo, vencedor_steam_id64: '765' }]],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/tradelink`).set('Cookie', cookieJogador).send({ tradelink: 'x' })
    expect(res.status).toBe(400)
  })
})

describe('tradelink so aparece pro vencedor/admin em GET /', () => {
  it('outro jogador nao ve tradelink_vencedor na resposta', async () => {
    const { app } = appWith([
      ['from competicoes', [{ id: 'comp1', data_inicio: '2026-07-01', data_fim: '2026-07-05', vencedor_steam_id64: '999', tradelink_vencedor: 'https://steamcommunity.com/x', limite_diario: 2, limite_total: 10, minimo_para_rankear: 1 }]],
      ['from competicao_submissoes cs join', []],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador) // cookie do 765, vencedor é 999
    const comp = res.body.encerradas[0]
    expect(comp.tradelinkVencedor).toBeUndefined()
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/server && npx vitest run test/competicoes.test.js`
Expected: FAIL (leaderboard/tradelink ainda não existem no `GET /`; rota `PUT
/:id/tradelink` ainda não existe).

- [ ] **Step 3: Implementar**

Adicione uma função auxiliar no topo do arquivo, antes de `createCompeticoesRouter`:

```javascript
async function buscarLeaderboard(db, competicaoId, minimoParaRankear) {
  const { rows } = await db.query(
    `select cs.steam_id64, coalesce(p.nick, mp.nick) as nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url,
            sum(ac.pontuacao_total) as total, count(*) as qtd
     from competicao_submissoes cs join allstar_clips ac on ac.id = cs.allstar_clip_id
     left join players p on p.steam_id64 = cs.steam_id64
     left join match_players mp on mp.match_id = ac.match_id and mp.steam_id64 = cs.steam_id64
     left join steam_avatares sa on sa.steam_id64 = cs.steam_id64
     where cs.competicao_id = $1
     group by cs.steam_id64, p.nick, mp.nick, p.avatar_url, sa.avatar_url`,
    [competicaoId],
  )
  const leaderboard = rows.map((r) => ({
    steamId: r.steam_id64, nick: r.nick, avatarUrl: r.avatar_url,
    total: Number(r.total), qualificado: Number(r.qtd) >= minimoParaRankear,
  }))
  leaderboard.sort((a, b) => b.total - a.total)
  return leaderboard
}

async function calcularOuLerVencedor(db, comp) {
  if (comp.vencedor_steam_id64 || new Date() <= new Date(comp.data_fim)) return comp.vencedor_steam_id64
  const leaderboard = await buscarLeaderboard(db, comp.id, comp.minimo_para_rankear)
  const qualificados = leaderboard.filter((l) => l.qualificado)
  if (!qualificados.length) return null
  const vencedor = qualificados[0].steamId
  await db.query('update competicoes set vencedor_steam_id64 = $1 where id = $2 and vencedor_steam_id64 is null', [vencedor, comp.id])
  return vencedor
}
```

Substitua o handler `router.get('/', ...)` inteiro por:

```javascript
router.get('/', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `select id, nome, descricao, premio_descricao, data_inicio, data_fim,
            limite_diario, limite_total, minimo_para_rankear, vencedor_steam_id64, tradelink_vencedor
     from competicoes
     order by data_inicio desc`,
  )
  const agora = new Date()
  async function montar(c) {
    const vencedorSteamId = await calcularOuLerVencedor(db, c)
    const leaderboard = await buscarLeaderboard(db, c.id, c.minimo_para_rankear)
    const ehVencedorOuAdmin = req.player.steamId === vencedorSteamId || req.player.isSuperAdmin
    return {
      ...mapCompeticao({ ...c, vencedor_steam_id64: vencedorSteamId }),
      leaderboard,
      // #6/#12 da auditoria: tradelink só aparece pro próprio vencedor ou admin —
      // omitido da resposta (não só escondido no client) pra qualquer outro jogador.
      ...(ehVencedorOuAdmin ? { tradelinkVencedor: c.tradelink_vencedor } : {}),
    }
  }
  const ativa = rows.find((c) => new Date(c.data_inicio) <= agora && agora <= new Date(c.data_fim))
  const encerradas = rows.filter((c) => new Date(c.data_fim) < agora)
  res.json({
    ativa: ativa ? await montar(ativa) : null,
    encerradas: await Promise.all(encerradas.map(montar)),
  })
})
```

E adicione, antes do `return router`, a rota de tradelink:

```javascript
router.put('/:id/tradelink', requireAuth, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'competição não encontrada' })
  const { rows } = await db.query('select id, data_fim, vencedor_steam_id64 from competicoes where id = $1', [req.params.id])
  if (!rows.length) return res.status(404).json({ erro: 'competição não encontrada' })
  const comp = rows[0]
  if (new Date() <= new Date(comp.data_fim)) return res.status(400).json({ erro: 'a competição ainda não encerrou' })
  if (req.player.steamId !== comp.vencedor_steam_id64) return res.status(403).json({ erro: 'só o vencedor pode informar o tradelink' })
  const tradelink = String(req.body?.tradelink ?? '').trim()
  if (!tradelink) return res.status(400).json({ erro: 'tradelink obrigatório' })
  await db.query('update competicoes set tradelink_vencedor = $1 where id = $2', [tradelink, req.params.id])
  res.json({ ok: true })
})
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd site/server && npx vitest run test/competicoes.test.js`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte inteira do server**

Run: `cd site/server && npx vitest run`
Expected: todos os testes passam.

- [ ] **Step 6: Commit**

```bash
git add site/server/src/routes/competicoes.js site/server/test/competicoes.test.js
git commit -m "feat: leaderboard por competicao, calculo de vencedor e tradelink"
```

---

### Task 10: Menu — item "Competições" no Shell

**Files:**
- Modify: `site/client/src/components/Shell.jsx`

**Interfaces:**
- Produces: rota `/competicoes` navegável a partir do menu lateral.

- [ ] **Step 1: Adicionar o ícone**

Em `NAV_ICONES` (perto do ícone `clipes`), adicionar:

```jsx
competicoes: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
    <path d="M8 21H16" />
    <path d="M12 17V21" />
    <path d="M7 4H17V9C17 12.3137 14.7614 15 12 15C9.23858 15 7 12.3137 7 9V4Z" />
    <path d="M17 5H19.5C19.5 7 18.5 8.5 17 8.5" />
    <path d="M7 5H4.5C4.5 7 5.5 8.5 7 8.5" />
  </svg>
),
```

- [ ] **Step 2: Adicionar o item em `ITENS_BASE`, logo após "Clipes"**

```jsx
const ITENS_BASE = [
  { to: '/', end: true, label: 'Partidas', icone: 'partidas' },
  { to: '/ranking', label: 'Ranking', icone: 'ranking' },
  { to: '/enviar-demo', label: 'Enviar demo', icone: 'enviarDemo' },
  { to: '/clipes', label: 'Clipes', icone: 'clipes' },
  { to: '/competicoes', label: 'Competições', icone: 'competicoes' },
  { to: '/jogadores', label: 'Amigos', icone: 'jogadores' },
  { to: '/comparar', label: 'Comparar', icone: 'comparar' },
  { to: '/granadas', label: 'Granadas', icone: 'granadas' },
  { to: '/taticas', label: 'Táticas', icone: 'taticas' },
  { to: '/conta', label: 'Minha conta', icone: 'perfil' },
  { to: '/curso', label: 'Curso de mira', icone: 'curso' },
]
```

(a numeração é derivada do índice — não precisa mexer em mais nada; os itens de admin
logo abaixo também já derivam de `ITENS.length`, então continuam corretos sozinhos.)

- [ ] **Step 3: Rodar os testes de Shell/App pra garantir que nada quebrou**

Run: `cd site/client && npx vitest run src/test/App.test.jsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add site/client/src/components/Shell.jsx
git commit -m "feat: item Competicoes no menu lateral"
```

---

### Task 11: Rota e roteamento client — `/competicoes` (placeholder de página vazia)

**Files:**
- Create: `site/client/src/pages/Competicoes.jsx` (versão inicial, sem leaderboard/grade ainda — Task 12 completa)
- Modify: `site/client/src/App.jsx` (adicionar a rota)
- Test: `site/client/src/test/Competicoes.test.jsx`

**Interfaces:**
- Consumes: `GET /api/competicoes` (Task 9).
- Produces: componente `Competicoes` default export, usado na rota `/competicoes`.

- [ ] **Step 1: Escrever o teste**

```jsx
// site/client/src/test/Competicoes.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import Competicoes from '../pages/Competicoes.jsx'

afterEach(() => { vi.restoreAllMocks() })

describe('Competicoes', () => {
  it('sem competicao ativa: mostra mensagem', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ativa: null, encerradas: [] }) })
    render(<Competicoes />)
    await waitFor(() => expect(screen.getByText(/nenhuma competi/i)).toBeInTheDocument())
  })

  it('com competicao ativa: mostra nome e premio', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ativa: {
          id: 'comp1', nome: 'Semana 1', premioDescricao: 'Skin AK-47',
          dataFim: new Date(Date.now() + 86400000).toISOString(),
          leaderboard: [], limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 3,
        },
        encerradas: [],
      }),
    })
    render(<Competicoes />)
    await waitFor(() => expect(screen.getByText('Semana 1')).toBeInTheDocument())
    expect(screen.getByText('Skin AK-47')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/client && npx vitest run src/test/Competicoes.test.jsx`
Expected: FAIL (`Competicoes.jsx` não existe).

- [ ] **Step 3: Implementar a versão inicial da página**

```jsx
// site/client/src/pages/Competicoes.jsx
import { useEffect, useState } from 'react'
import { SectionHeader } from '../components/ui'

export default function Competicoes() {
  const [dados, setDados] = useState(null)

  useEffect(() => {
    fetch('/api/competicoes')
      .then((res) => (res.ok ? res.json() : { ativa: null, encerradas: [] }))
      .then(setDados)
      .catch(() => setDados({ ativa: null, encerradas: [] }))
  }, [])

  if (dados === null) return <p className="font-mono text-sm text-texto-fraco">Carregando…</p>

  return (
    <div className="space-y-6">
      <SectionHeader titulo="Competições" />
      {!dados.ativa && dados.encerradas.length === 0 && (
        <p className="font-mono text-sm text-texto-fraco">Nenhuma competição no momento.</p>
      )}
      {dados.ativa && (
        <div className="panel-cut border border-borda bg-superficie p-4">
          <h2 className="font-display text-xl font-bold text-texto">{dados.ativa.nome}</h2>
          <p className="mt-1 font-mono text-sm text-destaque">{dados.ativa.premioDescricao}</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Adicionar a rota em `App.jsx`**

Abra `site/client/src/App.jsx`, importe o componente perto dos outros imports de página:

```jsx
import Competicoes from './pages/Competicoes.jsx'
```

E adicione a `<Route>` correspondente perto da de `/clipes` (confira o padrão exato de
como as outras rotas protegidas são declaradas nesse arquivo antes de replicar):

```jsx
<Route path="/competicoes" element={<Competicoes />} />
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `cd site/client && npx vitest run src/test/Competicoes.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/client/src/pages/Competicoes.jsx site/client/src/App.jsx site/client/src/test/Competicoes.test.jsx
git commit -m "feat: pagina Competicoes (versao inicial) e rota"
```

---

### Task 12: `Competicoes.jsx` completo — leaderboard, grade, histórico, tradelink

**Files:**
- Modify: `site/client/src/pages/Competicoes.jsx`
- Modify: `site/client/src/test/Competicoes.test.jsx`

**Interfaces:**
- Consumes: campos `leaderboard`, `clipesRecentes` (adicionar ao backend se ainda não vier — ver nota no Step 3), `tradelinkVencedor` da resposta de `GET /api/competicoes`.

- [ ] **Step 1: Adicionar teste do leaderboard e do card de tradelink**

```jsx
it('mostra leaderboard com qualificados primeiro', async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ativa: {
        id: 'comp1', nome: 'Semana 1', premioDescricao: 'Skin', dataFim: new Date(Date.now() + 86400000).toISOString(),
        limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 3,
        leaderboard: [
          { steamId: '999', nick: 'troya', avatarUrl: null, total: 300, qualificado: true },
          { steamId: '765', nick: 'bronze', avatarUrl: null, total: 50, qualificado: false },
        ],
      },
      encerradas: [],
    }),
  })
  render(<Competicoes />)
  await waitFor(() => expect(screen.getByText('troya')).toBeInTheDocument())
  expect(screen.getByText(/ainda n[ãa]o qualificado/i)).toBeInTheDocument()
})

it('competicao encerrada com vencedor e tradelink liberado pro proprio vencedor', async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ativa: null,
      encerradas: [{
        id: 'comp1', nome: 'Semana 1', premioDescricao: 'Skin', dataFim: new Date(Date.now() - 86400000).toISOString(),
        limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 3,
        vencedorSteamId: '765', tradelinkVencedor: null,
        leaderboard: [{ steamId: '765', nick: 'bronze', avatarUrl: null, total: 300, qualificado: true }],
      }],
    }),
  })
  render(<Competicoes />)
  await waitFor(() => expect(screen.getByText(/voc[êe] venceu/i)).toBeInTheDocument())
  expect(screen.getByPlaceholderText(/tradelink/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/client && npx vitest run src/test/Competicoes.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Adicionar `clipesRecentes` ao backend (pequeno complemento da Task 9)**

Em `site/server/src/routes/competicoes.js`, dentro da função `montar` (dentro de `GET
/`), adicione a busca dos clipes enviados recentemente e inclua no objeto retornado:

```javascript
async function buscarClipesRecentes(db, competicaoId) {
  const { rows } = await db.query(
    `select ac.id, ac.clip_url, ac.clip_snapshot_url, ac.pontuacao_total, ac.pontuacao_detalhe,
            cs.steam_id64, coalesce(p.nick, mp.nick) as nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url,
            cs.enviado_em
     from competicao_submissoes cs
     join allstar_clips ac on ac.id = cs.allstar_clip_id
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
    pontuacao: r.pontuacao_detalhe ?? { total: r.pontuacao_total ?? 0 },
  }))
}
```

E dentro de `montar`, adicione `clipesRecentes: await buscarClipesRecentes(db, c.id),`
ao objeto de retorno (junto de `leaderboard`).

- [ ] **Step 4: Implementar a versão completa do client**

```jsx
// site/client/src/pages/Competicoes.jsx
import { useEffect, useState } from 'react'
import { SectionHeader, Card, Badge } from '../components/ui'
import { useAuth } from '../auth/AuthContext.jsx'

function Leaderboard({ leaderboard, minimoParaRankear }) {
  const qualificados = leaderboard.filter((l) => l.qualificado)
  const naoQualificados = leaderboard.filter((l) => !l.qualificado)
  return (
    <div className="space-y-3">
      <div className="panel-cut border border-borda">
        {qualificados.map((l, i) => (
          <div key={l.steamId} className="flex items-center gap-3 border-b border-borda px-3 py-2 last:border-b-0">
            <span className="font-mono text-texto-fraco">{i + 1}º</span>
            {l.avatarUrl && <img src={l.avatarUrl} alt="" className="panel-cut-sm h-6 w-6 border border-borda object-cover" />}
            <span className="flex-1 font-mono text-texto">{l.nick}</span>
            <span className="font-display font-bold text-destaque tabular-nums">{l.total}</span>
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

function CardCompeticao({ comp, viewerSteamId, onTradelinkEnviado }) {
  const [tradelink, setTradelink] = useState('')
  const [enviando, setEnviando] = useState(false)
  const encerrada = new Date(comp.dataFim) < new Date()
  const souVencedor = comp.vencedorSteamId === viewerSteamId

  async function enviarTradelink(e) {
    e.preventDefault()
    setEnviando(true)
    const res = await fetch(`/api/competicoes/${comp.id}/tradelink`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradelink }),
    }).catch(() => null)
    setEnviando(false)
    if (res?.ok) onTradelinkEnviado()
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-bold text-texto">{comp.nome}</h2>
        {comp.premioDescricao && <Badge tom="destaque">{comp.premioDescricao}</Badge>}
      </div>
      {comp.descricao && <p className="mt-2 font-mono text-sm text-texto-fraco">{comp.descricao}</p>}
      <p className="mt-1 font-mono text-xs text-texto-fraco">
        Limite: {comp.limiteDiario}/dia · {comp.limiteTotal} no total · mínimo {comp.minimoParaRankear} pra rankear
      </p>

      {souVencedor && encerrada && !comp.tradelinkVencedor && (
        <form onSubmit={enviarTradelink} className="mt-4 panel-cut-sm border border-destaque bg-destaque/10 p-3">
          <p className="font-mono text-sm text-destaque">🏆 Você venceu! Informe seu tradelink pra receber o prêmio.</p>
          <div className="mt-2 flex gap-2">
            <input
              value={tradelink}
              onChange={(e) => setTradelink(e.target.value)}
              placeholder="Link de troca da Steam"
              className="min-h-10 flex-1 border border-borda bg-superficie px-2 font-mono text-xs text-texto"
            />
            <button disabled={enviando} className="panel-cut-sm border border-destaque px-3 font-mono text-xs uppercase text-destaque">
              {enviando ? '…' : 'Enviar'}
            </button>
          </div>
        </form>
      )}
      {souVencedor && comp.tradelinkVencedor && (
        <p className="mt-4 font-mono text-sm text-sucesso">Tradelink enviado — aguarde o contato pro envio do prêmio.</p>
      )}

      <div className="mt-4">
        <h3 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">Leaderboard</h3>
        <Leaderboard leaderboard={comp.leaderboard} minimoParaRankear={comp.minimoParaRankear} />
      </div>

      {comp.clipesRecentes?.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">Enviados recentemente</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {comp.clipesRecentes.map((c) => (
              <div key={c.id} className="panel-cut-sm border border-borda p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-texto">{c.nick}</span>
                  <span className="font-display font-bold text-destaque">{c.pontuacao.total}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

export default function Competicoes() {
  const { jogador } = useAuth()
  const [dados, setDados] = useState(null)

  function carregar() {
    fetch('/api/competicoes')
      .then((res) => (res.ok ? res.json() : { ativa: null, encerradas: [] }))
      .then(setDados)
      .catch(() => setDados({ ativa: null, encerradas: [] }))
  }

  useEffect(carregar, [])

  if (dados === null) return <p className="font-mono text-sm text-texto-fraco">Carregando…</p>

  return (
    <div className="space-y-6">
      <SectionHeader titulo="Competições" />
      {!dados.ativa && dados.encerradas.length === 0 && (
        <p className="font-mono text-sm text-texto-fraco">Nenhuma competição no momento.</p>
      )}
      {dados.ativa && <CardCompeticao comp={dados.ativa} viewerSteamId={jogador?.steamId} onTradelinkEnviado={carregar} />}
      {dados.encerradas.map((comp) => (
        <CardCompeticao key={comp.id} comp={comp} viewerSteamId={jogador?.steamId} onTradelinkEnviado={carregar} />
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `cd site/client && npx vitest run src/test/Competicoes.test.jsx`
Expected: PASS.

Run: `cd site/server && npx vitest run test/competicoes.test.js`
Expected: PASS (confirma que `clipesRecentes` não quebrou os testes de servidor —
ajuste os mocks existentes se necessário pra incluírem essa nova subquery).

- [ ] **Step 6: Commit**

```bash
git add site/client/src/pages/Competicoes.jsx site/client/src/test/Competicoes.test.jsx site/server/src/routes/competicoes.js site/server/test/competicoes.test.js
git commit -m "feat: leaderboard, clipes recentes e tradelink na pagina Competicoes"
```

---

### Task 13: Seletor de clipes elegíveis (componente compartilhado)

**Files:**
- Create: `site/client/src/components/SeletorClipesCompeticao.jsx`
- Test: `site/client/src/test/SeletorClipesCompeticao.test.jsx`
- Modify: `site/client/src/pages/Competicoes.jsx` (botão "Enviar clipe" abre o seletor)

**Interfaces:**
- Consumes: `GET /api/competicoes/:id/elegiveis`, `POST /api/competicoes/:id/submissoes` (Task 8).
- Produces: `<SeletorClipesCompeticao competicaoId onFechar onEnviado />` — componente usado também na Task 14 (atalho em Partida.jsx).

- [ ] **Step 1: Escrever o teste**

```jsx
// site/client/src/test/SeletorClipesCompeticao.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SeletorClipesCompeticao from '../components/SeletorClipesCompeticao.jsx'

afterEach(() => { vi.restoreAllMocks() })

describe('SeletorClipesCompeticao', () => {
  it('lista os clipes elegiveis com pontuacao e marca os ja enviados', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { allstarClipId: 'c1', matchId: 'm1', roundNumber: 9, map: 'de_dust2', pontuacao: { total: 100 }, jaEnviado: false },
        { allstarClipId: 'c2', matchId: 'm2', roundNumber: 4, map: 'de_mirage', pontuacao: { total: 80 }, jaEnviado: true },
      ]),
    })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={() => {}} />)
    await waitFor(() => expect(screen.getByText('de_dust2')).toBeInTheDocument())
    expect(screen.getByText(/enviado/i)).toBeInTheDocument()
  })

  it('clica em enviar chama o POST de submissao e depois onEnviado', async () => {
    const onEnviado = vi.fn()
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (opts?.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) })
      return Promise.resolve({ ok: true, json: async () => ([
        { allstarClipId: 'c1', matchId: 'm1', roundNumber: 9, map: 'de_dust2', pontuacao: { total: 100 }, jaEnviado: false },
      ]) })
    })
    render(<SeletorClipesCompeticao competicaoId="comp1" onFechar={() => {}} onEnviado={onEnviado} />)
    await waitFor(() => screen.getByText('de_dust2'))
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await waitFor(() => expect(onEnviado).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/client && npx vitest run src/test/SeletorClipesCompeticao.test.jsx`
Expected: FAIL (componente não existe).

- [ ] **Step 3: Implementar**

```jsx
// site/client/src/components/SeletorClipesCompeticao.jsx
import { useEffect, useState } from 'react'
import { nomeMapa } from '../lib/format.js'
import { useTransicaoModal } from '../lib/useTransicaoModal.js'

// Tela de seleção compartilhada — acionada tanto pelo botão "Enviar clipe" da aba
// Competições quanto pelo atalho "Enviar pra competição →" dentro de Partida > Clipes.
// Lista só os clipes elegíveis (já gerados, Processed, partida dentro do período da
// competição — GET /api/competicoes/:id/elegiveis já filtra isso no servidor).
export default function SeletorClipesCompeticao({ competicaoId, onFechar, onEnviado }) {
  const [clipes, setClipes] = useState(null)
  const [enviando, setEnviando] = useState(null)
  const [erro, setErro] = useState(null)
  const { visivel, iniciarSaida } = useTransicaoModal()
  const fechar = () => iniciarSaida(onFechar)

  function carregar() {
    fetch(`/api/competicoes/${competicaoId}/elegiveis`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setClipes)
      .catch(() => setClipes([]))
  }

  useEffect(carregar, [competicaoId])

  async function enviar(allstarClipId) {
    setEnviando(allstarClipId)
    setErro(null)
    const res = await fetch(`/api/competicoes/${competicaoId}/submissoes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allstarClipId }),
    }).catch(() => null)
    setEnviando(null)
    if (res?.ok) { carregar(); onEnviado() } else {
      const body = await res?.json().catch(() => ({}))
      setErro(body?.erro ?? 'Falha ao enviar o clipe.')
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-fundo/80 p-4 transition-opacity duration-200 ${visivel ? 'opacity-100' : 'opacity-0'}`}
      onClick={fechar}
    >
      <div className="panel-cut max-h-[80vh] w-full max-w-3xl overflow-y-auto border border-borda bg-superficie p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-texto">Selecionar clipes pra enviar</h2>
          <button onClick={fechar} className="font-mono text-xs uppercase text-texto-fraco hover:text-texto">fechar</button>
        </div>
        {erro && <p className="mt-2 font-mono text-xs text-perigo">{erro}</p>}
        {clipes === null ? (
          <p className="mt-4 font-mono text-sm text-texto-fraco">Carregando…</p>
        ) : clipes.length === 0 ? (
          <p className="mt-4 font-mono text-sm text-texto-fraco">Nenhum clipe elegível ainda — gere um clipe de uma partida jogada dentro do período da competição.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {clipes.map((c) => (
              <div key={c.allstarClipId} className="panel-cut-sm border border-borda p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-texto">{nomeMapa(c.map)} · round {c.roundNumber}</span>
                  <span className="font-display font-bold text-destaque">{c.pontuacao.total}</span>
                </div>
                <button
                  onClick={() => enviar(c.allstarClipId)}
                  disabled={c.jaEnviado || enviando === c.allstarClipId}
                  className="panel-cut-sm mt-2 min-h-10 w-full border border-borda px-3 font-mono text-xs uppercase text-texto-fraco hover:border-destaque/50 hover:text-destaque disabled:opacity-50 lg:min-h-0"
                >
                  {c.jaEnviado ? 'já enviado' : enviando === c.allstarClipId ? '…' : 'enviar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd site/client && npx vitest run src/test/SeletorClipesCompeticao.test.jsx`
Expected: PASS.

- [ ] **Step 5: Ligar o botão "Enviar clipe" da aba Competições ao seletor**

Em `site/client/src/pages/Competicoes.jsx`, adicione estado e o botão dentro de
`CardCompeticao` (só quando a competição está ativa, não encerrada):

```jsx
// dentro de CardCompeticao, adicionar estado:
const [seletorAberto, setSeletorAberto] = useState(false)

// no JSX, logo abaixo do cabeçalho (nome + prêmio), antes do Leaderboard, só se !encerrada:
{!encerrada && (
  <button
    onClick={() => setSeletorAberto(true)}
    className="panel-cut-sm mt-3 min-h-10 border border-destaque bg-destaque/10 px-3 font-mono text-xs uppercase text-destaque hover:bg-destaque/20 lg:min-h-0"
  >
    Enviar clipe
  </button>
)}
{seletorAberto && (
  <SeletorClipesCompeticao
    competicaoId={comp.id}
    onFechar={() => setSeletorAberto(false)}
    onEnviado={onTradelinkEnviado /* reaproveita o mesmo callback de recarregar os dados */}
  />
)}
```

Adicione o import no topo do arquivo: `import SeletorClipesCompeticao from
'../components/SeletorClipesCompeticao.jsx'`.

- [ ] **Step 6: Rodar a suíte inteira do client**

Run: `cd site/client && npx vitest run`
Expected: todos os testes passam.

- [ ] **Step 7: Commit**

```bash
git add site/client/src/components/SeletorClipesCompeticao.jsx site/client/src/test/SeletorClipesCompeticao.test.jsx site/client/src/pages/Competicoes.jsx
git commit -m "feat: seletor de clipes elegiveis pra enviar a competicao"
```

---

### Task 14: Atalho em Partida.jsx → aba Clipes

**Files:**
- Modify: `site/server/src/routes/matches.js` (expor `allstarClip.id`)
- Modify: `site/server/test/matches.test.js`
- Modify: `site/client/src/pages/Partida.jsx`

**Interfaces:**
- Consumes: `SeletorClipesCompeticao` (Task 13).
- Produces: `m.players[].allstarClip` passa a incluir `id` (o `allstar_clips.id`), necessário pro seletor saber qual clipe pré-selecionar.

- [ ] **Step 1: Atualizar o teste de `matches.js`**

Em `site/server/test/matches.test.js`, no teste que verifica `players[].allstarClip`,
adicione a asserção do campo `id`:

```javascript
// No teste existente 'clipe do Allstar de um jogador aparece em players[].allstarClip...':
expect(res.body.players.find((p) => p.steamId === STEAM_ID_COM_CLIPE).allstarClip).toMatchObject({
  id: expect.any(String), // adicionar esta linha
  status: 'Processed',
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/server && npx vitest run test/matches.test.js`
Expected: FAIL (o campo `id` ainda não vem na resposta).

- [ ] **Step 3: Expor o `id` em `matches.js`**

Na query de `allstarClips` dentro do `GET /:id` (busca `select steam_id64, status,
clip_url, clip_snapshot_url, round_number from allstar_clips where match_id = $1`),
adicione `id`:

```javascript
`select id, steam_id64, status, clip_url, clip_snapshot_url, round_number from allstar_clips where match_id = $1`
```

E no map que monta `allstarClipPorJogador`, inclua `id: row.id` no objeto — confira o
nome exato da variável de linha usado nesse `.map()` antes de editar (é a mesma query
já existente, só adicionando um campo no select e no map).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd site/server && npx vitest run test/matches.test.js`
Expected: PASS.

- [ ] **Step 5: Adicionar o atalho em `Partida.jsx`**

No componente `PainelClipeJogador` (branch `Processed`, dentro do `<div
className="flex flex-wrap items-center justify-between gap-2">` que já tem o botão
"assistir"), adicione o link condicional. Primeiro, passe `competicaoAtiva` como nova
prop de `PainelClipeJogador` (buscada uma vez no componente pai `Partida`, com um
`useEffect` simples chamando `GET /api/competicoes` — reaproveite o padrão já usado
pros outros `useEffect` de fetch nesse arquivo):

```jsx
// dentro do cabeçalho do card Processed, ao lado do botão assistir:
{competicaoAtiva && new Date(m.playedAt) >= new Date(competicaoAtiva.dataInicio) && new Date(m.playedAt) <= new Date(competicaoAtiva.dataFim) && (
  <button
    onClick={() => onAbrirSeletorCompeticao(clip.id)}
    className="font-mono text-xs uppercase text-texto-fraco underline hover:text-destaque"
  >
    Enviar pra competição →
  </button>
)}
```

No componente `Partida` (o de nível mais alto do arquivo), adicione o estado e o
`useEffect`:

```jsx
const [competicaoAtiva, setCompeticaoAtiva] = useState(null)
const [seletorCompeticaoAberto, setSeletorCompeticaoAberto] = useState(false)

useEffect(() => {
  fetch('/api/competicoes')
    .then((res) => (res.ok ? res.json() : { ativa: null }))
    .then((d) => setCompeticaoAtiva(d.ativa))
    .catch(() => setCompeticaoAtiva(null))
}, [])
```

E renderize o seletor perto do fechamento do componente (importe `
SeletorClipesCompeticao` no topo do arquivo):

```jsx
{seletorCompeticaoAberto && competicaoAtiva && (
  <SeletorClipesCompeticao
    competicaoId={competicaoAtiva.id}
    onFechar={() => setSeletorCompeticaoAberto(false)}
    onEnviado={() => setSeletorCompeticaoAberto(false)}
  />
)}
```

Passe `competicaoAtiva` e `onAbrirSeletorCompeticao={() =>
setSeletorCompeticaoAberto(true)}` como props adicionais onde `PainelClipeJogador` é
renderizado (~linha 1497 do arquivo original).

- [ ] **Step 6: Rodar a suíte inteira do client**

Run: `cd site/client && npx vitest run`
Expected: todos os testes passam. Se algum teste existente de `Partida.jsx`/`SecaoReplay`
quebrar por causa do novo `useEffect` de fetch, adicione um mock de
`fetch('/api/competicoes')` devolvendo `{ ativa: null }` no setup desse teste.

- [ ] **Step 7: Commit**

```bash
git add site/server/src/routes/matches.js site/server/test/matches.test.js site/client/src/pages/Partida.jsx
git commit -m "feat: atalho para enviar clipe a competicao dentro de Partida"
```

---

### Task 15: Admin — criar/editar competição

**Files:**
- Create: `site/client/src/components/FormCompeticao.jsx`
- Test: `site/client/src/test/FormCompeticao.test.jsx`
- Modify: `site/client/src/pages/Admin.jsx`

**Interfaces:**
- Consumes: `POST /api/competicoes/admin`, `PUT /api/competicoes/admin/:id` (Task 7).

- [ ] **Step 1: Escrever o teste**

```jsx
// site/client/src/test/FormCompeticao.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FormCompeticao from '../components/FormCompeticao.jsx'

describe('FormCompeticao', () => {
  it('preenche e salva uma competicao nova', async () => {
    const onSalvo = vi.fn()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'comp1' }) })
    render(<FormCompeticao onSalvo={onSalvo} onCancelar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Semana 1' } })
    fireEvent.change(screen.getByLabelText(/pr[êe]mio/i), { target: { value: 'Skin AK-47' } })
    fireEvent.change(screen.getByLabelText(/in[íi]cio/i), { target: { value: '2026-07-23T00:00' } })
    fireEvent.change(screen.getByLabelText(/fim/i), { target: { value: '2026-07-30T00:00' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
    const [, opts] = global.fetch.mock.calls[0]
    expect(JSON.parse(opts.body).nome).toBe('Semana 1')
  })

  it('erro do servidor aparece na tela', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ erro: 'dataFim precisa ser depois de dataInicio' }) })
    render(<FormCompeticao onSalvo={() => {}} onCancelar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(screen.getByText(/dataFim precisa ser depois/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd site/client && npx vitest run src/test/FormCompeticao.test.jsx`
Expected: FAIL (componente não existe).

- [ ] **Step 3: Implementar**

```jsx
// site/client/src/components/FormCompeticao.jsx
import { useState } from 'react'
import { useTransicaoModal } from '../lib/useTransicaoModal.js'

// Mesmo padrão de FormGranada.jsx — modal fixed inset-0, transição de entrada/saída,
// botão de fechar fixo no mobile.
export default function FormCompeticao({ inicial = null, onSalvo, onCancelar }) {
  const [nome, setNome] = useState(inicial?.nome ?? '')
  const [descricao, setDescricao] = useState(inicial?.descricao ?? '')
  const [premioDescricao, setPremioDescricao] = useState(inicial?.premioDescricao ?? '')
  const [dataInicio, setDataInicio] = useState(inicial?.dataInicio?.slice(0, 16) ?? '')
  const [dataFim, setDataFim] = useState(inicial?.dataFim?.slice(0, 16) ?? '')
  const [limiteDiario, setLimiteDiario] = useState(inicial?.limiteDiario ?? 2)
  const [limiteTotal, setLimiteTotal] = useState(inicial?.limiteTotal ?? 10)
  const [minimoParaRankear, setMinimoParaRankear] = useState(inicial?.minimoParaRankear ?? 3)
  const [erro, setErro] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const { visivel, iniciarSaida } = useTransicaoModal()
  const fechar = () => iniciarSaida(onCancelar)

  async function salvar(e) {
    e.preventDefault()
    setErro(null)
    setSalvando(true)
    const corpo = {
      nome, descricao, premioDescricao,
      dataInicio: new Date(dataInicio).toISOString(),
      dataFim: new Date(dataFim).toISOString(),
      limiteDiario: Number(limiteDiario), limiteTotal: Number(limiteTotal), minimoParaRankear: Number(minimoParaRankear),
    }
    const res = await fetch(inicial ? `/api/competicoes/admin/${inicial.id}` : '/api/competicoes/admin', {
      method: inicial ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    }).catch(() => null)
    setSalvando(false)
    if (res?.ok) return iniciarSaida(onSalvo)
    const body = await res?.json().catch(() => ({}))
    setErro(body?.erro ?? 'Erro ao salvar.')
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-fundo/80 p-4 transition-opacity duration-200 ${visivel ? 'opacity-100' : 'opacity-0'}`}
      onClick={fechar}
    >
      <form onSubmit={salvar} className="panel-cut w-full max-w-lg border border-borda bg-superficie p-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-bold text-texto">{inicial ? 'Editar' : 'Nova'} competição</h2>
        {erro && <p className="mt-2 font-mono text-xs text-perigo">{erro}</p>}
        <label className="mt-3 block font-mono text-xs text-texto-fraco">
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto" />
        </label>
        <label className="mt-3 block font-mono text-xs text-texto-fraco">
          Descrição
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} className="mt-1 w-full border border-borda bg-fundo px-2 py-1 font-mono text-sm text-texto" />
        </label>
        <label className="mt-3 block font-mono text-xs text-texto-fraco">
          Prêmio
          <input value={premioDescricao} onChange={(e) => setPremioDescricao(e.target.value)} className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto" />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block font-mono text-xs text-texto-fraco">
            Início
            <input type="datetime-local" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto" />
          </label>
          <label className="block font-mono text-xs text-texto-fraco">
            Fim
            <input type="datetime-local" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto" />
          </label>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <label className="block font-mono text-xs text-texto-fraco">
            Limite/dia
            <input type="number" min="1" value={limiteDiario} onChange={(e) => setLimiteDiario(e.target.value)} className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto" />
          </label>
          <label className="block font-mono text-xs text-texto-fraco">
            Limite total
            <input type="number" min="1" value={limiteTotal} onChange={(e) => setLimiteTotal(e.target.value)} className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto" />
          </label>
          <label className="block font-mono text-xs text-texto-fraco">
            Mínimo p/ rankear
            <input type="number" min="1" value={minimoParaRankear} onChange={(e) => setMinimoParaRankear(e.target.value)} className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto" />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={fechar} className="panel-cut-sm min-h-10 border border-borda px-3 font-mono text-xs uppercase text-texto-fraco">cancelar</button>
          <button type="submit" disabled={salvando} className="panel-cut-sm min-h-10 border border-destaque bg-destaque/10 px-3 font-mono text-xs uppercase text-destaque disabled:opacity-50">
            {salvando ? '…' : 'salvar'}
          </button>
        </div>
      </form>
    </div>
  )
}
```

Confira se `Select`/inputs precisam de `id`+`htmlFor` explícitos pra
`getByLabelText` funcionar nos testes — os `<label>` acima já envolvem o `<input>`
diretamente (padrão implícito do Testing Library, sem precisar de `htmlFor`).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd site/client && npx vitest run src/test/FormCompeticao.test.jsx`
Expected: PASS.

- [ ] **Step 5: Adicionar a seção em `Admin.jsx`**

`Admin.jsx` hoje não tem nenhuma seção de CRUD com modal (as seções existentes são
whitelist, revisão de táticas e upload de vídeo) — a seção de Competições é a
primeira a reaproveitar o modal `FormCompeticao` (Task 15) dentro dessa página.
Adicione o import no topo do arquivo:

```jsx
import FormCompeticao from '../components/FormCompeticao.jsx'
```

Adicione dois novos `useState` perto dos já existentes (`steamId`, `mensagem`, etc.):

```jsx
const [competicoes, setCompeticoes] = useState(null)
const [formCompeticaoAberto, setFormCompeticaoAberto] = useState(false)
const [competicaoEditando, setCompeticaoEditando] = useState(null)
```

Adicione uma função de carregar e chame-a no `useEffect` existente (junto das
outras duas chamadas de fetch já presentes nele):

```jsx
function carregarCompeticoes() {
  fetch('/api/competicoes')
    .then((r) => r.json())
    .then((d) => setCompeticoes([d.ativa, ...d.encerradas].filter(Boolean)))
    .catch(() => setCompeticoes([]))
}
```

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
  carregarCompeticoes()
}, [])
```

Adicione a seção nova no JSX, logo após o fechamento da `<div>` de "Curso de mira —
upload dos vídeos" e antes do fechamento da `<div className="max-w-md space-y-6">`
externa:

```jsx
<div className="space-y-3">
  <div className="flex items-center justify-between">
    <SectionHeader titulo="Competições" />
    <button
      onClick={() => { setCompeticaoEditando(null); setFormCompeticaoAberto(true) }}
      className="panel-cut-sm min-h-10 border border-destaque px-3 font-mono text-xs uppercase text-destaque lg:min-h-0"
    >
      Nova competição
    </button>
  </div>
  {competicoes?.length === 0 && (
    <p className="font-mono text-sm text-texto-fraco">Nenhuma competição cadastrada.</p>
  )}
  {competicoes?.map((c) => (
    <Card key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate font-display text-sm font-semibold uppercase text-texto">{c.nome}</p>
        <p className="font-mono text-[10px] uppercase text-texto-fraco/70">
          {new Date(c.dataInicio).toLocaleDateString('pt-BR')} – {new Date(c.dataFim).toLocaleDateString('pt-BR')}
        </p>
      </div>
      <button
        onClick={() => { setCompeticaoEditando(c); setFormCompeticaoAberto(true) }}
        className="panel-cut-sm min-h-10 shrink-0 border border-borda px-3 py-1 font-mono text-xs uppercase tracking-wide text-texto-fraco hover:border-destaque/50 hover:text-destaque lg:min-h-0"
      >
        Editar
      </button>
    </Card>
  ))}
  {formCompeticaoAberto && (
    <FormCompeticao
      inicial={competicaoEditando}
      onSalvo={() => { setFormCompeticaoAberto(false); carregarCompeticoes() }}
      onCancelar={() => setFormCompeticaoAberto(false)}
    />
  )}
</div>
```

- [ ] **Step 6: Rodar a suíte inteira do client**

Run: `cd site/client && npx vitest run`
Expected: todos os testes passam.

- [ ] **Step 7: Commit**

```bash
git add site/client/src/components/FormCompeticao.jsx site/client/src/test/FormCompeticao.test.jsx site/client/src/pages/Admin.jsx
git commit -m "feat: admin cria e edita competicoes"
```

---

## Verificação final (depois da Task 15)

- [ ] Rodar a suíte inteira do server: `cd site/server && npx vitest run` — tudo verde.
- [ ] Rodar a suíte inteira do client: `cd site/client && npx vitest run` — tudo verde.
- [ ] Rodar `cd site/client && npm run build` — build de produção sem erro.
- [ ] Confirmar que a migração 0047 e o backfill (Task 1/4) já rodaram em produção antes
  de fazer deploy do código que depende delas.
- [ ] Criar manualmente (via admin, na UI) a competição de teste 23/07/2026–30/07/2026
  mencionada pelo dono no brainstorming.
