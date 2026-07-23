# Integridade de Data no Upload Manual + Confirmação de Vencedor — Plano de Implementação

> **Para quem for executar:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans pra rodar este plano tarefa por tarefa. Passos usam checkbox (`- [ ]`) pra acompanhamento.

**Objetivo:** reduzir a janela de fraude de data em uploads manuais de demo (Valve, FACEIT
ou Gamers Club — qualquer plataforma enviada manualmente) com uma validação de tolerância
de 3 dias, e adicionar uma trava humana antes do prêmio ser liberado: o admin confirma
explicitamente o vencedor de uma competição (revisando os clipes dele, com destaque pros
que vieram de upload manual — data não verificada) antes do jogador conseguir enviar o
tradelink.

**Arquitetura:** validação de janela de data no endpoint de upload existente
(`site/server/src/routes/upload.js`), sem tabela nova; nova coluna
`competicoes.vencedor_confirmado_em` + rota nova de confirmação + guarda no envio de
tradelink já existente; UI de admin nova que lista os clipes do vencedor pendente,
sinalizando os que vieram de `matches.source = 'upload'` (única origem onde a data é
digitada pelo jogador, não verificada).

**Tech Stack:** Node/Express + `pg` (server), React + Vite + Tailwind (client),
Postgres/Supabase (migrations), Vitest + Testing Library (testes).

## Global Constraints

- Janela de tolerância de data no upload manual: **exatamente 3 dias** — `playedAt`
  (quando enviado) precisa satisfazer `agora - 3 dias <= playedAt <= agora`. Fora disso,
  400 tanto no client quanto no server; server é a fonte da verdade.
- `matches.source = 'upload'` é o **único** valor que indica "data digitada pelo jogador,
  não verificada" (migration `0001_schema_inicial.sql`, valores possíveis: `valve_mm` |
  `faceit` | `gc` | `upload` | `pro`). Qualquer outro valor é ingestão automática/oficial,
  confiável.
- `PUT /:id/tradelink` bloqueia (400, não só esconder no client) até
  `competicoes.vencedor_confirmado_em` não ser `null` — mesmo que o próprio vencedor tente
  direto pela API.
- **Migrações de banco em produção são aplicadas pelo CONTROLLER (humano/orquestrador),
  nunca por um subagente implementador.** A task de migração escreve o `.sql` e roda
  testes locais; aplicar em produção é passo manual do controller, documentado
  explicitamente na task.
- Referência: `docs/superpowers/specs/2026-07-23-integridade-data-upload-e-confirmacao-vencedor-design.md`
  (spec completa, aprovada).

---

### Task 1: Migração — coluna de confirmação de vencedor

**Files:**
- Create: `supabase/migrations/0050_confirmacao_vencedor.sql`
- Test: nenhum teste automatizado pra SQL puro — verificação é rodar a migração contra o
  banco e conferir a coluna (passo manual do controller, Step 2 abaixo).

**Interfaces:**
- Produces: coluna `competicoes.vencedor_confirmado_em` (timestamptz, nullable) — Tasks 4,
  5 e 6 dependem desse nome exato.

- [ ] **Step 1: Escrever a migração**

```sql
-- supabase/migrations/0050_confirmacao_vencedor.sql
-- Confirmacao manual do vencedor antes do tradelink
-- (docs/superpowers/specs/2026-07-23-integridade-data-upload-e-confirmacao-vencedor-design.md):
-- upload manual de demo aceita played_at digitado pelo jogador sem verificacao (o .dem nao
-- guarda data real em lugar nenhum) - o admin passa a confirmar manualmente o vencedor
-- (revisando os clipes, com destaque pros que vieram de upload manual) antes do jogador
-- conseguir enviar o tradelink e receber o premio.
alter table competicoes add column vencedor_confirmado_em timestamptz;
```

- [ ] **Step 2: Controller aplica a migração em produção**

O implementador desta task NÃO roda este passo — deixa marcado como pendente pro
controller. Comando de referência (mesmo padrão já usado nas migrações anteriores desta
sessão):

```bash
node -e "
const { Pool } = require('pg');
const fs = require('fs');
const dbUrl = fs.readFileSync('site/server/.env', 'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = fs.readFileSync('supabase/migrations/0050_confirmacao_vencedor.sql', 'utf8');
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
pool.query(sql).then(() => { console.log('0050 aplicada'); pool.end(); }).catch((e) => { console.error(e.message); pool.end(); });
"
```

Expected: `0050 aplicada`, sem erro.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0050_confirmacao_vencedor.sql
git commit -m "feat: migracao da coluna de confirmacao de vencedor"
```

---

### Task 2: Backend — janela de tolerância de data no upload manual

**Files:**
- Modify: `site/server/src/routes/upload.js:57-60`
- Test: `site/server/test/upload.test.js`

**Interfaces:**
- Consumes: nada de outra task.
- Produces: `POST /api/upload/upload-url` rejeita (400) `playedAt` fora da janela
  `[agora - 3 dias, agora]` — Task 3 (frontend) espelha essa mesma regra.

- [ ] **Step 1: Escrever os testes que falham**

Em `site/server/test/upload.test.js`, primeiro **atualizar** o teste existente
`'caminho feliz: insere na fila sem group_id e devolve a url assinada'` (linhas 72-86) —
ele usa uma data fixa (`'2026-07-09T20:15'`) que, com a nova validação, cai fora de
qualquer janela de tolerância relativa a "agora" na maioria das execuções. Trocar pra uma
data relativa:

```javascript
  it('caminho feliz: insere na fila sem group_id e devolve a url assinada', async () => {
    const { app, db } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const playedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'MinhaDemo.DEM', shareCode: 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee', playedAt })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('u1')
    expect(res.body.uploadUrl).toBe('https://r2.example/presigned-put')
    expect(res.body.key).toMatch(/^uploads-pendentes\/.+\.dem$/)
    const insert = db.query.mock.calls.find((c) => c[0].includes('insert into uploads_pendentes'))
    expect(insert[0]).not.toContain('group_id')
    expect(insert[1]).toEqual(['765', res.body.key, 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee', playedAt, null])
    expect(presignUpload).toHaveBeenCalledWith(expect.anything(), 'resenha-demos', res.body.key, 'application/octet-stream')
  })
```

Depois, adicionar três testes novos logo após o teste `'data inválida: 400'` (linhas
63-70):

```javascript
  it('data no futuro: 400', async () => {
    const { app } = appWith([])
    const futuro = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', playedAt: futuro })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/entre.*dias/i)
  })

  it('data mais de 3 dias no passado: 400', async () => {
    const { app } = appWith([])
    const antigo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', playedAt: antigo })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/entre.*dias/i)
  })

  it('data dentro da janela de 3 dias: aceita normalmente', async () => {
    const { app } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const recente = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .send({ filename: 'x.dem', playedAt: recente })
    expect(res.status).toBe(200)
  })
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd site/server && npx vitest run test/upload.test.js`
Expected: FAIL — os dois testes de janela (`data no futuro`, `data mais de 3 dias no
passado`) recebem 200 em vez de 400 (validação ainda não existe). O teste `caminho feliz`
atualizado já deve passar (não depende da validação nova pra passar, só não quebra com
ela).

- [ ] **Step 3: Implementar**

Em `site/server/src/routes/upload.js`, adicionar a constante e a validação logo depois da
checagem de formato existente (linhas 57-60):

```javascript
    const playedAt = String(req.body?.playedAt ?? '').trim()
    if (playedAt && !PLAYED_AT_RE.test(playedAt)) {
      return res.status(400).json({ erro: 'Data/hora inválida' })
    }
    // O .dem não guarda data real em lugar nenhum (confirmado lendo o demo.proto oficial
    // do CS2) — playedAt é sempre digitado pelo jogador. A janela de tolerância reduz a
    // fraude "óbvia" (baixar demo antiga, declarar uma data dentro do período de uma
    // competição em andamento) sem bloquear o caso legítimo (jogou há 1-2 dias, sobe
    // agora). Não elimina o risco — só reduz a superfície de abuso.
    if (playedAt) {
      const dataInformada = new Date(playedAt)
      const agora = new Date()
      const limiteAntigo = new Date(agora.getTime() - TOLERANCIA_DIAS * 24 * 60 * 60 * 1000)
      if (dataInformada > agora || dataInformada < limiteAntigo) {
        return res.status(400).json({
          erro: `A data informada precisa estar entre ${TOLERANCIA_DIAS} dias atrás e agora.`,
        })
      }
    }
```

E adicionar a constante `TOLERANCIA_DIAS` no topo do arquivo, junto das outras constantes
(depois de `PLATAFORMAS_MANUAIS`, linha 11):

```javascript
const TOLERANCIA_DIAS = 3
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/server && npx vitest run test/upload.test.js`
Expected: PASS (arquivo inteiro).

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/upload.js site/server/test/upload.test.js
git commit -m "feat: valida janela de tolerancia de data no upload manual de demo"
```

---

### Task 3: Frontend — validação de data no formulário de upload

**Files:**
- Modify: `site/client/src/pages/EnviarDemo.jsx`
- Test: `site/client/src/test/EnviarDemo.test.jsx` (novo arquivo)

**Interfaces:**
- Consumes: `POST /api/upload/upload-url` (Task 2) — mesma regra de janela de 3 dias,
  espelhada aqui só pra feedback imediato (servidor continua sendo a fonte da verdade).

- [ ] **Step 1: Escrever os testes que falham**

Criar `site/client/src/test/EnviarDemo.test.jsx`:

```javascript
// site/client/src/test/EnviarDemo.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EnviarDemo from '../pages/EnviarDemo.jsx'

function arquivoFalso(nome = 'partida.dem') {
  return new File(['conteudo'], nome, { type: 'application/octet-stream' })
}

function paraDatetimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function mockFetchSucesso() {
  global.fetch = vi.fn().mockImplementation((url) => {
    if (url === '/api/upload/upload-url') {
      return Promise.resolve({ ok: true, json: async () => ({ id: 'u1', uploadUrl: 'https://r2.example/put', key: 'uploads-pendentes/x.dem' }) })
    }
    return Promise.resolve({ ok: true })
  })
}

describe('EnviarDemo', () => {
  it('bloqueia envio com data no futuro', async () => {
    global.fetch = vi.fn()
    const { container } = render(<EnviarDemo />)
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [arquivoFalso()] } })
    const futuro = new Date(Date.now() + 24 * 60 * 60 * 1000)
    fireEvent.change(screen.getByLabelText(/quando foi jogada/i), { target: { value: paraDatetimeLocal(futuro) } })
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await waitFor(() => expect(screen.getByText(/precisa estar entre/i)).toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('bloqueia envio com data mais de 3 dias no passado', async () => {
    global.fetch = vi.fn()
    const { container } = render(<EnviarDemo />)
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [arquivoFalso()] } })
    const antigo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
    fireEvent.change(screen.getByLabelText(/quando foi jogada/i), { target: { value: paraDatetimeLocal(antigo) } })
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await waitFor(() => expect(screen.getByText(/precisa estar entre/i)).toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('aceita data dentro da janela de 3 dias', async () => {
    mockFetchSucesso()
    const { container } = render(<EnviarDemo />)
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [arquivoFalso()] } })
    const recente = new Date(Date.now() - 24 * 60 * 60 * 1000)
    fireEvent.change(screen.getByLabelText(/quando foi jogada/i), { target: { value: paraDatetimeLocal(recente) } })
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await waitFor(() => expect(screen.getByText(/envio recebido/i)).toBeInTheDocument())
  })

  it('sem data preenchida (campo opcional): envia normalmente', async () => {
    mockFetchSucesso()
    const { container } = render(<EnviarDemo />)
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [arquivoFalso()] } })
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }))
    await waitFor(() => expect(screen.getByText(/envio recebido/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd site/client && npx vitest run src/test/EnviarDemo.test.jsx`
Expected: FAIL — os dois testes de bloqueio esperam a mensagem de erro e `fetch` não
chamado, mas hoje o componente chama `fetch` direto, sem validar a janela.

- [ ] **Step 3: Implementar**

Em `site/client/src/pages/EnviarDemo.jsx`, adicionar a constante logo abaixo de
`TENTATIVAS_POR_PARTE` (linha 8):

```javascript
const TOLERANCIA_DIAS = 3
```

Modificar `enviar` (linhas 40-72) pra validar antes de chamar `fetch`:

```javascript
  async function enviar(e) {
    e.preventDefault()
    if (!arquivo) return
    if (playedAt) {
      const dataInformada = new Date(playedAt)
      const agora = new Date()
      const limiteAntigo = new Date(agora.getTime() - TOLERANCIA_DIAS * 24 * 60 * 60 * 1000)
      if (dataInformada > agora || dataInformada < limiteAntigo) {
        setErro(`A data informada precisa estar entre ${TOLERANCIA_DIAS} dias atrás e agora.`)
        return
      }
    }
    setEnviando(true)
    setErro(null)
    setResultado(null)
    try {
      const resUrl = await fetch('/api/upload/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: arquivo.name, tamanho: arquivo.size, shareCode, playedAt, plataformaManual: plataforma }),
      })
      const bodyUrl = await resUrl.json().catch(() => ({}))
      if (!resUrl.ok) {
        setErro(bodyUrl.erro ?? 'Erro ao preparar o envio')
        return
      }
      const resPut = await fetch(bodyUrl.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: arquivo,
      })
      if (!resPut.ok) {
        setErro('Falha ao enviar o arquivo pro armazenamento')
        return
      }
      setResultado(true)
    } catch {
      setErro('Falha de rede ao enviar')
    } finally {
      setEnviando(false)
    }
  }
```

(Única mudança real: o bloco `if (playedAt) { ... }` inserido antes de `setEnviando(true)`
— o resto da função é idêntico ao original.)

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/client && npx vitest run src/test/EnviarDemo.test.jsx`
Expected: PASS (arquivo inteiro).

- [ ] **Step 5: Commit**

```bash
git add site/client/src/pages/EnviarDemo.jsx site/client/src/test/EnviarDemo.test.jsx
git commit -m "feat: valida janela de tolerancia de data no formulario de envio de demo"
```

---

### Task 4: Backend — confirmação de vencedor + trava no tradelink

**Files:**
- Modify: `site/server/src/routes/competicoes.js:21-29` (`mapCompeticao`), `:106-113`
  (query de `GET /`), adicionar rota nova, `:317-328` (`PUT /:id/tradelink`)
- Test: `site/server/test/competicoes.test.js`

**Interfaces:**
- Consumes: coluna `vencedor_confirmado_em` (Task 1).
- Produces: `mapCompeticao` inclui `vencedorConfirmado: boolean` — Task 6 (frontend)
  depende desse campo. Rota nova `PUT /api/competicoes/:id/confirmar-vencedor` — Task 7
  (frontend admin) depende desse path exato.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar dentro de `describe('PUT /api/competicoes/:id/tradelink', ...)`, um novo teste
logo depois de `'competicao ainda ativa (nao encerrou): 400'`:

```javascript
  it('vencedor sem confirmacao do admin: 400', async () => {
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: '2026-07-01', vencedor_steam_id64: '765', vencedor_confirmado_em: null }]],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/tradelink`).set('Cookie', cookieJogador).send({ tradelink: 'https://steamcommunity.com/tradeoffer/x' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/confirma[çc][ãa]o/i)
  })
```

Modificar o teste existente `'o proprio vencedor consegue gravar'` (dentro do mesmo
describe) — hoje o mock não inclui `vencedor_confirmado_em`, então com a trava nova esse
teste passaria a receber 400 em vez de 200. Adicionar o campo confirmado:

```javascript
  it('o proprio vencedor consegue gravar', async () => {
    const { app, db } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: '2026-07-01', vencedor_steam_id64: '765', vencedor_confirmado_em: '2026-07-02T00:00:00Z' }]],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/tradelink`).set('Cookie', cookieJogador).send({ tradelink: 'https://steamcommunity.com/tradeoffer/x' })
    expect(res.status).toBe(200)
    const update = db.query.mock.calls.find((sql) => sql.includes('update competicoes set tradelink_vencedor'))
    expect(update).toBeTruthy()
  })
```

Adicionar um novo `describe` no final do arquivo:

```javascript
describe('PUT /api/competicoes/:id/confirmar-vencedor', () => {
  const COMP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

  it('jogador comum: 403', async () => {
    const { app } = appWith([])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/confirmar-vencedor`).set('Cookie', cookieJogador)
    expect(res.status).toBe(403)
  })

  it('id nao-uuid: 404', async () => {
    const { app } = appWith([])
    const res = await request(app).put('/api/competicoes/abc/confirmar-vencedor').set('Cookie', cookieAdmin)
    expect(res.status).toBe(404)
  })

  it('competicao ainda ativa: 400', async () => {
    const noFuturo = new Date(Date.now() + 86400000).toISOString()
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: noFuturo, vencedor_steam_id64: null, minimo_para_rankear: 1 }]],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/confirmar-vencedor`).set('Cookie', cookieAdmin)
    expect(res.status).toBe(400)
  })

  it('sem vencedor calculado: 400', async () => {
    const noPassado = new Date(Date.now() - 86400000).toISOString()
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: noPassado, vencedor_steam_id64: null, minimo_para_rankear: 1 }]],
      ['from competicao_submissoes cs join', []],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/confirmar-vencedor`).set('Cookie', cookieAdmin)
    expect(res.status).toBe(400)
  })

  it('vencedor calculado: confirma com sucesso', async () => {
    const noPassado = new Date(Date.now() - 86400000).toISOString()
    const { app, db } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: noPassado, vencedor_steam_id64: '765', minimo_para_rankear: 1 }]],
      ['update competicoes set vencedor_confirmado_em', [{ id: COMP_ID }]],
    ])
    const res = await request(app).put(`/api/competicoes/${COMP_ID}/confirmar-vencedor`).set('Cookie', cookieAdmin)
    expect(res.status).toBe(200)
    const update = db.query.mock.calls.find(([sql]) => sql.includes('update competicoes set vencedor_confirmado_em'))
    expect(update).toBeTruthy()
  })

  it('confirmar duas vezes: idempotente, sempre 200', async () => {
    const noPassado = new Date(Date.now() - 86400000).toISOString()
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_fim: noPassado, vencedor_steam_id64: '765', minimo_para_rankear: 1 }]],
      ['update competicoes set vencedor_confirmado_em', [{ id: COMP_ID }]],
    ])
    const res1 = await request(app).put(`/api/competicoes/${COMP_ID}/confirmar-vencedor`).set('Cookie', cookieAdmin)
    const res2 = await request(app).put(`/api/competicoes/${COMP_ID}/confirmar-vencedor`).set('Cookie', cookieAdmin)
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
  })
})
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd site/server && npx vitest run test/competicoes.test.js -t "confirmar-vencedor|tradelink"`
Expected: FAIL — `describe('PUT .../confirmar-vencedor', ...)` inteiro falha (rota não
existe, tudo 404); `'vencedor sem confirmacao do admin: 400'` falha (recebe 200, trava não
existe ainda).

- [ ] **Step 3: Implementar**

Em `site/server/src/routes/competicoes.js`, modificar `mapCompeticao` (linhas 21-29):

```javascript
function mapCompeticao(c) {
  return {
    id: c.id, nome: c.nome, descricao: c.descricao, premioDescricao: c.premio_descricao,
    premioImagemUrl: c.premio_imagem_url, premioMercadoUrl: c.premio_mercado_url,
    dataInicio: c.data_inicio, dataFim: c.data_fim,
    limiteDiario: c.limite_diario, limiteTotal: c.limite_total, minimoParaRankear: c.minimo_para_rankear,
    vencedorSteamId: c.vencedor_steam_id64, vencedorConfirmado: c.vencedor_confirmado_em != null,
  }
}
```

Adicionar `vencedor_confirmado_em` na query de `GET /'` (linhas 107-113):

```javascript
  router.get('/', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      `select id, nome, descricao, premio_descricao, premio_imagem_url, premio_mercado_url,
              data_inicio, data_fim,
              limite_diario, limite_total, minimo_para_rankear, vencedor_steam_id64, tradelink_vencedor,
              vencedor_confirmado_em
       from competicoes
       order by data_inicio desc`,
    )
```

Adicionar a rota nova logo antes de `router.put('/:id/tradelink', ...)` (linha 317):

```javascript
  router.put('/:id/confirmar-vencedor', requireAuth, requireSuperAdmin, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'competição não encontrada' })
    const { rows } = await db.query(
      'select id, data_fim, vencedor_steam_id64, minimo_para_rankear from competicoes where id = $1',
      [req.params.id],
    )
    if (!rows.length) return res.status(404).json({ erro: 'competição não encontrada' })
    const comp = rows[0]
    if (new Date() <= new Date(comp.data_fim)) return res.status(400).json({ erro: 'a competição ainda não encerrou' })
    const vencedorSteamId = await calcularOuLerVencedor(db, comp)
    if (!vencedorSteamId) return res.status(400).json({ erro: 'essa competição não tem vencedor' })
    await db.query(
      'update competicoes set vencedor_confirmado_em = coalesce(vencedor_confirmado_em, now()) where id = $1',
      [req.params.id],
    )
    res.json({ ok: true })
  })

```

Modificar `PUT /:id/tradelink` (linhas 317-328) — adicionar `vencedor_confirmado_em` na
query e a trava logo depois da checagem de identidade do vencedor:

```javascript
  router.put('/:id/tradelink', requireAuth, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'competição não encontrada' })
    const { rows } = await db.query('select id, data_fim, vencedor_steam_id64, vencedor_confirmado_em from competicoes where id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ erro: 'competição não encontrada' })
    const comp = rows[0]
    if (new Date() <= new Date(comp.data_fim)) return res.status(400).json({ erro: 'a competição ainda não encerrou' })
    if (req.player.steamId !== comp.vencedor_steam_id64) return res.status(403).json({ erro: 'só o vencedor pode informar o tradelink' })
    if (!comp.vencedor_confirmado_em) return res.status(400).json({ erro: 'aguardando confirmação do admin' })
    const tradelink = String(req.body?.tradelink ?? '').trim()
    if (!tradelink) return res.status(400).json({ erro: 'tradelink obrigatório' })
    await db.query('update competicoes set tradelink_vencedor = $1 where id = $2', [tradelink, req.params.id])
    res.json({ ok: true })
  })
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/server && npx vitest run test/competicoes.test.js`
Expected: PASS (arquivo inteiro).

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/competicoes.js site/server/test/competicoes.test.js
git commit -m "feat: rota de confirmacao de vencedor + trava no envio de tradelink"
```

---

### Task 5: Backend — clipes do vencedor pra revisão do admin (`GET /`)

**Files:**
- Modify: `site/server/src/routes/competicoes.js` (nova função, wiring em `montar`)
- Test: `site/server/test/competicoes.test.js`

**Interfaces:**
- Consumes: `vencedorConfirmado`/`vencedor_confirmado_em` (Task 4).
- Produces: campo `vencedorSubmissoes` no payload de `GET /` (array de
  `{ id, clipUrl, clipSnapshotUrl, pontuacao, origemNaoVerificada, plataformaManual }`),
  presente só pro vencedor/admin, só enquanto não confirmado — Task 7 (frontend admin)
  depende desse nome de campo e desses nomes de propriedade exatos.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final do `describe('GET /api/competicoes', ...)`:

```javascript
  it('inclui vencedorSubmissoes pro admin quando ha vencedor nao confirmado, com origemNaoVerificada por source', async () => {
    const agora = new Date()
    const { app } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: '',
        data_inicio: new Date(agora.getTime() - 172800000), data_fim: new Date(agora.getTime() - 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 1, vencedor_steam_id64: '999',
        vencedor_confirmado_em: null,
      }]],
      ['m.plataforma_manual', [
        { id: 'clip1', clip_url: 'https://x/clip1', clip_snapshot_url: null, pontuacao_total: 100, pontuacao_detalhe: null, enviado_em: agora, source: 'upload', plataforma_manual: 'gamers_club' },
      ]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieAdmin)
    const comp = res.body.encerradas[0]
    expect(comp.vencedorSubmissoes).toHaveLength(1)
    expect(comp.vencedorSubmissoes[0].origemNaoVerificada).toBe(true)
    expect(comp.vencedorSubmissoes[0].plataformaManual).toBe('gamers_club')
  })

  it('nao inclui vencedorSubmissoes depois que o vencedor ja foi confirmado', async () => {
    const agora = new Date()
    const { app } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: '',
        data_inicio: new Date(agora.getTime() - 172800000), data_fim: new Date(agora.getTime() - 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 1, vencedor_steam_id64: '999',
        vencedor_confirmado_em: agora,
      }]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieAdmin)
    const comp = res.body.encerradas[0]
    expect(comp.vencedorSubmissoes).toBeUndefined()
  })

  it('vencedorSubmissoes nao aparece pra jogador que nao e o vencedor nem admin', async () => {
    const agora = new Date()
    const { app } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: '',
        data_inicio: new Date(agora.getTime() - 172800000), data_fim: new Date(agora.getTime() - 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 1, vencedor_steam_id64: '999',
        vencedor_confirmado_em: null,
      }]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    const comp = res.body.encerradas[0]
    expect(comp.vencedorSubmissoes).toBeUndefined()
  })
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd site/server && npx vitest run test/competicoes.test.js -t "vencedorSubmissoes"`
Expected: FAIL — `comp.vencedorSubmissoes` é `undefined` em todos os casos (campo ainda
não existe).

- [ ] **Step 3: Implementar**

Em `site/server/src/routes/competicoes.js`, adicionar a função nova logo depois de
`buscarClipesRecentes` (depois da linha 99, antes de
`export function createCompeticoesRouter`):

```javascript
// Clipes do vencedor pendente de confirmação (Task de integridade de data) — usado só na
// tela de admin pra revisar antes de liberar o tradelink. Diferente de buscarClipesRecentes
// (últimos 20 da competição inteira, sem filtro de plataforma), aqui é só do vencedor,
// sem limite (total já é limitado por competicoes.limite_total), com o join em matches
// pra saber a origem — join (não left join) é seguro porque toda linha de
// competicao_submissoes referencia um allstar_clip com match_id válido.
async function buscarSubmissoesDoJogador(db, competicaoId, steamId64) {
  const { rows } = await db.query(
    `select ac.id, ac.clip_url, ac.clip_snapshot_url, ac.pontuacao_total, ac.pontuacao_detalhe,
            cs.enviado_em, m.source, m.plataforma_manual
     from competicao_submissoes cs
     join allstar_clips ac on ac.id = cs.allstar_clip_id
     join matches m on m.id = ac.match_id
     where cs.competicao_id = $1 and cs.steam_id64 = $2
     order by cs.enviado_em desc`,
    [competicaoId, steamId64],
  )
  return rows.map((r) => ({
    id: r.id, clipUrl: r.clip_url, clipSnapshotUrl: r.clip_snapshot_url,
    pontuacao: r.pontuacao_detalhe ?? { total: r.pontuacao_total ?? 0 },
    // source='upload' é o único caso onde played_at foi digitado pelo jogador (não
    // verificado) — os outros (valve_mm/faceit/pro) vêm de fonte automática/oficial.
    origemNaoVerificada: r.source === 'upload',
    plataformaManual: r.plataforma_manual,
  }))
}
```

Modificar `montar(c)` dentro de `router.get('/', ...)` (linhas 115-128):

```javascript
    async function montar(c) {
      const vencedorSteamId = await calcularOuLerVencedor(db, c)
      const leaderboard = await buscarLeaderboard(db, c.id, c.minimo_para_rankear)
      const clipesRecentes = await buscarClipesRecentes(db, c.id)
      const ehVencedorOuAdmin = req.player.steamId === vencedorSteamId || req.player.isSuperAdmin
      const vencedorNaoConfirmado = Boolean(vencedorSteamId) && !c.vencedor_confirmado_em
      return {
        ...mapCompeticao({ ...c, vencedor_steam_id64: vencedorSteamId }),
        leaderboard,
        clipesRecentes,
        // #6/#12 da auditoria: tradelink só aparece pro próprio vencedor ou admin —
        // omitido da resposta (não só escondido no client) pra qualquer outro jogador.
        ...(ehVencedorOuAdmin ? { tradelinkVencedor: c.tradelink_vencedor } : {}),
        ...(ehVencedorOuAdmin && vencedorNaoConfirmado
          ? { vencedorSubmissoes: await buscarSubmissoesDoJogador(db, c.id, vencedorSteamId) }
          : {}),
      }
    }
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/server && npx vitest run test/competicoes.test.js`
Expected: PASS (arquivo inteiro).

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/competicoes.js site/server/test/competicoes.test.js
git commit -m "feat: GET /api/competicoes expoe clipes do vencedor pra revisao do admin"
```

---

### Task 6: Frontend — bloqueia tradelink até confirmação (`Competicoes.jsx`)

**Files:**
- Modify: `site/client/src/pages/Competicoes.jsx:96-114`
- Test: `site/client/src/test/Competicoes.test.jsx`

**Interfaces:**
- Consumes: `comp.vencedorConfirmado` (Task 4).

- [ ] **Step 1: Escrever os testes que falham**

Modificar o teste existente `'competicao encerrada com vencedor e tradelink liberado pro
proprio vencedor'` — adicionar `vencedorConfirmado: true` ao objeto da competição mockada
(sem essa mudança, com o gate novo, esse teste passaria a falhar):

```javascript
  it('competicao encerrada com vencedor e tradelink liberado pro proprio vencedor', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/api/auth/me')) {
        return Promise.resolve({ ok: true, json: async () => ({ steamId: '765', nick: 'bronze', isSuperAdmin: false }) })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ativa: null,
          encerradas: [{
            id: 'comp1', nome: 'Semana 1', premioDescricao: 'Skin', dataFim: new Date(Date.now() - 86400000).toISOString(),
            limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 1,
            vencedorSteamId: '765', vencedorConfirmado: true, tradelinkVencedor: null,
            leaderboard: [{ steamId: '765', nick: 'bronze', avatarUrl: null, total: 300, qualificado: true }],
          }],
        }),
      })
    })
    render(<AuthProvider><Competicoes /></AuthProvider>)
    await waitFor(() => expect(screen.getByText(/voc[êe] venceu/i)).toBeInTheDocument())
    expect(screen.getByPlaceholderText(/tradelink/i)).toBeInTheDocument()
  })
```

Adicionar um teste novo logo depois, no mesmo `describe`:

```javascript
  it('vencedor mas ainda nao confirmado pelo admin: mostra aguardando, nao o formulario', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/api/auth/me')) {
        return Promise.resolve({ ok: true, json: async () => ({ steamId: '765', nick: 'bronze', isSuperAdmin: false }) })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ativa: null,
          encerradas: [{
            id: 'comp1', nome: 'Semana 1', premioDescricao: 'Skin', dataFim: new Date(Date.now() - 86400000).toISOString(),
            limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 1,
            vencedorSteamId: '765', vencedorConfirmado: false, tradelinkVencedor: null,
            leaderboard: [{ steamId: '765', nick: 'bronze', avatarUrl: null, total: 300, qualificado: true }],
          }],
        }),
      })
    })
    render(<AuthProvider><Competicoes /></AuthProvider>)
    await waitFor(() => expect(screen.getByText(/aguardando confirma[çc][ãa]o/i)).toBeInTheDocument())
    expect(screen.queryByPlaceholderText(/tradelink/i)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd site/client && npx vitest run src/test/Competicoes.test.jsx`
Expected: FAIL — o teste `'vencedor mas ainda nao confirmado...'` não encontra o texto
"aguardando confirmação" (gate ainda não existe, o formulário aparece direto).

- [ ] **Step 3: Implementar**

Em `site/client/src/pages/Competicoes.jsx`, substituir o bloco de tradelink dentro de
`CardCompeticao` (linhas 96-114):

```jsx
      {souVencedor && encerrada && comp.vencedorConfirmado && !comp.tradelinkVencedor && (
        <form onSubmit={enviarTradelink} className="mt-4 panel-cut-sm border border-destaque bg-destaque/10 p-3">
          <p className="font-mono text-sm text-destaque">🏆 Você venceu! Informe seu tradelink pra receber o prêmio.</p>
          <div className="mt-2 flex gap-2">
            <input
              value={tradelink}
              onChange={(e) => setTradelink(e.target.value)}
              placeholder="Seu tradelink da Steam"
              className="min-h-10 flex-1 border border-borda bg-superficie px-2 font-mono text-xs text-texto"
            />
            <button disabled={enviando} className="panel-cut-sm border border-destaque px-3 font-mono text-xs uppercase text-destaque">
              {enviando ? '…' : 'Enviar'}
            </button>
          </div>
        </form>
      )}
      {souVencedor && encerrada && !comp.vencedorConfirmado && (
        <p className="mt-4 font-mono text-sm text-texto-fraco">
          Você está na liderança — aguardando confirmação do admin antes de liberar o envio do tradelink.
        </p>
      )}
      {souVencedor && comp.tradelinkVencedor && (
        <p className="mt-4 font-mono text-sm text-sucesso">Tradelink enviado — aguarde o contato pro envio do prêmio.</p>
      )}
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/client && npx vitest run src/test/Competicoes.test.jsx`
Expected: PASS (arquivo inteiro).

- [ ] **Step 5: Commit**

```bash
git add site/client/src/pages/Competicoes.jsx site/client/src/test/Competicoes.test.jsx
git commit -m "feat: bloqueia formulario de tradelink ate o admin confirmar o vencedor"
```

---

### Task 7: Frontend — card de confirmação de vencedor (`Admin.jsx`)

**Files:**
- Modify: `site/client/src/pages/Admin.jsx:207-243`
- Test: `site/client/src/test/Admin.test.jsx`

**Interfaces:**
- Consumes: `c.vencedorSteamId`, `c.vencedorConfirmado`, `c.vencedorSubmissoes`,
  `c.leaderboard` (Tasks 4-5) — todos já chegam no payload de `carregarCompeticoes()`
  (`GET /api/competicoes`), sem mudança na função de fetch.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar um novo `describe` no final de `site/client/src/test/Admin.test.jsx` (depois do
`describe('Admin — curso de mira', ...)`):

```javascript
function mockFetchComCompeticoes(competicoesResposta) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
    if (url === '/api/taticas?status=sugerida') return Promise.resolve({ ok: true, json: async () => [] })
    if (url === '/api/curso') return Promise.resolve({ ok: true, json: async () => [] })
    if (url === '/api/competicoes') return Promise.resolve({ ok: true, json: async () => competicoesResposta })
    return Promise.resolve({ ok: true, json: async () => [] })
  }))
}

describe('Admin — confirmação de vencedor', () => {
  it('mostra o card de confirmação com os clipes do vencedor, destacando os de upload manual', async () => {
    mockFetchComCompeticoes({
      ativa: null, agendadas: [],
      encerradas: [{
        id: 'comp1', nome: 'Semana 1', dataInicio: '2026-07-01T00:00:00Z', dataFim: '2026-07-08T00:00:00Z',
        vencedorSteamId: '999', vencedorConfirmado: false,
        leaderboard: [{ steamId: '999', nick: 'troya', avatarUrl: null, total: 300, qualificado: true }],
        vencedorSubmissoes: [
          { id: 'clip1', clipUrl: 'https://x/clip1', pontuacao: { total: 300 }, origemNaoVerificada: true, plataformaManual: 'gamers_club' },
        ],
      }],
    })
    render(<Admin />)
    expect(await screen.findByText(/vencedor: troya/i)).toBeInTheDocument()
    expect(screen.getByText(/upload manual/i)).toBeInTheDocument()
    expect(screen.getByText(/gamers_club/i)).toBeInTheDocument()
  })

  it('sem vencedor pendente: nao mostra nenhum card de confirmacao', async () => {
    mockFetchComCompeticoes({
      ativa: null, agendadas: [],
      encerradas: [{
        id: 'comp1', nome: 'Semana 1', dataInicio: '2026-07-01T00:00:00Z', dataFim: '2026-07-08T00:00:00Z',
        vencedorSteamId: null, vencedorConfirmado: false,
        leaderboard: [],
      }],
    })
    render(<Admin />)
    expect(await screen.findByText('Semana 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /confirmar vencedor/i })).not.toBeInTheDocument()
  })

  it('confirma o vencedor e o card some depois de recarregar', async () => {
    let confirmado = false
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url, opts) => {
      if (url === '/api/taticas?status=sugerida') return Promise.resolve({ ok: true, json: async () => [] })
      if (url === '/api/curso') return Promise.resolve({ ok: true, json: async () => [] })
      if (url === '/api/competicoes') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ativa: null, agendadas: [],
            encerradas: [{
              id: 'comp1', nome: 'Semana 1', dataInicio: '2026-07-01T00:00:00Z', dataFim: '2026-07-08T00:00:00Z',
              vencedorSteamId: '999', vencedorConfirmado: confirmado,
              leaderboard: [{ steamId: '999', nick: 'troya', avatarUrl: null, total: 300, qualificado: true }],
              ...(confirmado ? {} : { vencedorSubmissoes: [] }),
            }],
          }),
        })
      }
      if (url === '/api/competicoes/comp1/confirmar-vencedor' && opts?.method === 'PUT') {
        confirmado = true
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    }))
    render(<Admin />)
    const botao = await screen.findByRole('button', { name: /confirmar vencedor/i })
    fireEvent.click(botao)
    await waitFor(() => expect(screen.queryByRole('button', { name: /confirmar vencedor/i })).not.toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd site/client && npx vitest run src/test/Admin.test.jsx -t "confirmação de vencedor"`
Expected: FAIL — nenhum card de confirmação existe ainda, `findByText(/vencedor: troya/i)`
nunca resolve.

- [ ] **Step 3: Implementar**

Em `site/client/src/pages/Admin.jsx`, adicionar a função `confirmarVencedor` logo depois
de `carregarCompeticoes` (depois da linha 50):

```javascript
  async function confirmarVencedor(id) {
    const res = await fetch(`/api/competicoes/${id}/confirmar-vencedor`, { method: 'PUT' })
    if (res.ok) carregarCompeticoes()
  }
```

Substituir o `.map` de competições (linhas 220-235) por uma versão com corpo de função
(pra derivar `vencedorNick` do leaderboard) e o card de confirmação novo:

```jsx
        {competicoes?.map((c) => {
          const vencedorNick = c.leaderboard?.find((l) => l.steamId === c.vencedorSteamId)?.nick
          return (
            <Card key={c.id} className="space-y-2 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
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
              </div>
              {c.vencedorSteamId && !c.vencedorConfirmado && (
                <div className="panel-cut-sm border border-destaque bg-destaque/10 p-3">
                  <p className="font-mono text-sm text-destaque">
                    Vencedor: {vencedorNick ?? c.vencedorSteamId} — confira os clipes antes de confirmar.
                  </p>
                  <div className="mt-2 space-y-1">
                    {c.vencedorSubmissoes?.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2 font-mono text-xs text-texto-fraco">
                        <a href={s.clipUrl} target="_blank" rel="noreferrer" className="truncate hover:text-destaque">
                          clipe · {s.pontuacao.total} pts
                        </a>
                        {s.origemNaoVerificada && (
                          <span className="shrink-0 text-perigo">
                            ⚠️ upload manual{s.plataformaManual ? ` — ${s.plataformaManual}` : ''} — data não verificada
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => confirmarVencedor(c.id)}
                    className="panel-cut-sm mt-2 min-h-10 border border-destaque px-3 font-mono text-xs uppercase text-destaque lg:min-h-0"
                  >
                    Confirmar vencedor
                  </button>
                </div>
              )}
            </Card>
          )
        })}
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/client && npx vitest run src/test/Admin.test.jsx`
Expected: PASS (arquivo inteiro, incluindo os testes de "curso de mira" já existentes).

- [ ] **Step 5: Commit**

```bash
git add site/client/src/pages/Admin.jsx site/client/src/test/Admin.test.jsx
git commit -m "feat: card de confirmacao de vencedor na tela de admin"
```

---

### Task 8: Regressão completa

**Files:** nenhum arquivo novo — só verificação.

**Interfaces:** nenhuma.

- [ ] **Step 1: Rodar a suíte inteira do servidor**

Run: `cd site/server && npx vitest run`
Expected: PASS, sem nenhum teste quebrado.

- [ ] **Step 2: Rodar a suíte inteira do client**

Run: `cd site/client && npx vitest run`
Expected: PASS, sem nenhum teste quebrado.

- [ ] **Step 3: Confirmar que a migração 0050 foi aplicada em produção (Task 1, Step 2)**

Se ainda pendente, esse é o momento de rodar — sem a coluna `vencedor_confirmado_em` no
banco real, `GET /api/competicoes` em produção quebra com 500 assim que o deploy do
código da Task 4 for pro ar (a query passa a selecionar uma coluna que não existe).

- [ ] **Step 4: Commit final (se sobrar algo solto)**

```bash
git status --short
```

Se tudo já foi commitado nas tasks anteriores, não há nada a fazer aqui — este step é só
a rede de segurança pra pegar qualquer arquivo esquecido antes de considerar o plano
concluído.
