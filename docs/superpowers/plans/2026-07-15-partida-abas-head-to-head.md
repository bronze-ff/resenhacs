# Abas na página de Partida + Head to Head em lista — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar `site/client/src/pages/Partida.jsx` em abas (Visão Geral,
Head to Head, Replay 2D, Economia, Utilitária, Clipes) e trocar o Head to Head
atual (modal por par, aberto via dropdown no Placar) por uma aba que lista o
jogador de referência contra todos os adversários do time contrário de uma
vez, com expand por adversário.

**Architecture:** Endpoint novo em lote no servidor (`GET
/api/matches/:id/head-to-head/:steamId`) substitui o antigo par-a-par. No
cliente, `Partida.jsx` ganha uma barra de abas simples (estado local, sem
router) que envolve as seções já existentes sem mudar o que elas fazem, mais
um componente novo `AbaHeadToHead` que consome o endpoint em lote.

**Tech Stack:** React (client), Express + `pg` (server), Vitest (ambos).

## Global Constraints

- Nada de métricas de mira (Time to Damage, Crosshair Placement,
  Counter-Strafing, Spotted Accuracy) — fora de escopo, sub-projeto futuro.
- A rota antiga `GET /:id/head-to-head/:steamIdA/:steamIdB` é REMOVIDA (não
  mantida em paralelo) — nada mais no cliente vai chamá-la depois da Task 3.
- `ModalHeadToHead`, `LinhaComparativa` (já existentes em `Partida.jsx`) e o
  dropdown "Comparar com…" dentro de `ArmasDoJogador`/`Scoreboard` também são
  removidos na Task 3 — a aba nova cobre o caso de uso.
- Segue o padrão visual já usado no arquivo: `panel-cut`/`panel-cut-sm`,
  `font-mono`/`font-display`, cores `texto`/`texto-fraco`/`destaque`/`time-a`/
  `time-b`/`sucesso`/`perigo` (já definidas em `client/src/index.css`).
- Sem testes de cliente novos para `Partida.jsx` — o arquivo não tem nenhum
  teste hoje (nem os recursos anteriores desse mesmo arquivo tiveram),
  seguindo o padrão já estabelecido no projeto. Verificação é: suíte de
  servidor (que cobre a rota nova), `npm run build` do cliente, e checagem
  visual no browser.

---

### Task 1: Endpoint em lote do Head to Head (servidor)

**Files:**
- Modify: `site/server/src/routes/matches.js:330-379` (rota antiga removida, rota nova no lugar)
- Modify: `site/server/test/matches.test.js` (substitui o describe da rota antiga)

**Interfaces:**
- Produces: `GET /api/matches/:id/head-to-head/:steamId` → `{ steamId, oponentes: [{ steamId, nick, avatarUrl, team, kills, deaths, killsPorCategoria, killsPorCategoriaRecebido, dano, danoRecebido, flashes: { porMim: { vezes, duracao }, porEle: { vezes, duracao } } }] }`. 404 com `{ erro }` se a partida não existe no grupo OU `steamId` não jogou essa partida.
- Consumes: `categoriaArma(weapon)` (já existe no topo do arquivo, linha 16 — não mexer).

- [ ] **Step 1: Remover a rota antiga e escrever a rota nova**

Em `site/server/src/routes/matches.js`, substitua o bloco inteiro de
`// Head to Head: kills por categoria...` até o `})` que fecha a rota
(linhas 330-379 no arquivo atual) por:

```js
  // Head to Head: jogador de referência (steamId) comparado contra TODOS os
  // adversários do time contrário nessa Partida (estilo Leetify) — kills por
  // categoria de arma, dano e flashes, nas duas direções, numa chamada só.
  router.get('/:id/head-to-head/:steamId', requireAuth, requireGroupMember, async (req, res) => {
    const { id, steamId } = req.params
    const jogadorQ = await db.query(
      `select mp.team from matches m join match_players mp on mp.match_id = m.id
       where m.id = $1 and m.group_id = $2 and mp.steam_id64 = $3`,
      [id, req.groupId, steamId],
    )
    if (jogadorQ.rows.length === 0) return res.status(404).json({ erro: 'Partida ou jogador não encontrado' })
    const timeReferencia = jogadorQ.rows[0].team

    const oponentesQ = await db.query(
      `select mp.steam_id64, mp.nick, mp.team, coalesce(p.avatar_url, sa.avatar_url) as avatar_url
       from match_players mp
       left join players p on p.steam_id64 = mp.steam_id64
       left join steam_avatares sa on sa.steam_id64 = mp.steam_id64
       where mp.match_id = $1 and mp.team != $2`,
      [id, timeReferencia],
    )
    const oponentes = oponentesQ.rows
    const steamIdsOponentes = oponentes.map((o) => o.steam_id64)
    if (steamIdsOponentes.length === 0) return res.json({ steamId, oponentes: [] })

    const [kills, damage, flashes] = await Promise.all([
      db.query(
        `select killer, victim, weapon from kill_positions
         where match_id = $1 and ((killer = $2 and victim = any($3)) or (victim = $2 and killer = any($3)))`,
        [id, steamId, steamIdsOponentes],
      ),
      db.query(
        `select attacker, victim, damage from match_player_damage
         where match_id = $1 and ((attacker = $2 and victim = any($3)) or (victim = $2 and attacker = any($3)))`,
        [id, steamId, steamIdsOponentes],
      ),
      db.query(
        `select attacker, victim, count, duration_sum from match_player_flashes
         where match_id = $1 and ((attacker = $2 and victim = any($3)) or (victim = $2 and attacker = any($3)))`,
        [id, steamId, steamIdsOponentes],
      ),
    ])

    const vazio = () => ({
      kills: 0, deaths: 0, killsPorCategoria: {}, killsPorCategoriaRecebido: {},
      dano: 0, danoRecebido: 0,
      flashes: { porMim: { vezes: 0, duracao: 0 }, porEle: { vezes: 0, duracao: 0 } },
    })
    const porOponente = new Map(steamIdsOponentes.map((sid) => [sid, vazio()]))

    for (const k of kills.rows) {
      const oponente = k.killer === steamId ? k.victim : k.killer
      const linha = porOponente.get(oponente)
      if (!linha) continue
      const cat = categoriaArma(k.weapon)
      if (k.killer === steamId) {
        linha.kills += 1
        linha.killsPorCategoria[cat] = (linha.killsPorCategoria[cat] ?? 0) + 1
      } else {
        linha.deaths += 1
        linha.killsPorCategoriaRecebido[cat] = (linha.killsPorCategoriaRecebido[cat] ?? 0) + 1
      }
    }
    for (const d of damage.rows) {
      const oponente = d.attacker === steamId ? d.victim : d.attacker
      const linha = porOponente.get(oponente)
      if (!linha) continue
      if (d.attacker === steamId) linha.dano += d.damage
      else linha.danoRecebido += d.damage
    }
    for (const f of flashes.rows) {
      const oponente = f.attacker === steamId ? f.victim : f.attacker
      const linha = porOponente.get(oponente)
      if (!linha) continue
      if (f.attacker === steamId) {
        linha.flashes.porMim.vezes += f.count
        linha.flashes.porMim.duracao += Number(f.duration_sum)
      } else {
        linha.flashes.porEle.vezes += f.count
        linha.flashes.porEle.duracao += Number(f.duration_sum)
      }
    }

    res.json({
      steamId,
      oponentes: oponentes.map((o) => ({
        steamId: o.steam_id64, nick: o.nick, avatarUrl: o.avatar_url, team: o.team,
        ...porOponente.get(o.steam_id64),
      })),
    })
  })
```

- [ ] **Step 2: Substituir os testes da rota antiga pelos da rota nova**

Em `site/server/test/matches.test.js`, encontre o `describe` de
`GET /api/matches/:id/head-to-head/:steamIdA/:steamIdB` (se existir — pode já
ter sido escrito num commit anterior a esse plano) e substitua por:

```js
describe('GET /api/matches/:id/head-to-head/:steamId', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    expect((await request(app).get('/api/matches/m1/head-to-head/765')).status).toBe(401)
  })

  it('jogador nao encontrado nessa partida do grupo: 404', async () => {
    const { app } = appWith([['from matches m join match_players mp', []]])
    const res = await request(app).get('/api/matches/m1/head-to-head/765').set('Cookie', cookie).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(404)
  })

  it('compara o jogador contra todos os adversarios do time contrario numa chamada so', async () => {
    const { app } = appWith([
      ['from matches m join match_players mp', [{ team: 'A' }]],
      ['from match_players mp\n       left join players p', [
        { steam_id64: '999', nick: 'adversario', team: 'B', avatar_url: null },
      ]],
      ['from kill_positions', [
        { killer: '765', victim: '999', weapon: 'deagle' },
        { killer: '999', victim: '765', weapon: 'ak47' },
      ]],
      ['from match_player_damage', [
        { attacker: '765', victim: '999', damage: 100 },
        { attacker: '999', victim: '765', damage: 40 },
      ]],
      ['from match_player_flashes', [
        { attacker: '765', victim: '999', count: 1, duration_sum: '1.50' },
      ]],
    ])
    const res = await request(app).get('/api/matches/m1/head-to-head/765').set('Cookie', cookie).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      steamId: '765',
      oponentes: [{
        steamId: '999', nick: 'adversario', avatarUrl: null, team: 'B',
        kills: 1, deaths: 1,
        killsPorCategoria: { Pistolas: 1 }, killsPorCategoriaRecebido: { Rifles: 1 },
        dano: 100, danoRecebido: 40,
        flashes: { porMim: { vezes: 1, duracao: 1.5 }, porEle: { vezes: 0, duracao: 0 } },
      }],
    })
  })

  it('sem adversario do outro time: retorna lista vazia', async () => {
    const { app } = appWith([
      ['from matches m join match_players mp', [{ team: 'A' }]],
      ['from match_players mp\n       left join players p', []],
    ])
    const res = await request(app).get('/api/matches/m1/head-to-head/765').set('Cookie', cookie).set('X-Group-Id', GRUPO)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ steamId: '765', oponentes: [] })
  })
})
```

Verifique o helper `appWith` no topo do arquivo (a função que casa fragmentos
de SQL com resultados mockados) pra confirmar que o formato de chave usado
acima (prefixo do SQL) bate com o padrão dos outros testes do arquivo — ajuste
os prefixos das chaves se o helper usar `startsWith` num trecho diferente do
que foi assumido aqui (ex.: se o helper corta antes de `left join`, use só
`'from match_players mp'` como chave).

- [ ] **Step 3: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: todos os testes passam (incluindo os 4 novos acima), nenhum teste
antigo referenciando `/:steamIdA/:steamIdB` sobrando.

- [ ] **Step 4: Commit**

```bash
git add site/server/src/routes/matches.js site/server/test/matches.test.js
git commit -m "feat: head to head em lote (1 jogador vs todos os adversarios do time contrario)"
```

---

### Task 2: Infraestrutura de abas em Partida.jsx (sem mudar conteúdo ainda)

**Files:**
- Modify: `site/client/src/pages/Partida.jsx`

**Interfaces:**
- Produces: componente `BarraAbas({ abas, ativa, onSelecionar })` e constante
  `ABAS = [{ id: 'geral', label: 'Visão Geral' }, { id: 'h2h', label: 'Head to Head' }, { id: 'replay', label: 'Replay 2D' }, { id: 'economia', label: 'Economia' }, { id: 'utilitaria', label: 'Utilitária' }, { id: 'clipes', label: 'Clipes' }]`.
  Estado `abaAtiva` (default `'geral'`) dentro de `Partida()`.
- Consumes: nada novo — só reorganiza JSX que já existe.

- [ ] **Step 1: Adicionar `BarraAbas` e a constante `ABAS`**

Em `site/client/src/pages/Partida.jsx`, logo antes de
`export default function Partida() {` (linha 908 no arquivo atual), adicione:

```jsx
const ABAS = [
  { id: 'geral', label: 'Visão Geral' },
  { id: 'h2h', label: 'Head to Head' },
  { id: 'replay', label: 'Replay 2D' },
  { id: 'economia', label: 'Economia' },
  { id: 'utilitaria', label: 'Utilitária' },
  { id: 'clipes', label: 'Clipes' },
]

// Barra de abas da Partida — mesmo padrão visual do toggle Replay 2D/Mapa de
// calor (botões num trilho, aba ativa em destaque), só que ocupando a largura
// toda e com scroll horizontal no mobile (6 abas não cabem em 375px).
function BarraAbas({ abas, ativa, onSelecionar }) {
  return (
    <div className="flex overflow-x-auto rounded border border-borda font-mono text-xs uppercase">
      {abas.map((a) => (
        <button
          key={a.id}
          onClick={() => onSelecionar(a.id)}
          className={`flex-shrink-0 whitespace-nowrap px-3 py-2 transition-colors ${
            ativa === a.id ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Adicionar o estado `abaAtiva` e trocar o highlight deep-link pra ativar a aba Replay 2D**

Dentro de `export default function Partida()`, logo abaixo de `const [seek, setSeek] = useState(null)`:

```jsx
  const [abaAtiva, setAbaAtiva] = useState('geral')
```

E troque a função `irParaMomento` (que hoje só dá seek + scroll) pra também
trocar de aba primeiro:

```jsx
  function irParaMomento(round, frame) {
    setAbaAtiva('replay')
    setSeek({ round, frame, key: `${round}-${frame}-${Date.now()}` })
    replayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
```

(`replayRef.current?.scrollIntoView` só vai achar o elemento se a aba Replay
2D já estiver montada — como `setAbaAtiva('replay')` roda antes na mesma
função, e React aplica os `setState` da mesma função de forma síncrona antes
do próximo paint, o `scrollIntoView` no final da função ainda vê o DOM antigo.
Troque a chamada de scroll pra dentro de um `useEffect` que reage à troca de
aba: adicione, junto dos outros `useEffect` do componente,

```jsx
  useEffect(() => {
    if (abaAtiva === 'replay' && seek) {
      replayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abaAtiva])
```

e remova a linha `replayRef.current?.scrollIntoView(...)` de dentro de
`irParaMomento` — ela fica só nesse `useEffect` novo.)

- [ ] **Step 3: Inserir a barra de abas e envolver cada seção existente num `if` de aba**

Logo depois do bloco do cabeçalho (`</div>` que fecha a `<div className="flex flex-col gap-3 sm:flex-row...">` do topo) e antes do `<div className="grid gap-4 lg:grid-cols-2">` do Placar, insira:

```jsx
      <BarraAbas abas={ABAS} ativa={abaAtiva} onSelecionar={setAbaAtiva} />
```

Envolva cada bloco de seção existente (Placar+Highlights, Replay 2D+Linha do
tempo, Economia, Utilitária, Clipes) numa condicional de aba, SEM remover o
`<SectionHeader titulo="...">` de cada uma ainda (isso é responsabilidade da
Task 3 e da Task 2 Step 4, nessa ordem, pra manter o diff revisável em
pedaços pequenos). Estrutura final dessa etapa:

```jsx
      {abaAtiva === 'geral' && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Scoreboard time="A" jogadores={timeA} oponentes={timeB} matchId={m.id} podePromover={jogador?.isSuperAdmin} onPromover={promover} promovendo={promovendo} />
            <Scoreboard time="B" jogadores={timeB} oponentes={timeA} matchId={m.id} podePromover={jogador?.isSuperAdmin} onPromover={promover} promovendo={promovendo} />
          </div>
          {m.highlights.length > 0 && (
            <section>
              <SectionHeader titulo="Highlights" />
              {/* ...conteúdo de Highlights que já existe... */}
            </section>
          )}
        </>
      )}

      {abaAtiva === 'replay' && (
        <>
          <section ref={replayRef}>
            <SectionHeader titulo="Replay 2D" />
            <SecaoReplay replayUrl={m.replayUrl} seek={seek} onSelecionarPonto={({ round, frame }) => irParaMomento(round, frame)} />
          </section>
          <section>
            <SectionHeader titulo="Linha do tempo dos rounds" />
            <LinhaDoTempoRounds rounds={m.rounds} highlights={m.highlights} timeDoGrupo={timeDoGrupo} onClicarHighlight={irParaHighlight} replayDisponivel={!!m.replayUrl} matchId={m.id} map={m.map} />
          </section>
        </>
      )}

      {abaAtiva === 'economia' && m.economia?.length > 0 && (
        <section>
          <SectionHeader titulo="Economia" />
          <LinhaDoTempoEconomia economia={m.economia} timeDoGrupo={timeDoGrupo} timeA={timeA} timeB={timeB} />
        </section>
      )}

      {abaAtiva === 'utilitaria' && (
        <section>
          <SectionHeader titulo="Utilitária" />
          <TabelaUtilitaria timeA={timeA} timeB={timeB} />
        </section>
      )}

      {abaAtiva === 'clipes' && (
        <section>
          <SectionHeader titulo="Clipes" />
          {/* ...conteúdo de Clipes que já existe... */}
        </section>
      )}
```

(A aba `'h2h'` fica pendente — Task 3 adiciona o conteúdo dela. Deixe, por
enquanto, um placeholder: `{abaAtiva === 'h2h' && <p className="font-mono text-sm text-texto-fraco">Em construção.</p>}`.)

Mova o conteúdo real de cada seção (o que já está escrito hoje, entre as
linhas ~1077-1140 do arquivo atual) pra dentro dos blocos acima — não
reescreva o conteúdo, só mude onde ele está aninhado.

- [ ] **Step 4: Rodar o build do cliente**

Run: `cd site/client && npm run build`
Expected: build sem erros.

- [ ] **Step 5: Commit**

```bash
git add site/client/src/pages/Partida.jsx
git commit -m "feat: reorganiza a pagina de Partida em abas (Visao Geral, Head to Head, Replay 2D, Economia, Utilitaria, Clipes)"
```

---

### Task 3: Aba Head to Head + remoção do modal/dropdown antigo

**Files:**
- Modify: `site/client/src/pages/Partida.jsx`

**Interfaces:**
- Consumes: `GET /api/matches/:id/head-to-head/:steamId` (Task 1), `useAuth()`
  já importado no arquivo (`jogador` com `.steamId`), `Avatar`, `SetaExpandir`,
  `LinhaComparativa`, `CATEGORIAS_ARMA_ORDEM` (já existem no arquivo).
- Produces: componente `AbaHeadToHead({ matchId, jogadores, jogadorLogado })`.

- [ ] **Step 1: Remover o dropdown "Comparar com…" de `ArmasDoJogador`**

Em `ArmasDoJogador` (função atual em `Partida.jsx`), remova o parâmetro
`oponentes`/`onAbrirHeadToHead` e todo o bloco do `<select>` +
botão "Head to Head". A função final fica:

```jsx
function ArmasDoJogador({ weapons, onAbrirDetalhe }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-1 py-2">
      {(!weapons || weapons.length === 0) ? (
        <p className="font-mono text-xs text-texto-fraco">Sem kills registrados nessa partida.</p>
      ) : (
        weapons.map((w) => (
          <div
            key={w.weapon}
            className="panel-cut-sm flex items-center gap-2 border border-borda bg-superficie px-2 py-1 font-mono text-xs"
          >
            <span className="font-semibold text-texto">{nomeArma(w.weapon)}</span>
            <span className="text-texto-fraco">{w.kills} kill{w.kills === 1 ? '' : 's'}</span>
            {w.hsKills > 0 && <span className="text-texto-fraco">· {w.hsKills} HS</span>}
          </div>
        ))
      )}
      <button
        onClick={onAbrirDetalhe}
        className="ml-auto panel-cut-sm border border-borda px-2 py-1 font-mono text-xs text-texto-fraco transition-colors hover:border-destaque hover:text-destaque"
      >
        Ver detalhe por round →
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Remover `head2head`/`ModalHeadToHead` de `Scoreboard`**

Em `Scoreboard`, remova o estado `const [head2head, setHead2head] = useState(null)`,
o bloco `{head2head && <ModalHeadToHead .../>}` no final, e simplifique a
chamada de `ArmasDoJogador` de volta pra:

```jsx
                      <ArmasDoJogador weapons={p.weapons} onAbrirDetalhe={() => setDetalheAberto(p)} />
```

Remova também a prop `oponentes` de `Scoreboard` (não é mais usada por ele) —
mas mantenha o parâmetro na assinatura por enquanto sem uso é desnecessário:
remova `oponentes` da assinatura de `Scoreboard({ time, jogadores, oponentes, matchId, ... })`
too, já que ele só existia pra alimentar o dropdown removido.

- [ ] **Step 3: Deletar o componente `ModalHeadToHead` inteiro**

Remova a função `ModalHeadToHead` completa (a que faz fetch de
`/head-to-head/:steamIdA/:steamIdB` e renderiza o modal fixo) — não é mais
chamada por ninguém depois do Step 2. Mantenha `LinhaComparativa` e
`CATEGORIAS_ARMA_ORDEM` (são reaproveitados pela aba nova no Step 4).

- [ ] **Step 4: Escrever `AbaHeadToHead`**

Adicione, logo depois de `LinhaComparativa` (que permanece no arquivo):

```jsx
// Aba Head to Head: jogador de referência (default = você, se jogou essa
// Partida) comparado contra TODOS os adversários do time contrário de uma
// vez — kills/dano em cada linha, expande pra ver o weapon breakdown +
// flashes trocados com aquele adversário específico.
function AbaHeadToHead({ matchId, jogadores, jogadorLogado }) {
  const jogouEssaPartida = jogadores.some((p) => p.steamId === jogadorLogado?.steamId)
  const [referenciaId, setReferenciaId] = useState(jogouEssaPartida ? jogadorLogado.steamId : '')
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(false)
  const [expandido, setExpandido] = useState(null)

  useEffect(() => {
    if (!referenciaId) {
      setDados(null)
      return
    }
    setDados(null)
    setErro(false)
    setExpandido(null)
    fetch(`/api/matches/${matchId}/head-to-head/${referenciaId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setDados)
      .catch(() => setErro(true))
  }, [matchId, referenciaId])

  const referencia = jogadores.find((p) => p.steamId === referenciaId)

  return (
    <div className="space-y-3">
      <label className="flex flex-wrap items-center gap-2 font-mono text-xs text-texto-fraco">
        Comparando:
        <select
          value={referenciaId}
          onChange={(e) => setReferenciaId(e.target.value)}
          className="cursor-pointer rounded border border-borda bg-superficie px-2 py-1.5 font-mono text-xs text-texto"
        >
          <option value="">Escolha um jogador…</option>
          {jogadores.map((p) => (
            <option key={p.steamId} value={p.steamId}>{p.nick || p.steamId}</option>
          ))}
        </select>
      </label>

      {!referenciaId && <p className="font-mono text-sm text-texto-fraco">Escolha um jogador pra comparar contra o time adversário.</p>}
      {referenciaId && erro && <p className="font-mono text-sm text-perigo">Não foi possível carregar o comparativo.</p>}
      {referenciaId && !erro && !dados && <p className="font-mono text-sm text-texto-fraco">Carregando…</p>}
      {dados && dados.oponentes.length === 0 && <p className="font-mono text-sm text-texto-fraco">Sem adversários pra comparar.</p>}

      {dados?.oponentes.map((o) => {
        const aberto = expandido === o.steamId
        const categorias = CATEGORIAS_ARMA_ORDEM.filter((c) => o.killsPorCategoria[c] || o.killsPorCategoriaRecebido[c])
        const semFlash = o.flashes.porMim.vezes === 0 && o.flashes.porEle.vezes === 0
        return (
          <div key={o.steamId} className="panel-cut-sm border border-borda bg-superficie">
            <button
              onClick={() => setExpandido(aberto ? null : o.steamId)}
              className="flex w-full flex-wrap items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-superficie-alta"
            >
              <span className="flex min-w-0 items-center gap-2 font-mono text-sm">
                <Avatar p={referencia} />
                <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-texto">{o.kills}</span>
              </span>
              <div className="flex h-3 min-w-[80px] flex-1 flex-row-reverse overflow-hidden rounded-sm bg-fundo">
                <div className="h-full bg-time-a" style={{ width: `${(o.dano / Math.max(o.dano, o.danoRecebido, 1)) * 100}%` }} />
              </div>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-texto-fraco">dano</span>
              <div className="flex h-3 min-w-[80px] flex-1 overflow-hidden rounded-sm bg-fundo">
                <div className="h-full bg-time-b" style={{ width: `${(o.danoRecebido / Math.max(o.dano, o.danoRecebido, 1)) * 100}%` }} />
              </div>
              <span className="flex min-w-0 items-center gap-2 font-mono text-sm">
                <span className="w-6 shrink-0 tabular-nums text-texto">{o.deaths}</span>
                <Avatar p={o} />
                <span className="truncate text-texto">{o.nick || o.steamId}</span>
              </span>
              <SetaExpandir aberto={aberto} />
            </button>
            {aberto && (
              <div className="space-y-1.5 border-t border-borda/60 px-3 py-2.5">
                {categorias.length === 0 && (
                  <p className="font-mono text-xs text-texto-fraco">Nenhuma kill entre os dois nessa Partida.</p>
                )}
                {categorias.map((cat) => (
                  <LinhaComparativa key={cat} label={cat} valorA={o.killsPorCategoria[cat] ?? 0} valorB={o.killsPorCategoriaRecebido[cat] ?? 0} />
                ))}
                {semFlash ? (
                  <p className="font-mono text-xs text-texto-fraco">Nenhum dos dois flashou o outro.</p>
                ) : (
                  <LinhaComparativa label="Flashes" valorA={o.flashes.porMim.vezes} valorB={o.flashes.porEle.vezes} />
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 5: Ligar a aba na `Partida()`**

Troque o placeholder `{abaAtiva === 'h2h' && <p>...</p>}` (da Task 2, Step 3) por:

```jsx
      {abaAtiva === 'h2h' && (
        <section>
          <SectionHeader titulo="Head to Head" />
          <AbaHeadToHead matchId={m.id} jogadores={m.players} jogadorLogado={jogador} />
        </section>
      )}
```

- [ ] **Step 6: Remover o `<SectionHeader titulo="...">` duplicado das outras abas**

Como o label da aba já identifica a seção (Task 2 deixou os `SectionHeader`
por segurança), remova agora o `<SectionHeader titulo="..."/>` de dentro de
cada bloco de aba de Task 2 (Visão Geral não tinha um `SectionHeader` próprio
pro Placar, então fica só o de "Highlights" — pode manter esse, já que
"Visão Geral" engloba duas coisas; os das outras abas — "Replay 2D", "Linha
do tempo dos rounds", "Economia", "Utilitária", "Clipes", "Head to Head" —
saem, pois cada aba já é uma coisa só).

- [ ] **Step 7: Rodar o build do cliente**

Run: `cd site/client && npm run build`
Expected: build sem erros, sem warnings de import não usado (`ModalHeadToHead`
removido, `oponentes` removido de `Scoreboard`/`ArmasDoJogador`).

- [ ] **Step 8: Verificação manual no browser**

Abra uma Partida existente, confira: as 6 abas trocam de conteúdo; a aba Head
to Head mostra o seletor, default pro jogador logado se ele jogou essa
Partida; expandir uma linha mostra o weapon breakdown + flashes; um link com
`?highlight=<id>` (a partir do Perfil do Jogador) abre a Partida já na aba
Replay 2D com o seek certo.

- [ ] **Step 9: Commit**

```bash
git add site/client/src/pages/Partida.jsx
git commit -m "feat: aba Head to Head em lista (troca o modal por par) + limpeza dos SectionHeader duplicados"
```

---

### Task 4: Verificação final

- [ ] **Step 1: Rodar as 3 suítes**

Run: `cd site/server && npm test && cd ../client && npm test -- --run`
Expected: todas passam (servidor com os testes novos da Task 1, cliente sem
mudança na contagem — 26 testes, nenhum novo).

- [ ] **Step 2: Build do cliente**

Run: `cd site/client && npm run build`
Expected: sem erros.

- [ ] **Step 3: Push**

```bash
git push
```
