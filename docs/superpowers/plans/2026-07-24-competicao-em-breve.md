# Competição "Em Breve" + Regras Explícitas — Plano de Implementação

> **Para quem for executar:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans pra rodar este plano tarefa por tarefa. Passos usam checkbox (`- [ ]`) pra acompanhamento.

**Objetivo:** competições agendadas aparecem na aba pública com badge "EM BREVE", regras
completas e sem botão de envio; envio de clipe bloqueado server-side antes do início.

**Arquitetura:** só duas superfícies — `Competicoes.jsx` (renderiza `agendadas` que o
backend já devolve, card ganha estado "não começou" e bloco de regras) e `competicoes.js`
(guard de "ainda não começou" em `POST /:id/submissoes`).

**Tech Stack:** Node/Express + `pg`, React + Tailwind, Vitest + Testing Library.

## Global Constraints

- Botão "Enviar clipe" só com `!encerrada && !naoComecou` — nunca numa agendada.
- Guard server-side retorna 400 com erro contendo "não começou" (defesa em profundidade
  além da elegibilidade por `played_at` que já existe).
- A regra "só valem clipes de partidas jogadas dentro do período" aparece textualmente no
  bloco de regras, em qualquer fase da competição.
- Referência: `docs/superpowers/specs/2026-07-24-competicao-em-breve-design.md`.

---

### Task 1: Backend — guard "ainda não começou" no envio de submissão

**Files:**
- Modify: `site/server/src/routes/competicoes.js` (rota `POST /:id/submissoes`)
- Test: `site/server/test/competicoes.test.js`

**Interfaces:**
- Produces: `POST /api/competicoes/:id/submissoes` → 400 `{ erro: 'essa competição ainda não começou' }` quando `now < data_inicio`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar dentro de `describe('POST /api/competicoes/:id/submissoes', ...)` (depois do
teste `'clipe nao existe ou nao e do proprio jogador: 404'`):

```javascript
  it('competicao ainda nao comecou: 400', async () => {
    const amanha = new Date(Date.now() + 86400000).toISOString()
    const semana = new Date(Date.now() + 7 * 86400000).toISOString()
    const { app } = appWith([
      ['from competicoes where id', [{ id: COMP_ID, data_inicio: amanha, data_fim: semana, limite_diario: 2, limite_total: 10 }]],
    ])
    const res = await request(app).post(`/api/competicoes/${COMP_ID}/submissoes`).set('Cookie', cookieJogador).send({ allstarClipId: CLIP_ID })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/n[ãa]o come[çc]ou/i)
  })
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `cd site/server && npx vitest run test/competicoes.test.js -t "nao comecou"`
Expected: FAIL — hoje segue pro fluxo de clipe e devolve 404 (clipe não encontrado), não 400.

- [ ] **Step 3: Implementar**

Em `site/server/src/routes/competicoes.js`, na rota `POST /:id/submissoes`, logo depois
da linha `if (new Date() > new Date(comp.data_fim)) return res.status(400).json({ erro: 'essa competição já encerrou' })`:

```javascript
    // Defesa em profundidade: a elegibilidade por played_at já barraria (nenhuma partida
    // do período existe antes dele começar), mas o guard torna a regra explícita e a
    // mensagem clara pro jogador que tentar antes da hora.
    if (new Date() < new Date(comp.data_inicio)) return res.status(400).json({ erro: 'essa competição ainda não começou' })
```

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `cd site/server && npx vitest run test/competicoes.test.js`
Expected: PASS (arquivo inteiro).

- [ ] **Step 5: Commit**

```bash
git add site/server/src/routes/competicoes.js site/server/test/competicoes.test.js
git commit -m "feat: bloqueia envio de clipe antes da competicao comecar"
```

---

### Task 2: Frontend — agendadas na aba, badge EM BREVE e bloco de regras

**Files:**
- Modify: `site/client/src/pages/Competicoes.jsx`
- Test: `site/client/src/test/Competicoes.test.jsx`

**Interfaces:**
- Consumes: campo `agendadas` de `GET /api/competicoes` (já existe no backend) e helper
  `dataHora` de `../lib/format.js`.

- [ ] **Step 1: Escrever os testes que falham**

Atenção: os mocks existentes do arquivo devolvem payloads SEM `agendadas` — o componente
novo precisa tolerar (`dados.agendadas ?? []`), então os testes existentes continuam
passando sem alteração. Adicionar ao final do `describe('Competicoes', ...)`:

```javascript
  it('competicao agendada aparece com EM BREVE, regras e SEM botao de enviar', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ativa: null,
        agendadas: [{
          id: 'comp-futura', nome: 'Electrum Week', premioDescricao: 'M4A1-S Electrum',
          descricao: 'Primeira competição oficial.',
          dataInicio: new Date(Date.now() + 86400000).toISOString(),
          dataFim: new Date(Date.now() + 7 * 86400000).toISOString(),
          leaderboard: [], limiteDiario: 3, limiteTotal: 10, minimoParaRankear: 2,
        }],
        encerradas: [],
      }),
    })
    render(<Competicoes />)
    await waitFor(() => expect(screen.getByText('Electrum Week')).toBeInTheDocument())
    expect(screen.getByText(/em breve/i)).toBeInTheDocument()
    expect(screen.getByText(/come[çc]a em/i)).toBeInTheDocument()
    expect(screen.getByText(/jogadas dentro do per[íi]odo/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enviar clipe/i })).not.toBeInTheDocument()
  })

  it('competicao ativa mostra as regras E o botao de enviar', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ativa: {
          id: 'comp1', nome: 'Semana 1', premioDescricao: 'Skin',
          dataInicio: new Date(Date.now() - 86400000).toISOString(),
          dataFim: new Date(Date.now() + 86400000).toISOString(),
          leaderboard: [], limiteDiario: 2, limiteTotal: 10, minimoParaRankear: 3,
        },
        agendadas: [], encerradas: [],
      }),
    })
    render(<Competicoes />)
    await waitFor(() => expect(screen.getByText('Semana 1')).toBeInTheDocument())
    expect(screen.getByText(/jogadas dentro do per[íi]odo/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enviar clipe/i })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Rodar pra confirmar que falham**

Run: `cd site/client && npx vitest run src/test/Competicoes.test.jsx`
Expected: FAIL — agendada não renderiza nada hoje; regra do período não existe no card.

- [ ] **Step 3: Implementar**

Em `site/client/src/pages/Competicoes.jsx`:

1. Import do helper: `import { dataHora } from '../lib/format.js'`

2. Em `CardCompeticao`, depois de `const encerrada = ...` (linha 35):

```javascript
  const naoComecou = new Date() < new Date(comp.dataInicio)
```

3. Badge no header (linha 50-53) — ao lado do nome, antes do badge de prêmio:

```jsx
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-xl font-bold text-texto">{comp.nome}</h2>
          {naoComecou && <Badge tom="neutro">EM BREVE</Badge>}
        </div>
        {comp.premioDescricao && <Badge tom="destaque">{comp.premioDescricao}</Badge>}
      </div>
```

4. Substituir a linha telegráfica de limites (linhas 76-78) pelo bloco de regras:

```jsx
      {naoComecou && (
        <p className="mt-2 font-mono text-sm text-destaque">Começa em {dataHora(comp.dataInicio)}.</p>
      )}
      <div className="mt-3">
        <h3 className="mb-1 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">Regras</h3>
        <ul className="space-y-1 font-mono text-xs text-texto-fraco">
          <li>· Período: {dataHora(comp.dataInicio)} até {dataHora(comp.dataFim)}.</li>
          <li className="text-texto">· Só valem clipes de partidas jogadas dentro do período — partidas de antes não contam.</li>
          <li>· Até {comp.limiteDiario} clipes por dia, {comp.limiteTotal} no total.</li>
          <li>· Mínimo de {comp.minimoParaRankear} clipes enviados pra entrar no ranking.</li>
          <li>· Pontuação: kills (curva não-linear) + headshots + clutch + variedade de armas.</li>
        </ul>
      </div>
```

5. Botão de envio (linha 80): `{!encerrada && !naoComecou && (`

6. No componente `Competicoes` (linhas 149-170): fallbacks ganham `agendadas: []`
(`{ ativa: null, agendadas: [], encerradas: [] }` nos dois lugares), estado vazio vira:

```jsx
      {!dados.ativa && (dados.agendadas ?? []).length === 0 && dados.encerradas.length === 0 && (
        <p className="font-mono text-sm text-texto-fraco">Nenhuma competição no momento.</p>
      )}
      {dados.ativa && <CardCompeticao comp={dados.ativa} viewerSteamId={jogador?.steamId} onTradelinkEnviado={carregar} />}
      {(dados.agendadas ?? []).map((comp) => (
        <CardCompeticao key={comp.id} comp={comp} viewerSteamId={jogador?.steamId} onTradelinkEnviado={carregar} />
      ))}
      {dados.encerradas.map((comp) => (
        <CardCompeticao key={comp.id} comp={comp} viewerSteamId={jogador?.steamId} onTradelinkEnviado={carregar} />
      ))}
```

- [ ] **Step 4: Rodar pra confirmar que passam**

Run: `cd site/client && npx vitest run src/test/Competicoes.test.jsx`
Expected: PASS (arquivo inteiro, incluindo os pré-existentes).

- [ ] **Step 5: Commit**

```bash
git add site/client/src/pages/Competicoes.jsx site/client/src/test/Competicoes.test.jsx
git commit -m "feat: competicao agendada aparece como em breve com regras explicitas"
```

---

### Task 3: Regressão completa

- [ ] **Step 1:** `cd site/server && npx vitest run` — Expected: PASS.
- [ ] **Step 2:** `cd site/client && npx vitest run` — Expected: PASS.
- [ ] **Step 3:** `git status --short` — nada solto.
