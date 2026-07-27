# Abas na página de Partida + Head to Head em lista

## Objetivo

Reorganizar a página de Partida (`site/client/src/pages/Partida.jsx`) em abas, no
estilo Leetify, e trocar o Head to Head atual (modal por par, aberto via dropdown
dentro do Placar) por uma aba dedicada que lista o jogador de referência contra
todos os adversários do time contrário de uma vez, com expand por adversário pro
weapon breakdown.

## Contexto atual

A página hoje é uma pilha vertical de seções (`<section>` com `SectionHeader`):
Placar (times A/B, com "ver kills por arma" + "detalhe por round" por jogador,
incluindo o dropdown "Comparar com…" que abre `ModalHeadToHead`), Replay 2D
(+ Mapa de calor), Linha do tempo dos rounds, Highlights, Economia, Utilitária,
Clipes. O deep-link `?highlight=<id>` rola a página até o Replay 2D e dá seek.

Já existe `GET /api/matches/:id/head-to-head/:steamIdA/:steamIdB`
(`site/server/src/routes/matches.js`), que compara exatamente 2 jogadores:
kills por categoria de arma (`CATEGORIA_ARMA`/`categoriaArma`), dano total e
flashes trocados, olhando `kill_positions`, `match_player_damage`,
`match_player_flashes`.

## Arquitetura

### 1. Abas

`Partida.jsx` ganha um estado `abaAtiva` (string), com uma barra de abas logo
abaixo do cabeçalho fixo (mapa, placar, badge de resultado — que continua fora
das abas, sempre visível). Abas, cada uma reaproveitando os componentes/seções
que já existem, só removendo o `<SectionHeader>` de cada uma (o nome da aba já
identifica a seção):

1. **Visão Geral** (padrão): os dois `Scoreboard` (Placar A/B) + Highlights.
2. **Head to Head**: aba nova (ver seção 2).
3. **Replay 2D**: `SecaoReplay` + `LinhaDoTempoRounds`.
4. **Economia**: `LinhaDoTempoEconomia` (só renderiza a aba se `m.economia?.length > 0`).
5. **Utilitária**: `TabelaUtilitaria`.
6. **Clipes**: lista de clipes + `FormClipe`.

O deep-link de Highlight (`?highlight=<id>`) passa a setar `abaAtiva` pra
`'replay'` antes de chamar `irParaMomento` (hoje só dava scroll — com abas, a
seção só existe no DOM quando a aba está ativa).

Implementação: um array `ABAS = [{ id, label }]` e um componente `BarraAbas`
simples (botões, aba ativa com sublinhado/cor destaque — reaproveita o padrão
visual já usado em `SecaoReplay` pro toggle Replay 2D / Mapa de calor). Cada
aba renderiza seu conteúdo com `abaAtiva === id ? <>...</> : null` (sem
lazy-mount complexo — os dados da partida (`m`) já vieram todos juntos no fetch
inicial, só o Head to Head builda sua própria aba com fetch lazy).

### 2. Aba Head to Head

**Referência**: o jogador "âncora" da lista (o "You" do Leetify). Default:
- Se o usuário logado (`jogador` do `useAuth()`) está entre `m.players`, ele é a
  referência.
- Caso contrário (ele não jogou essa partida — só está vendo de outra pessoa do
  grupo), não há default: mostra o seletor já aberto/obrigatório.

Um seletor (`<select>`, mesmo padrão visual do "Comparar com…" que está sendo
removido) permite trocar a referência pra qualquer um dos `m.players`, sempre
visível no topo da aba (não só quando não há default).

**Lista**: uma linha por jogador do time **contrário ao da referência**
(`m.players.filter(p => p.team !== referencia.team)`). Cada linha, sempre
visível:
- Avatar + nick da referência (mesmo pra todas as linhas, à esquerda)
- Número de kills da referência sobre esse adversário
- Barra espelhada de dano (dano que a referência causou nele | dano que ele
  causou na referência) — mesmo componente `LinhaComparativa` que já existe,
  reaproveitado
- Número de kills do adversário sobre a referência
- Avatar + nick do adversário (à direita)
- Seta de expandir (mesmo `SetaExpandir` já existente)

**Expandida**: weapon breakdown (uma `LinhaComparativa` por categoria de arma
que apareceu nesse confronto, kills da referência vs kills do adversário) +
flashes (uma `LinhaComparativa`: quantas vezes a referência flashou o
adversário vs quantas vezes foi flashada por ele — ou "Nenhum dos dois flashou
o outro" quando os dois lados são 0).

**Remoção**: o dropdown "Comparar com…" + botão "Head to Head" saem de
`ArmasDoJogador` (fica só o "Ver detalhe por round →"), e `ModalHeadToHead`
junto com o estado `head2head` saem de `Scoreboard` — a aba nova cobre
totalmente esse caso de uso, então manter os dois seria duplicar a mesma
funcionalidade de dois jeitos diferentes.

### 3. Endpoint em lote

Novo `GET /api/matches/:id/head-to-head/:steamId` — substitui a necessidade de
5 chamadas (uma por adversário) por 1 chamada que já traz a comparação contra
todos os jogadores do time contrário ao de `steamId` nessa partida.

```js
router.get('/:id/head-to-head/:steamId', requireAuth, requireGroupMember, async (req, res) => {
  const { id, steamId } = req.params
  const matchQ = await db.query(
    `select mp.team from matches m join match_players mp on mp.match_id = m.id
     where m.id = $1 and m.group_id = $2 and mp.steam_id64 = $3`,
    [id, req.groupId, steamId],
  )
  if (matchQ.rows.length === 0) return res.status(404).json({ erro: 'Partida ou jogador não encontrado' })
  const timeReferencia = matchQ.rows[0].team

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
    if (k.killer === steamId) {
      linha.kills += 1
      const cat = categoriaArma(k.weapon)
      linha.killsPorCategoria[cat] = (linha.killsPorCategoria[cat] ?? 0) + 1
    } else {
      linha.deaths += 1
      const cat = categoriaArma(k.weapon)
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

O `categoriaArma`/`CATEGORIA_ARMA` já existentes no arquivo são reaproveitados
(sem duplicar). A rota antiga de par único (`/:steamIdA/:steamIdB`) é removida
— nada mais a consome depois da troca.

### 4. Cliente — componentes novos

`ModalHeadToHead` e `LinhaComparativa` (já escritos) deixam de ser modal e
viram peças da aba: `LinhaComparativa` é reaproveitado como está (só recebe
`label`/`valorA`/`valorB`). A aba em si:

```jsx
function AbaHeadToHead({ matchId, jogadores, jogadorLogado }) {
  const jogaEssaPartida = jogadores.find((p) => p.steamId === jogadorLogado?.steamId)
  const [referenciaId, setReferenciaId] = useState(jogaEssaPartida?.steamId ?? '')
  const referencia = jogadores.find((p) => p.steamId === referenciaId)
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(false)
  const [expandido, setExpandido] = useState(null)

  useEffect(() => {
    if (!referenciaId) return
    setDados(null)
    setErro(false)
    fetch(`/api/matches/${matchId}/head-to-head/${referenciaId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setDados)
      .catch(() => setErro(true))
  }, [matchId, referenciaId])

  return (
    <div className="space-y-3">
      <select value={referenciaId} onChange={(e) => setReferenciaId(e.target.value)} className="...">
        <option value="">Escolha um jogador…</option>
        {jogadores.map((p) => <option key={p.steamId} value={p.steamId}>{p.nick || p.steamId}</option>)}
      </select>
      {!referenciaId && <p className="...">Escolha um jogador pra comparar.</p>}
      {referenciaId && erro && <p className="text-perigo">Não foi possível carregar.</p>}
      {referenciaId && !erro && !dados && <p className="...">Carregando…</p>}
      {dados?.oponentes.map((o) => (
        <div key={o.steamId} className="panel-cut-sm border border-borda bg-superficie">
          <button onClick={() => setExpandido(expandido === o.steamId ? null : o.steamId)} className="w-full ...">
            <Avatar p={referencia} /> <span>{o.kills}</span>
            <LinhaComparativa label="Dano" valorA={o.dano} valorB={o.danoRecebido} />
            <span>{o.deaths}</span> <Avatar p={o} /> {o.nick}
            <SetaExpandir aberto={expandido === o.steamId} />
          </button>
          {expandido === o.steamId && (
            <div className="...">
              {CATEGORIAS_ARMA_ORDEM.filter((c) => o.killsPorCategoria[c] || o.killsPorCategoriaRecebido[c]).map((c) => (
                <LinhaComparativa key={c} label={c} valorA={o.killsPorCategoria[c] ?? 0} valorB={o.killsPorCategoriaRecebido[c] ?? 0} />
              ))}
              {o.flashes.porMim.vezes === 0 && o.flashes.porEle.vezes === 0 ? (
                <p>Nenhum dos dois flashou o outro.</p>
              ) : (
                <LinhaComparativa label="Flashes" valorA={o.flashes.porMim.vezes} valorB={o.flashes.porEle.vezes} />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

(Trecho ilustrativo — classes Tailwind exatas e o "vs" central saem no plano.)

## Testes

- Servidor: substituir os testes do `/:id/head-to-head/:steamIdA/:steamIdB` por
  testes do novo `/:id/head-to-head/:steamId` (404 sem jogador/partida no
  grupo, agregação correta de kills/dano/flashes nos dois sentidos, times
  corretamente identificados via `match_players.team`).
- Cliente: teste de que a aba Head to Head troca de conteúdo ao clicar nas
  abas, que o seletor de referência funciona, e que expandir uma linha mostra
  o weapon breakdown. Teste de que o deep-link `?highlight=` ativa a aba
  Replay 2D.

## Fora de escopo

- Métricas de mira (Time to Damage, Crosshair Placement, Counter-Strafing,
  Spotted Accuracy) — sub-projeto separado, já combinado antes.
- "Rating Breakdown" e "Map Zones" do Leetify não têm equivalente nos nossos
  dados hoje — não entram.
