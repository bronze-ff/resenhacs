# Prêmio (imagem/link) + Indicador de Competição Ativa — Plano de Implementação

> **Para quem for executar:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans pra rodar este plano tarefa por tarefa. Passos usam checkbox (`- [ ]`) pra acompanhamento.

**Objetivo:** admin passa a poder colar uma imagem da skin premiada e o link dela no mercado da Steam ao criar/editar uma competição (exibidos no card público); e o app passa a chamar atenção do usuário pra uma competição ativa via um ponto pulsante na sidebar desktop e na barra inferior mobile (que também é redefinida pra mostrar as 4 abas mais usadas no dia a dia).

**Arquitetura:** duas colunas novas em `competicoes` (link de imagem, link de mercado), validação server-side reaproveitando o padrão já existente de `POST/PUT /api/competicoes/admin`; um endpoint leve novo (`GET /api/competicoes/status`) só pra "existe competição ativa?", consumido por `Shell.jsx` via polling (mesmo padrão já usado em `Feed.jsx` pro aviso de sincronização) pra acender o indicador na sidebar e trocar dinamicamente um item da barra inferior mobile.

**Tech Stack:** Node/Express + `pg` (server), React + Vite + Tailwind (client), Postgres/Supabase (migrations), Vitest + Testing Library (testes).

## Global Constraints

- `premioImagemUrl` e `premioMercadoUrl` são **obrigatórios** ao criar uma competição (`POST /admin`); em edição (`PUT /admin/:id`) são opcionais no request (update parcial, `coalesce`), mas se enviados passam pela mesma validação.
- `premioMercadoUrl` precisa começar com `https://steamcommunity.com/market/` — qualquer outro domínio é 400, tanto no client quanto no server (server é a fonte da verdade).
- O indicador de competição ativa fica **sempre visível** enquanto a competição estiver ativa — não é notificação "lida/não lida" por jogador, não há estado por usuário a persistir.
- Barra inferior mobile (base, sem competição ativa): **Partidas, Ranking, Clipes, Comparar**. Com competição ativa: **Comparar** é temporariamente substituído por **Competições** (mesmo indicador visual da sidebar). Granadas/Táticas continuam acessíveis via "Mais", só saem da barra fixa.
- **Migrações de banco em produção são aplicadas pelo CONTROLLER (humano/orquestrador), nunca por um subagente implementador.** Cada task de migração escreve o `.sql` e roda testes locais; aplicar em produção é passo manual do controller, documentado explicitamente na task.
- Toda rota nova segue o padrão já estabelecido: `requireAuth` pra leitura de jogador comum, `requireSuperAdmin` (reconsulta `is_super_admin` no banco) pra escrita de admin — nunca só esconder botão no client.
- Referências: `docs/superpowers/specs/2026-07-23-premio-imagem-competicao-design.md` e `docs/superpowers/specs/2026-07-23-indicador-competicao-ativa-design.md` (specs completas, aprovadas).

---

### Task 1: Migração — colunas de imagem/link do prêmio

**Files:**
- Create: `supabase/migrations/0049_competicao_premio_imagem.sql`
- Test: nenhum teste automatizado pra SQL puro — verificação é rodar a migração contra o banco e conferir as colunas (passo manual do controller, Step 2 abaixo).

**Interfaces:**
- Produces: colunas `competicoes.premio_imagem_url` (text, nullable) e `competicoes.premio_mercado_url` (text, nullable) — Task 2 depende desses nomes exatos.

- [ ] **Step 1: Escrever a migração**

```sql
-- supabase/migrations/0049_competicao_premio_imagem.sql
-- Imagem e link de mercado do prêmio da competição
-- (docs/superpowers/specs/2026-07-23-premio-imagem-competicao-design.md): admin cola um
-- link de imagem (skin) e o link da página dela no mercado da Steam ao criar/editar uma
-- competição. Nullable no banco — competições já existentes ficam sem valor (não há como
-- fazer backfill de um link que não existe); a obrigatoriedade em CRIAÇÃO é aplicada na
-- API (POST /admin), mesmo padrão de nome/dataInicio/dataFim.
alter table competicoes
  add column premio_imagem_url text,
  add column premio_mercado_url text;
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
const sql = fs.readFileSync('supabase/migrations/0049_competicao_premio_imagem.sql', 'utf8');
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
pool.query(sql).then(() => { console.log('0049 aplicada'); pool.end(); }).catch((e) => { console.error(e.message); pool.end(); });
"
```

Expected: `0049 aplicada`, sem erro.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0049_competicao_premio_imagem.sql
git commit -m "feat: migracao das colunas de imagem/link de mercado do premio"
```

---

### Task 2: Backend — `GET /` inclui os campos novos + `GET /status`

**Files:**
- Modify: `site/server/src/routes/competicoes.js:21-28` (`mapCompeticao`), `:104-110` (query de `GET /`)
- Test: `site/server/test/competicoes.test.js`

**Interfaces:**
- Consumes: colunas `premio_imagem_url`/`premio_mercado_url` da Task 1.
- Produces: `mapCompeticao(c)` passa a incluir `premioImagemUrl`/`premioMercadoUrl` no objeto retornado — Tasks 3, 4 e 6 (frontend) dependem desses nomes de campo exatos na resposta JSON. Rota nova `GET /api/competicoes/status` retorna `{ temAtiva: boolean }` — Task 8 (frontend) consome esse formato exato.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final do bloco `describe('GET /api/competicoes', ...)` em
`site/server/test/competicoes.test.js` (depois do teste `'competicao com data_inicio no
futuro...'`, antes do `})` que fecha o describe):

```javascript
  it('inclui premioImagemUrl/premioMercadoUrl na resposta e na query', async () => {
    const agora = new Date()
    const { app, db } = appWith([
      ['from competicoes', [{
        id: 'comp1', nome: 'Teste', descricao: '', premio_descricao: 'Skin',
        premio_imagem_url: 'https://exemplo.com/ak47.png',
        premio_mercado_url: 'https://steamcommunity.com/market/listings/730/AK-47',
        data_inicio: new Date(agora.getTime() - 86400000), data_fim: new Date(agora.getTime() + 86400000),
        limite_diario: 2, limite_total: 10, minimo_para_rankear: 3, vencedor_steam_id64: null,
      }]],
    ])
    const res = await request(app).get('/api/competicoes').set('Cookie', cookieJogador)
    expect(res.body.ativa.premioImagemUrl).toBe('https://exemplo.com/ak47.png')
    expect(res.body.ativa.premioMercadoUrl).toBe('https://steamcommunity.com/market/listings/730/AK-47')
    const [sql] = db.query.mock.calls.find(([s]) => s.includes('from competicoes'))
    expect(sql).toContain('premio_imagem_url')
    expect(sql).toContain('premio_mercado_url')
  })
```

Adicionar um novo `describe` no final do arquivo (depois do último `describe('tradelink
so aparece...')`):

```javascript
describe('GET /api/competicoes/status', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/competicoes/status')).status).toBe(401)
  })

  it('existe competicao no periodo atual: temAtiva true', async () => {
    const { app } = appWith([
      ['from competicoes where data_inicio', [{ tem_ativa: true }]],
    ])
    const res = await request(app).get('/api/competicoes/status').set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ temAtiva: true })
  })

  it('nenhuma competicao no periodo atual: temAtiva false', async () => {
    const { app } = appWith([
      ['from competicoes where data_inicio', [{ tem_ativa: false }]],
    ])
    const res = await request(app).get('/api/competicoes/status').set('Cookie', cookieJogador)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ temAtiva: false })
  })
})
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd site/server && npx vitest run test/competicoes.test.js`
Expected: FAIL — `premioImagemUrl`/`premioMercadoUrl` `undefined`, e `GET /status` retorna 404 (rota não existe).

- [ ] **Step 3: Implementar**

Em `site/server/src/routes/competicoes.js`, modificar `mapCompeticao` (linhas 21-28):

```javascript
function mapCompeticao(c) {
  return {
    id: c.id, nome: c.nome, descricao: c.descricao, premioDescricao: c.premio_descricao,
    premioImagemUrl: c.premio_imagem_url, premioMercadoUrl: c.premio_mercado_url,
    dataInicio: c.data_inicio, dataFim: c.data_fim,
    limiteDiario: c.limite_diario, limiteTotal: c.limite_total, minimoParaRankear: c.minimo_para_rankear,
    vencedorSteamId: c.vencedor_steam_id64,
  }
}
```

Modificar a query de `GET /'` (linhas 104-110) pra incluir as duas colunas:

```javascript
  router.get('/', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      `select id, nome, descricao, premio_descricao, premio_imagem_url, premio_mercado_url,
              data_inicio, data_fim,
              limite_diario, limite_total, minimo_para_rankear, vencedor_steam_id64, tradelink_vencedor
       from competicoes
       order by data_inicio desc`,
    )
```

Adicionar a rota nova logo depois de `GET /'` (antes de `router.post('/admin', ...)`):

```javascript
  // Endpoint leve só pra "existe competição ativa agora?" — GET / já calcula leaderboard
  // completo de todas as competições (pesado) e Shell.jsx fica montado em toda página
  // autenticada, então chamar o endpoint pesado a cada poll seria desperdício de carga.
  router.get('/status', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      `select exists(
         select 1 from competicoes where data_inicio <= now() and data_fim >= now()
       ) as tem_ativa`,
    )
    res.json({ temAtiva: rows[0].tem_ativa })
  })
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/server && npx vitest run test/competicoes.test.js`
Expected: PASS (todos os testes do arquivo, incluindo os já existentes).

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/competicoes.js site/server/test/competicoes.test.js
git commit -m "feat: GET /api/competicoes inclui premio imagem/link + endpoint de status"
```

---

### Task 3: Backend — `POST /admin` exige e valida imagem/link do prêmio

**Files:**
- Modify: `site/server/src/routes/competicoes.js:143-159`
- Test: `site/server/test/competicoes.test.js`

**Interfaces:**
- Consumes: nenhuma dependência de outra task além da Task 1 (colunas no banco).
- Produces: `POST /admin` passa a exigir `premioImagemUrl`/`premioMercadoUrl` no body — Task 5 (frontend) precisa enviar esses dois campos.

- [ ] **Step 1: Escrever os testes que falham**

Modificar o teste existente `'admin: cria competicao'` (linhas 74-84) pra incluir os
campos novos no body enviado:

```javascript
  it('admin: cria competicao', async () => {
    const { app, db } = appWith([['insert into competicoes', [{ id: 'comp-nova' }]]])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieAdmin).send({
      nome: 'Semana 1', descricao: 'desc', premioDescricao: 'Skin AK',
      premioImagemUrl: 'https://exemplo.com/ak47.png',
      premioMercadoUrl: 'https://steamcommunity.com/market/listings/730/AK-47',
      dataInicio: '2026-08-01T00:00:00Z', dataFim: '2026-08-08T00:00:00Z',
      limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 3,
    })
    expect(res.status).toBe(201)
    const insert = db.query.mock.calls.find(([sql]) => sql.includes('insert into competicoes'))
    expect(insert).toBeTruthy()
    expect(insert[1]).toContain('https://exemplo.com/ak47.png')
    expect(insert[1]).toContain('https://steamcommunity.com/market/listings/730/AK-47')
  })
```

Adicionar dois testes novos logo depois (ainda dentro de
`describe('POST /api/competicoes/admin', ...)`):

```javascript
  it('sem premioImagemUrl/premioMercadoUrl: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieAdmin).send({
      nome: 'X', dataInicio: '2026-08-01T00:00:00Z', dataFim: '2026-08-08T00:00:00Z',
    })
    expect(res.status).toBe(400)
  })

  it('premioMercadoUrl fora do dominio da steam: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/competicoes/admin').set('Cookie', cookieAdmin).send({
      nome: 'X', dataInicio: '2026-08-01T00:00:00Z', dataFim: '2026-08-08T00:00:00Z',
      premioImagemUrl: 'https://exemplo.com/ak47.png',
      premioMercadoUrl: 'https://exemplo.com/market',
    })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/steamcommunity\.com\/market/)
  })
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd site/server && npx vitest run test/competicoes.test.js -t "POST /api/competicoes/admin"`
Expected: FAIL — `'admin: cria competicao'` continua passando (campos extras ainda são
ignorados pelo insert atual), mas os dois testes novos falham (esperam 400, servidor
ainda aceita sem os campos e não valida o domínio).

- [ ] **Step 3: Implementar**

Substituir `router.post('/admin', ...)` (linhas 143-159) por:

```javascript
  const MERCADO_STEAM_PREFIXO = 'https://steamcommunity.com/market/'

  router.post('/admin', limiteEstrito, requireAuth, requireSuperAdmin, async (req, res) => {
    const {
      nome, descricao, premioDescricao, premioImagemUrl, premioMercadoUrl,
      dataInicio, dataFim, limiteDiario, limiteTotal, minimoParaRankear,
    } = req.body ?? {}
    if (!nome || !dataInicio || !dataFim) return res.status(400).json({ erro: 'nome, dataInicio e dataFim são obrigatórios' })
    if (!premioImagemUrl || !premioMercadoUrl) {
      return res.status(400).json({ erro: 'premioImagemUrl e premioMercadoUrl são obrigatórios' })
    }
    if (!premioMercadoUrl.startsWith(MERCADO_STEAM_PREFIXO)) {
      return res.status(400).json({ erro: `premioMercadoUrl precisa ser um link do mercado da Steam (${MERCADO_STEAM_PREFIXO}...)` })
    }
    if (new Date(dataFim) <= new Date(dataInicio)) return res.status(400).json({ erro: 'dataFim precisa ser depois de dataInicio' })
    if (!inteiroPositivoOuIndefinido(limiteDiario) || !inteiroPositivoOuIndefinido(limiteTotal) || !inteiroPositivoOuIndefinido(minimoParaRankear)) {
      return res.status(400).json({ erro: 'limiteDiario, limiteTotal e minimoParaRankear precisam ser inteiros positivos' })
    }
    const { rows } = await db.query(
      `insert into competicoes
         (nome, descricao, premio_descricao, premio_imagem_url, premio_mercado_url,
          data_inicio, data_fim, limite_diario, limite_total, minimo_para_rankear, criado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning id`,
      [nome, descricao ?? '', premioDescricao ?? '', premioImagemUrl, premioMercadoUrl, dataInicio, dataFim,
        limiteDiario ?? 2, limiteTotal ?? 10, minimoParaRankear ?? 3, req.player.steamId],
    )
    res.status(201).json({ id: rows[0].id })
  })
```

Definir `MERCADO_STEAM_PREFIXO` uma única vez, no escopo de `createCompeticoesRouter`
(reaproveitado pela Task 4 no `PUT /admin/:id`).

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/server && npx vitest run test/competicoes.test.js`
Expected: PASS (arquivo inteiro).

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/competicoes.js site/server/test/competicoes.test.js
git commit -m "feat: POST /api/competicoes/admin exige e valida imagem/link do premio"
```

---

### Task 4: Backend — `PUT /admin/:id` valida imagem/link quando enviados

**Files:**
- Modify: `site/server/src/routes/competicoes.js:161-200`
- Test: `site/server/test/competicoes.test.js`

**Interfaces:**
- Consumes: `MERCADO_STEAM_PREFIXO` definido na Task 3.
- Produces: `PUT /admin/:id` aceita `premioImagemUrl`/`premioMercadoUrl` opcionais, valida
  o domínio só quando `premioMercadoUrl` vem no body — Task 5 (frontend, fluxo de edição)
  depende desse comportamento parcial.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar dentro de `describe('PUT /api/competicoes/admin/:id', ...)`, depois do teste
`'id nao encontrado ao validar so uma data: 404'`:

```javascript
  it('premioMercadoUrl fora do dominio da steam: 400', async () => {
    const { app } = appWith([])
    const res = await request(app).put(`/api/competicoes/admin/${COMP_ID}`).set('Cookie', cookieAdmin)
      .send({ premioMercadoUrl: 'https://exemplo.com/market' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/steamcommunity\.com\/market/)
  })

  it('premioImagemUrl e premioMercadoUrl validos: atualiza com sucesso', async () => {
    const { app, db } = appWith([
      ['update competicoes set', [{ id: COMP_ID }]],
    ])
    const res = await request(app).put(`/api/competicoes/admin/${COMP_ID}`).set('Cookie', cookieAdmin).send({
      premioImagemUrl: 'https://exemplo.com/ak47.png',
      premioMercadoUrl: 'https://steamcommunity.com/market/listings/730/AK-47',
    })
    expect(res.status).toBe(200)
    const update = db.query.mock.calls.find(([sql]) => sql.includes('update competicoes set'))
    expect(update[1]).toContain('https://exemplo.com/ak47.png')
    expect(update[1]).toContain('https://steamcommunity.com/market/listings/730/AK-47')
  })
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd site/server && npx vitest run test/competicoes.test.js -t "PUT /api/competicoes/admin"`
Expected: FAIL — primeiro teste espera 400 mas recebe 200 (sem validação ainda); segundo
teste espera as duas colunas nos parâmetros do `update` e elas não existem ainda.

- [ ] **Step 3: Implementar**

Substituir `router.put('/admin/:id', ...)` (linhas 161-200) por:

```javascript
  router.put('/admin/:id', limiteEstrito, requireAuth, requireSuperAdmin, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ erro: 'competição não encontrada' })
    const {
      nome, descricao, premioDescricao, premioImagemUrl, premioMercadoUrl,
      dataInicio, dataFim, limiteDiario, limiteTotal, minimoParaRankear,
    } = req.body ?? {}
    if (!inteiroPositivoOuIndefinido(limiteDiario) || !inteiroPositivoOuIndefinido(limiteTotal) || !inteiroPositivoOuIndefinido(minimoParaRankear)) {
      return res.status(400).json({ erro: 'limiteDiario, limiteTotal e minimoParaRankear precisam ser inteiros positivos' })
    }
    // Update parcial: só valida o domínio de premioMercadoUrl quando o campo é enviado
    // (mesma lógica de dataInicio/dataFim abaixo — editar só outro campo não deve exigir
    // reenviar imagem/link).
    if (premioMercadoUrl && !premioMercadoUrl.startsWith(MERCADO_STEAM_PREFIXO)) {
      return res.status(400).json({ erro: `premioMercadoUrl precisa ser um link do mercado da Steam (${MERCADO_STEAM_PREFIXO}...)` })
    }
    // Update parcial: quando só dataInicio OU só dataFim vem no body, precisa validar
    // contra a data já gravada. Sem isso, um PUT que move só dataFim pra antes do
    // data_inicio existente pulava a checagem de app inteira e só era barrado pelo CHECK
    // `periodo_valido` da migration 0047 lá no banco — 500 cru em vez de 400 limpo.
    if (dataInicio || dataFim) {
      let inicioEfetivo = dataInicio
      let fimEfetivo = dataFim
      if (!dataInicio || !dataFim) {
        const { rows: atuais } = await db.query(
          `select data_inicio, data_fim from competicoes where id = $1`,
          [req.params.id],
        )
        if (!atuais.length) return res.status(404).json({ erro: 'competição não encontrada' })
        inicioEfetivo = dataInicio ?? atuais[0].data_inicio
        fimEfetivo = dataFim ?? atuais[0].data_fim
      }
      if (new Date(fimEfetivo) <= new Date(inicioEfetivo)) {
        return res.status(400).json({ erro: 'dataFim precisa ser depois de dataInicio' })
      }
    }
    const { rows } = await db.query(
      `update competicoes set
         nome = coalesce($1, nome), descricao = coalesce($2, descricao),
         premio_descricao = coalesce($3, premio_descricao),
         premio_imagem_url = coalesce($4, premio_imagem_url),
         premio_mercado_url = coalesce($5, premio_mercado_url),
         data_inicio = coalesce($6, data_inicio), data_fim = coalesce($7, data_fim),
         limite_diario = coalesce($8, limite_diario), limite_total = coalesce($9, limite_total),
         minimo_para_rankear = coalesce($10, minimo_para_rankear)
       where id = $11
       returning id`,
      [nome, descricao, premioDescricao, premioImagemUrl, premioMercadoUrl, dataInicio, dataFim,
        limiteDiario, limiteTotal, minimoParaRankear, req.params.id],
    )
    if (!rows.length) return res.status(404).json({ erro: 'competição não encontrada' })
    res.json({ ok: true })
  })
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/server && npx vitest run test/competicoes.test.js`
Expected: PASS (arquivo inteiro — todos os `describe` de `competicoes.test.js`).

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/competicoes.js site/server/test/competicoes.test.js
git commit -m "feat: PUT /api/competicoes/admin/:id valida imagem/link do premio quando enviados"
```

---

### Task 5: Frontend — `FormCompeticao.jsx` ganha os dois campos novos

**Files:**
- Modify: `site/client/src/components/FormCompeticao.jsx`
- Test: `site/client/src/test/FormCompeticao.test.jsx`

**Interfaces:**
- Consumes: `POST/PUT /api/competicoes/admin` (Tasks 3-4) — envia `premioImagemUrl`/`premioMercadoUrl` no body, espera 400 com `{ erro }` quando inválido.
- Produces: nenhuma outra task consome este componente diretamente (é consumido por
  `Admin.jsx`, que não muda).

- [ ] **Step 1: Escrever os testes que falham**

Substituir o teste existente `'preenche e salva uma competicao nova'` (linhas 7-19) por
uma versão que preenche os dois campos novos (agora obrigatórios):

```javascript
  it('preenche e salva uma competicao nova', async () => {
    const onSalvo = vi.fn()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'comp1' }) })
    render(<FormCompeticao onSalvo={onSalvo} onCancelar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Semana 1' } })
    fireEvent.change(screen.getByLabelText(/pr[êe]mio/i), { target: { value: 'Skin AK-47' } })
    fireEvent.change(screen.getByLabelText(/link da imagem/i), { target: { value: 'https://exemplo.com/ak47.png' } })
    fireEvent.change(screen.getByLabelText(/link no mercado/i), { target: { value: 'https://steamcommunity.com/market/listings/730/AK-47' } })
    fireEvent.change(screen.getByLabelText(/in[íi]cio/i), { target: { value: '2026-07-23T00:00' } })
    fireEvent.change(screen.getByLabelText(/fim/i), { target: { value: '2026-07-30T00:00' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
    const [, opts] = global.fetch.mock.calls[0]
    const corpo = JSON.parse(opts.body)
    expect(corpo.nome).toBe('Semana 1')
    expect(corpo.premioImagemUrl).toBe('https://exemplo.com/ak47.png')
    expect(corpo.premioMercadoUrl).toBe('https://steamcommunity.com/market/listings/730/AK-47')
  })
```

Adicionar dois testes novos no final do `describe('FormCompeticao', ...)`:

```javascript
  it('bloqueia salvar sem link de imagem/mercado', async () => {
    global.fetch = vi.fn()
    render(<FormCompeticao onSalvo={() => {}} onCancelar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(screen.getByText(/obrigat[óo]rios/i)).toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('bloqueia link de mercado fora do dominio da steam', async () => {
    global.fetch = vi.fn()
    render(<FormCompeticao onSalvo={() => {}} onCancelar={() => {}} />)
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText(/link da imagem/i), { target: { value: 'https://exemplo.com/ak47.png' } })
    fireEvent.change(screen.getByLabelText(/link no mercado/i), { target: { value: 'https://exemplo.com/market' } })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(screen.getByText(/steamcommunity\.com\/market/i)).toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd site/client && npx vitest run src/test/FormCompeticao.test.jsx`
Expected: FAIL — `getByLabelText(/link da imagem/i)` e `getByLabelText(/link no
mercado/i)` não encontram nenhum elemento (campos ainda não existem).

- [ ] **Step 3: Implementar**

Editar `site/client/src/components/FormCompeticao.jsx`. Adicionar estado (depois da
linha `const [premioDescricao, ...] = useState(...)`, linha 9):

```javascript
  const [premioImagemUrl, setPremioImagemUrl] = useState(inicial?.premioImagemUrl ?? '')
  const [premioMercadoUrl, setPremioMercadoUrl] = useState(inicial?.premioMercadoUrl ?? '')
  const [imagemComErro, setImagemComErro] = useState(false)
```

Adicionar a constante do prefixo Steam logo acima do componente (depois do comentário de
padrão de modal, antes de `export default function FormCompeticao`):

```javascript
const MERCADO_STEAM_PREFIXO = 'https://steamcommunity.com/market/'
```

Modificar `salvar` (linhas 18-39) pra validar antes de chamar `fetch`:

```javascript
  async function salvar(e) {
    e.preventDefault()
    setErro(null)
    if (!premioImagemUrl.trim() || !premioMercadoUrl.trim()) {
      setErro('Link da imagem e link do mercado da Steam são obrigatórios.')
      return
    }
    if (!premioMercadoUrl.startsWith(MERCADO_STEAM_PREFIXO)) {
      setErro(`O link do mercado precisa começar com ${MERCADO_STEAM_PREFIXO}`)
      return
    }
    setSalvando(true)
    const corpo = {
      nome, descricao, premioDescricao, premioImagemUrl, premioMercadoUrl,
      // datetime-local pode vir vazio (campo ainda não preenchido) — new Date('').toISOString()
      // lança RangeError, então só convertemos quando há valor; o servidor valida o resto.
      dataInicio: dataInicio ? new Date(dataInicio).toISOString() : dataInicio,
      dataFim: dataFim ? new Date(dataFim).toISOString() : dataFim,
      limiteDiario: Number(limiteDiario), limiteTotal: Number(limiteTotal), minimoParaRankear: Number(minimoParaRankear),
    }
    const res = await fetch(inicial ? `/api/competicoes/admin/${inicial.id}` : '/api/competicoes/admin', {
      method: inicial ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    }).catch(() => null)
    setSalvando(false)
    if (res?.ok) return onSalvo()
    const body = await res?.json().catch(() => ({}))
    setErro(body?.erro ?? 'Erro ao salvar.')
  }
```

Adicionar os dois campos no JSX, logo depois do label "Prêmio" (linhas 66-69, antes do
`<div className="mt-3 grid grid-cols-2 gap-3">` de Início/Fim):

```jsx
        <label className="mt-3 block font-mono text-xs text-texto-fraco">
          Link da imagem da skin
          <input
            type="url"
            value={premioImagemUrl}
            onChange={(e) => { setPremioImagemUrl(e.target.value); setImagemComErro(false) }}
            className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto"
          />
        </label>
        {premioImagemUrl && !imagemComErro && (
          <img
            src={premioImagemUrl}
            alt="Prévia da skin"
            className="mt-2 h-20 w-20 border border-borda object-cover"
            onError={() => setImagemComErro(true)}
          />
        )}
        {premioImagemUrl && imagemComErro && (
          <p className="mt-2 font-mono text-xs text-perigo">Não foi possível carregar essa imagem.</p>
        )}
        <label className="mt-3 block font-mono text-xs text-texto-fraco">
          Link no mercado da Steam
          <input
            type="url"
            value={premioMercadoUrl}
            onChange={(e) => setPremioMercadoUrl(e.target.value)}
            className="mt-1 min-h-10 w-full border border-borda bg-fundo px-2 font-mono text-sm text-texto"
          />
        </label>
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/client && npx vitest run src/test/FormCompeticao.test.jsx`
Expected: PASS (arquivo inteiro).

- [ ] **Step 5: Commit**

```bash
git add site/client/src/components/FormCompeticao.jsx site/client/src/test/FormCompeticao.test.jsx
git commit -m "feat: formulario de competicao pede imagem e link do premio no mercado"
```

---

### Task 6: Frontend — card público exibe imagem e link "Ver no mercado"

**Files:**
- Modify: `site/client/src/pages/Competicoes.jsx:48-53`
- Test: `site/client/src/test/Competicoes.test.jsx`

**Interfaces:**
- Consumes: `comp.premioImagemUrl`/`comp.premioMercadoUrl` (Task 2, campos de
  `mapCompeticao`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final do `describe('Competicoes', ...)`:

```javascript
  it('mostra imagem do premio e link pro mercado quando presentes', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ativa: {
          id: 'comp1', nome: 'Semana 1', premioDescricao: 'Skin AK-47',
          premioImagemUrl: 'https://exemplo.com/ak47.png',
          premioMercadoUrl: 'https://steamcommunity.com/market/listings/730/AK-47',
          dataFim: new Date(Date.now() + 86400000).toISOString(),
          leaderboard: [], limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 3,
        },
        encerradas: [],
      }),
    })
    render(<Competicoes />)
    await waitFor(() => expect(screen.getByRole('img', { name: /skin ak-47/i })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /ver no mercado/i })).toHaveAttribute(
      'href', 'https://steamcommunity.com/market/listings/730/AK-47',
    )
  })

  it('sem imagem/link do premio (competicao antiga): nao quebra e nao mostra o link', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ativa: {
          id: 'comp1', nome: 'Semana 1', premioDescricao: 'Skin',
          dataFim: new Date(Date.now() + 86400000).toISOString(),
          leaderboard: [], limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 3,
        },
        encerradas: [],
      }),
    })
    render(<Competicoes />)
    await waitFor(() => expect(screen.getByText('Semana 1')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /ver no mercado/i })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd site/client && npx vitest run src/test/Competicoes.test.jsx`
Expected: FAIL — o card não renderiza `<img>` nem o link "Ver no mercado" ainda.

- [ ] **Step 3: Implementar**

Em `site/client/src/pages/Competicoes.jsx`, dentro de `CardCompeticao`, adicionar logo
depois do bloco do nome/badge (linhas 50-53, antes de `{comp.descricao && ...}`):

```jsx
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-bold text-texto">{comp.nome}</h2>
        {comp.premioDescricao && <Badge tom="destaque">{comp.premioDescricao}</Badge>}
      </div>
      {(comp.premioImagemUrl || comp.premioMercadoUrl) && (
        <div className="mt-3 flex items-center gap-3">
          {comp.premioImagemUrl && (
            <img
              src={comp.premioImagemUrl}
              alt={comp.premioDescricao || 'Prêmio da competição'}
              className="panel-cut-sm h-16 w-16 border border-borda object-cover"
            />
          )}
          {comp.premioMercadoUrl && (
            <a
              href={comp.premioMercadoUrl}
              target="_blank"
              rel="noreferrer"
              className="panel-cut-sm border border-borda px-2 py-1 font-mono text-xs uppercase tracking-wide text-texto-fraco hover:border-destaque/50 hover:text-destaque"
            >
              Ver no mercado ↗
            </a>
          )}
        </div>
      )}
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/client && npx vitest run src/test/Competicoes.test.jsx`
Expected: PASS (arquivo inteiro).

- [ ] **Step 5: Commit**

```bash
git add site/client/src/pages/Competicoes.jsx site/client/src/test/Competicoes.test.jsx
git commit -m "feat: card publico de competicao mostra imagem e link pro mercado do premio"
```

---

### Task 7: Frontend — redefine as 4 abas fixas da barra inferior mobile

**Files:**
- Modify: `site/client/src/components/Shell.jsx:163-170` (`NAV_INFERIOR_BASE`)
- Test: `site/client/src/test/Shell.test.jsx` (novo arquivo)

**Interfaces:**
- Consumes: nada de outra task deste plano.
- Produces: `NAV_INFERIOR_BASE` com Partidas/Ranking/Clipes/Comparar — Task 9 depende
  dessa lista base pra fazer a substituição dinâmica.

- [ ] **Step 1: Escrever o teste que falha**

Criar `site/client/src/test/Shell.test.jsx`:

```javascript
// site/client/src/test/Shell.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthContext.jsx'
import Shell from '../components/Shell.jsx'

function mockFetch({ temAtiva = false } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/api/auth/me')) {
        return Promise.resolve({ ok: true, json: async () => ({ steamId: '765', nick: 'bronze', avatarUrl: null, isSuperAdmin: false }) })
      }
      if (typeof url === 'string' && url.includes('/api/competicoes/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ temAtiva }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }),
  )
}

afterEach(() => { vi.unstubAllGlobals() })

function renderShell(opts) {
  mockFetch(opts)
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/']}>
        <Shell>conteudo</Shell>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('Shell — barra inferior mobile', () => {
  it('base sem competicao ativa: Partidas, Ranking, Clipes, Comparar', async () => {
    renderShell({ temAtiva: false })
    await waitFor(() => expect(screen.getByText('bronze')).toBeInTheDocument())
    const barra = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(within(barra).getByRole('link', { name: /^partidas$/i })).toBeInTheDocument()
    expect(within(barra).getByRole('link', { name: /^ranking$/i })).toBeInTheDocument()
    expect(within(barra).getByRole('link', { name: /^clipes$/i })).toBeInTheDocument()
    expect(within(barra).getByRole('link', { name: /comparar/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `cd site/client && npx vitest run src/test/Shell.test.jsx`
Expected: FAIL — a barra ainda mostra Granadas/Táticas em vez de Clipes/Comparar.

- [ ] **Step 3: Implementar**

Em `site/client/src/components/Shell.jsx`, substituir o comentário e `NAV_INFERIOR_BASE`
(linhas 163-170):

```javascript
// Base fixa da barra mobile: as 4 rotas de hábito diário, não de consulta situacional
// (docs/superpowers/specs/2026-07-23-indicador-competicao-ativa-design.md) — Partidas é
// o job principal (rever a partida logo depois de jogar), Comparar resolve discussão do
// grupo via Head to Head (caso de uso citado explicitamente no PRODUCT.md), Clipes está
// ligado ao fluxo de Competições. Granadas/Táticas (consulta situacional, ex.: lineup de
// smoke antes de um round) continuam acessíveis pelo menu "Mais", só saem da barra fixa.
const NAV_INFERIOR_BASE = [
  { to: '/', end: true, label: 'Partidas', icone: 'partidas' },
  { to: '/ranking', label: 'Ranking', icone: 'ranking' },
  { to: '/clipes', label: 'Clipes', icone: 'clipes' },
  { to: '/comparar', label: 'Comparar', icone: 'comparar' },
]
```

- [ ] **Step 4: Rodar o teste pra confirmar que passa**

Run: `cd site/client && npx vitest run src/test/Shell.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/client/src/components/Shell.jsx site/client/src/test/Shell.test.jsx
git commit -m "feat: redefine as 4 abas fixas da barra inferior mobile"
```

---

### Task 8: Frontend — polling de status + ponto pulsante na sidebar desktop

**Files:**
- Modify: `site/client/src/components/Shell.jsx` (novo estado/efeito em `Shell`, ícone da
  sidebar em `:254`)
- Test: `site/client/src/test/Shell.test.jsx`

**Interfaces:**
- Consumes: `GET /api/competicoes/status` (Task 2) — `{ temAtiva: boolean }`.
- Produces: estado `temCompeticaoAtiva` (boolean) dentro de `Shell`, passado como prop
  `temCompeticaoAtiva` pro componente `BarraInferior` — Task 9 depende desse nome de prop
  exato. Componente `IndicadorCompeticaoAtiva` (sem props) — Task 9 reaproveita.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar um novo `describe` em `site/client/src/test/Shell.test.jsx`:

```javascript
describe('Shell — indicador de competicao ativa (sidebar)', () => {
  it('sem competicao ativa: sem indicador na sidebar', async () => {
    renderShell({ temAtiva: false })
    await waitFor(() => expect(screen.getByText('bronze')).toBeInTheDocument())
    expect(screen.queryByText(/competi[çc][ãa]o ativa/i)).not.toBeInTheDocument()
  })

  it('com competicao ativa: mostra o indicador (texto acessivel) perto de Competicoes', async () => {
    renderShell({ temAtiva: true })
    await waitFor(() => expect(screen.getByText(/competi[çc][ãa]o ativa/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `cd site/client && npx vitest run src/test/Shell.test.jsx`
Expected: FAIL — o segundo teste não encontra nenhum texto "Competição ativa" (indicador
ainda não existe).

- [ ] **Step 3: Implementar**

Em `site/client/src/components/Shell.jsx`, adicionar o componente do indicador logo
depois da função `itemClasse` (linha 181, antes de `export default function Shell`):

```javascript
// Ponto pulsante sobreposto ao ícone de Competições — mesmo padrão visual (bg-destaque +
// animate-pulso-sinal) já usado no aviso de sincronização de Feed.jsx:112. O texto
// sr-only garante leitura por leitor de tela sem depender só de cor/animação.
function IndicadorCompeticaoAtiva() {
  return (
    <span className="absolute -right-0.5 -top-0.5 inline-flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full animate-pulso-sinal rounded-full bg-destaque shadow-[0_0_6px_var(--color-destaque)]" />
      <span className="sr-only">Competição ativa</span>
    </span>
  )
}
```

Dentro de `export default function Shell({ children })`, adicionar o estado e o efeito de
polling logo depois do efeito que persiste `colapsada` no `localStorage` (depois da linha
200, antes de `async function sair()`):

```javascript
  const [temCompeticaoAtiva, setTemCompeticaoAtiva] = useState(false)

  // Descobre se existe competição ativa pra acender o indicador (sidebar + barra
  // inferior mobile) — mesmo padrão de polling já usado em Feed.jsx pro aviso de
  // sincronização, intervalo maior (60s) porque início/fim de competição não muda a
  // cada segundo.
  useEffect(() => {
    let vivo = true
    function carregar() {
      fetch('/api/competicoes/status')
        .then((res) => (res.ok ? res.json() : null))
        .then((s) => { if (vivo && s) setTemCompeticaoAtiva(Boolean(s.temAtiva)) })
        .catch(() => {})
    }
    carregar()
    const t = setInterval(carregar, 60000)
    return () => { vivo = false; clearInterval(t) }
  }, [])
```

Modificar o ícone do item da sidebar (linha 254, dentro do `.map` de `ITENS`) pra
posicionar o indicador quando o item for Competições e houver competição ativa:

```jsx
              <span className="relative shrink-0">
                {NAV_ICONES[item.icone]}
                {item.to === '/competicoes' && temCompeticaoAtiva && <IndicadorCompeticaoAtiva />}
              </span>
```

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/client && npx vitest run src/test/Shell.test.jsx`
Expected: PASS (arquivo inteiro).

- [ ] **Step 5: Commit**

```bash
git add site/client/src/components/Shell.jsx site/client/src/test/Shell.test.jsx
git commit -m "feat: indicador pulsante na sidebar quando ha competicao ativa"
```

---

### Task 9: Frontend — barra inferior mobile troca Comparar por Competições

**Files:**
- Modify: `site/client/src/components/Shell.jsx` (`BarraInferior`, chamada em `Shell`)
- Test: `site/client/src/test/Shell.test.jsx`

**Interfaces:**
- Consumes: prop `temCompeticaoAtiva` e componente `IndicadorCompeticaoAtiva` (Task 8),
  `NAV_INFERIOR_BASE` (Task 7).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao `describe('Shell — barra inferior mobile', ...)` (criado na Task 7):

```javascript
  it('com competicao ativa: Comparar vira Competicoes, com o indicador', async () => {
    renderShell({ temAtiva: true })
    await waitFor(() => expect(screen.getByText('bronze')).toBeInTheDocument())
    const barra = screen.getByRole('navigation', { name: 'Navegação principal' })
    await waitFor(() => expect(within(barra).queryByRole('link', { name: /comparar/i })).not.toBeInTheDocument())
    expect(within(barra).getByRole('link', { name: /competi[çc][õo]es/i })).toBeInTheDocument()
    expect(within(barra).getByText(/competi[çc][ãa]o ativa/i)).toBeInTheDocument()
    // as outras 3 continuam
    expect(within(barra).getByRole('link', { name: /^partidas$/i })).toBeInTheDocument()
    expect(within(barra).getByRole('link', { name: /^ranking$/i })).toBeInTheDocument()
    expect(within(barra).getByRole('link', { name: /^clipes$/i })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `cd site/client && npx vitest run src/test/Shell.test.jsx`
Expected: FAIL — a barra continua mostrando Comparar mesmo com `temAtiva: true`
(`BarraInferior` ainda não recebe nem usa a prop).

- [ ] **Step 3: Implementar**

Em `site/client/src/components/Shell.jsx`, alterar a chamada de `BarraInferior` dentro do
`return` de `Shell` (linha 353):

```jsx
      <BarraInferior menuAberto={menuAberto} onAbrirMenu={() => setMenuAberto(true)} temCompeticaoAtiva={temCompeticaoAtiva} />
```

Alterar a assinatura e o corpo de `BarraInferior` (linhas 361-390):

```javascript
function BarraInferior({ menuAberto, onAbrirMenu, temCompeticaoAtiva }) {
  const location = useLocation()
  // Com competição ativa, Comparar cede o lugar pra Competições (mesmo indicador da
  // sidebar) — Partidas/Ranking/Clipes continuam fixos. Sem competição ativa, a barra
  // volta ao normal (docs/superpowers/specs/2026-07-23-indicador-competicao-ativa-design.md).
  const itens = temCompeticaoAtiva
    ? NAV_INFERIOR_BASE.map((item) =>
        item.to === '/comparar' ? { to: '/competicoes', label: 'Competições', icone: 'competicoes' } : item,
      )
    : NAV_INFERIOR_BASE

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
          <span className="relative">
            {NAV_ICONES[item.icone]}
            {item.to === '/competicoes' && <IndicadorCompeticaoAtiva />}
          </span>
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

- [ ] **Step 4: Rodar os testes pra confirmar que passam**

Run: `cd site/client && npx vitest run src/test/Shell.test.jsx`
Expected: PASS (arquivo inteiro).

- [ ] **Step 5: Commit**

```bash
git add site/client/src/components/Shell.jsx site/client/src/test/Shell.test.jsx
git commit -m "feat: barra inferior mobile troca Comparar por Competicoes quando ativa"
```

---

### Task 10: Regressão completa

**Files:** nenhum arquivo novo — só verificação.

**Interfaces:** nenhuma.

- [ ] **Step 1: Rodar a suíte inteira do servidor**

Run: `cd site/server && npx vitest run`
Expected: PASS, sem nenhum teste quebrado (inclui `app.test.js`, que sobe o app inteiro
com o router de competições montado).

- [ ] **Step 2: Rodar a suíte inteira do client**

Run: `cd site/client && npx vitest run`
Expected: PASS, sem nenhum teste quebrado — em especial `App.test.jsx` (que renderiza
`Shell` de verdade via `RotaProtegida`) continua passando mesmo sem mockar
`/api/competicoes/status` explicitamente (o fetch cai no fallback existente do mock,
`temAtiva` fica `undefined`/falsy, sem indicador — comportamento seguro, não um crash).

- [ ] **Step 3: Confirmar que a migração 0049 foi aplicada em produção (Task 1, Step 2)**

Se ainda pendente, esse é o momento de rodar — sem a coluna `premio_imagem_url`/
`premio_mercado_url` no banco real, `POST /admin` em produção quebra com 500 assim que
o deploy do código da Task 3 for pro ar.

- [ ] **Step 4: Commit final (se sobrar algo solto)**

```bash
git status --short
```

Se tudo já foi commitado nas tasks anteriores, não há nada a fazer aqui — este step é só
a rede de segurança pra pegar qualquer arquivo esquecido antes de considerar o plano
concluído.
