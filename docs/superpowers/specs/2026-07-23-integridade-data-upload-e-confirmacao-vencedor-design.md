# Integridade de data no upload manual + confirmação de vencedor — Design

**Data:** 2026-07-23

**Origem:** conversa sobre viabilidade de integração automática com Gamers Club — pesquisa
extensa confirmou que a GC não tem API pública nem webhook oficial (Termos de Uso proíbem
scraping/automação explicitamente, com risco real de banimento), então o caminho
suportado é o upload manual de demo, que já existe no sistema. Isso expôs um problema já
existente hoje, não específico da Gamers Club: o fluxo de upload manual (`EnviarDemo.jsx`)
aceita uma data de partida (`playedAt`) digitada pelo próprio jogador, sem nenhuma
validação de sanidade — confirmado, por pesquisa direta no formato `.dem` do CS2 (lido o
`.proto` oficial), que o arquivo de demo não guarda data/hora real em lugar nenhum, então
não existe forma de extrair a data verdadeira do próprio arquivo. Isso permite fraude de
elegibilidade de competição: baixar uma demo antiga e declarar uma data dentro do período
de uma competição em andamento.

## Objetivo

Reduzir a janela de fraude de data em uploads manuais (qualquer plataforma — Valve, FACEIT
ou Gamers Club enviados manualmente, não só GC) com uma validação automática de janela de
tolerância, e adicionar uma trava humana antes do prêmio ser liberado: o admin confirma
explicitamente o vencedor (revisando os clipes dele, com destaque pros que vieram de
upload manual) antes do jogador conseguir enviar o tradelink.

## Escopo

**Dentro:** validação server+client de `playedAt` no upload manual (janela de 3 dias),
nova etapa de confirmação de vencedor na tela de admin, bloqueio do formulário de
tradelink pro jogador até essa confirmação acontecer.

**Fora:** qualquer integração automática com Gamers Club (confirmado inviável — sem API,
sem webhook, Termos de Uso proíbem automação). Qualquer mudança na ingestão da FACEIT
(já é automática e confiável — `played_at` vem do campo `finished_at` da API oficial
deles, não é digitado por ninguém). Verificação criptográfica/prova formal de data — não
existe tecnicamente (arquivo `.dem` não guarda isso, Gamers Club não expõe nada
consultável); o que este spec entrega é mitigação de risco, não eliminação.

## Decisões já tomadas (contexto, não deste spec)

- FACEIT: integração (vínculo OAuth + ingestão automática via cron a cada 30 min) já está
  completa e em produção — não há nada "em desenvolvimento" pra sinalizar na UI, então
  **não** vamos adicionar nenhuma nota desse tipo (seria falsa).
- Gamers Club: sem caminho automático viável. O upload manual já é genérico por plataforma
  (`matches.plataforma_manual` já aceita `gamers_club` como rótulo informativo) — nenhum
  código novo específico de "suporte a Gamers Club" é necessário além do que este spec já
  cobre.

## Peça 1 — Validação de janela de data no upload manual

### Backend (`site/server/src/routes/upload.js`)

Hoje, `PLAYED_AT_RE` (linha 8) só valida formato (data/hora bem formada). Adicionar,
depois da checagem de formato (linhas 57-60), uma checagem de janela:

```javascript
const TOLERANCIA_DIAS = 3

// playedAt é digitado pelo jogador — o .dem não guarda data real em lugar nenhum
// (confirmado lendo o demo.proto oficial), então não dá pra verificar contra o arquivo.
// A janela de tolerância reduz a fraude "óbvia" (baixar demo antiga, declarar data
// dentro do período de uma competição em andamento) sem bloquear o caso legítimo (jogou
// há 1-2 dias, sobe agora). Não elimina o risco — só reduz a superfície de abuso.
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

Posicionamento exato: junto da validação de formato já existente (mesma função/handler),
antes do insert em `uploads_pendentes`.

### Frontend (`site/client/src/pages/EnviarDemo.jsx`)

Mesma checagem client-side antes do POST (linhas 128-138, campo `datetime-local`
"Quando foi jogada"), pra feedback imediato sem depender de round-trip ao servidor. Server
continua sendo a fonte da verdade — client é só UX.

### Sem mudança no fallback de mtime

Quando `playedAt` não é preenchido (campo opcional), o sistema já cai pro mtime do
arquivo — isso não passa por essa validação porque não é controlado pelo usuário (reflete
quando o Coletor processou o arquivo, sempre próximo de "agora").

## Peça 2 — Confirmação de vencedor antes do tradelink

### Modelo de dados

Nova migration `supabase/migrations/0050_confirmacao_vencedor.sql`:

```sql
alter table competicoes add column vencedor_confirmado_em timestamptz;
```

Nullable — `null` significa "vencedor calculado mas ainda não confirmado pelo admin".

### Backend (`site/server/src/routes/competicoes.js`)

- `mapCompeticao` passa a expor `vencedorConfirmado: c.vencedor_confirmado_em != null`
  (booleano — não expõe o timestamp em si, só o fato).
- Nova rota `PUT /:id/confirmar-vencedor` (`requireAuth`, `requireSuperAdmin`, mesmo
  padrão de `POST /admin`):
  - Valida UUID.
  - Carrega a competição; chama `calcularOuLerVencedor` (reaproveita a função já
    existente, garantindo que o vencedor seja calculado mesmo que ninguém tenha
    disparado `GET /` desde o encerramento — hoje `PUT /:id/tradelink` tem exatamente
    esse bug latente, lendo `vencedor_steam_id64` direto da tabela sem calcular).
  - Se `new Date() <= new Date(comp.data_fim)`: 400 "a competição ainda não encerrou".
  - Se não houver vencedor calculado (ninguém qualificado): 400 "essa competição não
    tem vencedor".
  - `update competicoes set vencedor_confirmado_em = coalesce(vencedor_confirmado_em,
    now()) where id = $1` — idempotente, não sobrescreve uma confirmação já feita.
  - `200 { ok: true }`.
- `PUT /:id/tradelink` (linhas 317-328) ganha uma checagem nova, logo depois de carregar
  `comp`: se `!comp.vencedor_confirmado_em`, `400 { erro: 'aguardando confirmação do
  admin' }` — bloqueia o jogador de enviar tradelink antes da confirmação, mesmo que ele
  tente direto pela API.
- `GET /` — a rota já expõe `clipesRecentes` (últimos 20 clipes da competição inteira,
  não por jogador). Pra dar ao admin uma visão completa dos clipes **do vencedor
  especificamente** na hora de confirmar, adicionar `vencedorSubmissoes` ao payload —
  presente só quando `ehVencedorOuAdmin` (mesma condição já usada pra `tradelinkVencedor`)
  **e** existe vencedor calculado **e** ainda não confirmado. Query nova (variação de
  `buscarClipesRecentes`, mas filtrada por `steam_id64` do vencedor, sem limite de 20 —
  o total de submissões por jogador já é limitado por `limite_total` da própria
  competição, tipicamente ≤10):

```javascript
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
    // confiável) — os outros (valve_mm/faceit/pro) vêm de fonte automática/oficial.
    origemNaoVerificada: r.source === 'upload',
    plataformaManual: r.plataforma_manual,
  }))
}
```

`join matches` (não `left join`) é seguro aqui — toda linha de `allstar_clips` usada em
`competicao_submissoes` já exige um `match_id` válido (constraint existente).

### Frontend — visão do admin (`site/client/src/pages/Admin.jsx`)

Hoje a listagem de competições (linhas 220-235) só mostra nome, período e "Editar" — não
consome `vencedorSteamId`/`vencedorConfirmado` do payload. Adicionar, dentro do `.map`,
condicionado a `c.vencedorSteamId && !c.vencedorConfirmado`:

- Card destacado: "Vencedor: `<nick>` — confira os clipes antes de confirmar."
- Lista dos clipes de `c.vencedorSubmissoes`, cada um com um badge de aviso quando
  `origemNaoVerificada` for `true` (ex.: "⚠️ upload manual — data não verificada",
  incluindo `plataformaManual` quando presente, ex.: "Gamers Club").
- Botão "Confirmar vencedor" → `PUT /api/competicoes/:id/confirmar-vencedor` → recarrega
  a lista.

Admin.jsx hoje busca competições em `carregarCompeticoes` (linhas 42-49) — sem mudança
necessária aí, o payload de `GET /api/competicoes` já vai trazer os campos novos.

### Frontend — visão do jogador (`site/client/src/pages/Competicoes.jsx`, `CardCompeticao`)

A condição atual do formulário de tradelink (linha 96) é
`souVencedor && encerrada && !comp.tradelinkVencedor`. Passa a ser:

```jsx
{souVencedor && encerrada && comp.vencedorConfirmado && !comp.tradelinkVencedor && (
  // ...formulário de tradelink, sem outra mudança...
)}
{souVencedor && encerrada && !comp.vencedorConfirmado && (
  <p className="mt-4 font-mono text-sm text-texto-fraco">
    Você está na liderança — aguardando confirmação do admin antes de liberar o envio do
    tradelink.
  </p>
)}
```

## Erros e casos extremos

- **Upload manual sem `playedAt` preenchido:** sem mudança — cai no fallback de mtime,
  fora do escopo desta validação.
- **Admin tenta confirmar antes da competição encerrar:** 400, mesma mensagem de padrão já
  usado em outras rotas desta mesma tabela.
- **Admin tenta confirmar duas vezes:** idempotente (`coalesce`), sempre `200`.
- **Jogador tenta enviar tradelink direto pela API antes da confirmação:** bloqueado no
  servidor (400), não só escondido no client — mesmo padrão de segurança já usado no
  resto do router (nunca confiar só na UI escondendo o formulário).
- **Competição sem nenhum clipe do vencedor vindo de upload manual:** `vencedorSubmissoes`
  não mostra nenhum aviso — admin ainda vê a lista completa, só sem o badge de risco.

## Testes

- **Servidor (`vitest`, `site/server/test/upload.test.js` se existir, senão criar; e
  `site/server/test/competicoes.test.js`):**
  - `POST /api/upload/...` com `playedAt` no futuro → 400.
  - `POST /api/upload/...` com `playedAt` mais de 3 dias no passado → 400.
  - `POST /api/upload/...` com `playedAt` dentro da janela → aceita normalmente.
  - `POST /api/upload/...` sem `playedAt` → aceita (sem mudança de comportamento).
  - `PUT /api/competicoes/:id/confirmar-vencedor`: 403 pra jogador comum, 400 se
    competição não encerrou, 400 sem vencedor calculado, 200 + grava
    `vencedor_confirmado_em` no caso válido, 200 idempotente numa segunda chamada.
  - `PUT /api/competicoes/:id/tradelink`: 400 quando `vencedor_confirmado_em` é `null`,
    mesmo sendo o próprio vencedor.
  - `GET /api/competicoes`: `vencedorSubmissoes` presente só pro vencedor/admin, com
    `origemNaoVerificada` refletindo corretamente `source = 'upload'`.
- **Client (`vitest` + testing-library):**
  - `EnviarDemo.jsx`: bloqueia submit com data fora da janela, mostra erro.
  - `Competicoes.jsx`: mostra a mensagem de "aguardando confirmação" em vez do formulário
    de tradelink quando `vencedorConfirmado` é `false`.
  - `Admin.jsx`: mostra o card de confirmação com os clipes e os badges de aviso; some
    depois de confirmar.
