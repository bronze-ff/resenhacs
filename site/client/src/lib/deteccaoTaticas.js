// Detecção automática de táticas (execute/setup) a partir da utilitária extraída
// das demos (fase 4). Puramente client-side: o server só devolve os rounds
// agrupados (GET /api/granadas/rounds-utilitaria); toda a heurística de
// clustering/classificação/montagem mora aqui pra reusar os callouts do mapa
// já carregados no client (ver docs/superpowers/plans/2026-07-14-playbook-automatico.md).
import { calloutMaisProximo } from './calloutsUtil.js'

// ~30s a 64 ticks/s — janela em que um conjunto de granadas do mesmo round
// ainda conta como "o mesmo execute/setup" (não uma granada solta depois).
const JANELA_TICKS = 1920

// Distância euclidiana máxima (posições 0..1) entre centróides de dois rounds
// pra considerá-los o "mesmo" candidato (mesma execute repetida em rounds diferentes).
const LIMIAR_CENTROIDE_GRUPO = 0.06

const ALIAS_REGIAO = { a: 'A', b: 'B', mid: 'MID', meio: 'MID' }
const ROTULO_TIPO_GRANADA = { smoke: 'smoke', flash: 'flash', molotov: 'molotov', he: 'he' }
const PLURAL_TIPO = { smoke: 'smokes', flash: 'flashes', molotov: 'molotovs', he: 'he\'s' }

function normalizarNome(nome) {
  return String(nome ?? '').trim().toLowerCase()
}

// Granadas do round que cabem numa janela de JANELA_TICKS a partir da primeira
// (ordenada por tick). v1 simples: janela sempre ancorada na primeira granada
// do round (sem tentar re-ancorar a partir da 2ª/3ª se as primeiras não couberem).
export function filtrarJanela(round) {
  const ordenadas = [...(round?.granadas ?? [])].sort((a, b) => a.tick - b.tick)
  if (!ordenadas.length) return []
  const ancora = ordenadas[0].tick
  return ordenadas.filter((g) => g.tick - ancora <= JANELA_TICKS)
}

// Região (A/B/MID) mais próxima de (cx, cy) entre os callouts nível "noob" cujo
// nome normalizado é exatamente "a"/"b"/"mid"/"meio". null se o mapa não tiver
// os 3 (ex.: alguns mapas não têm um callout "Mid" nível noob) ou sem callouts.
export function classificarRegiao(callouts, cx, cy) {
  const candidatos = (callouts ?? [])
    .filter((c) => c.nivel === 'noob' && ALIAS_REGIAO[normalizarNome(c.nome)])

  const regioesDisponiveis = new Set(candidatos.map((c) => ALIAS_REGIAO[normalizarNome(c.nome)]))
  if (!['A', 'B', 'MID'].every((r) => regioesDisponiveis.has(r))) return null

  let melhor = null
  let melhorDist = Infinity
  for (const c of candidatos) {
    const d = (c.x - cx) ** 2 + (c.y - cy) ** 2
    if (d < melhorDist) {
      melhorDist = d
      melhor = c
    }
  }
  return melhor ? ALIAS_REGIAO[normalizarNome(melhor.nome)] : null
}

function centroide(granadas) {
  const n = granadas.length
  return {
    cx: granadas.reduce((s, g) => s + g.alvoX, 0) / n,
    cy: granadas.reduce((s, g) => s + g.alvoY, 0) / n,
  }
}

function assinaturaTipos(granadas) {
  return [...new Set(granadas.map((g) => g.tipo))].sort()
}

// Detecta candidatos a tática: pra cada round com >=3 granadas na janela cujo
// centróide cai numa região classificável, agrupa rounds com a mesma assinatura
// (lado|regiao|multiconjunto de tipos) e centróides a <LIMIAR_CENTROIDE_GRUPO.
// Devolve [{lado, regiao, tipos, rounds, granadasRepresentativas, times}]
// ordenado por nº de rounds (desc) — os padrões mais repetidos primeiro.
export function detectar(rounds, callouts) {
  const porRound = []
  for (const round of rounds ?? []) {
    const janela = filtrarJanela(round)
    if (janela.length < 3) continue
    const { cx, cy } = centroide(janela)
    const regiao = classificarRegiao(callouts, cx, cy)
    if (!regiao) continue // descarta candidato sem região classificável
    porRound.push({
      matchId: round.matchId, roundNumber: round.roundNumber, lado: round.lado,
      origem: round.origem, teamAName: round.teamAName, teamBName: round.teamBName,
      granadas: janela, cx, cy, regiao, tipos: assinaturaTipos(janela),
    })
  }

  const grupos = []
  for (const r of porRound) {
    const chave = `${r.lado}|${r.regiao}|${r.tipos.join(',')}`
    const grupo = grupos.find((g) => g.chave === chave
      && Math.hypot(g.cx - r.cx, g.cy - r.cy) < LIMIAR_CENTROIDE_GRUPO)
    if (grupo) {
      grupo.rounds.push(r)
    } else {
      grupos.push({ chave, lado: r.lado, regiao: r.regiao, tipos: r.tipos, cx: r.cx, cy: r.cy, rounds: [r] })
    }
  }

  return grupos
    .map((g) => {
      // "Mais recente" = maior matchId (assume-se ordem de inserção cronológica
      // das partidas processadas, já que o payload não traz timestamp do round)
      // e, dentro do mesmo match, o maior round_number.
      const roundsOrdenados = [...g.rounds].sort((a, b) => (a.matchId - b.matchId) || (a.roundNumber - b.roundNumber))
      const maisRecente = roundsOrdenados[roundsOrdenados.length - 1]
      const times = [...new Set(roundsOrdenados.flatMap((r) => [r.teamAName, r.teamBName]).filter(Boolean))]
      return {
        lado: g.lado, regiao: g.regiao, tipos: g.tipos,
        rounds: roundsOrdenados,
        granadasRepresentativas: maisRecente.granadas,
        times,
      }
    })
    .sort((a, b) => b.rounds.length - a.rounds.length)
}

function tituloContagemTipos(granadas) {
  const contagem = new Map()
  for (const g of granadas) contagem.set(g.tipo, (contagem.get(g.tipo) ?? 0) + 1)
  return [...contagem.entries()]
    .map(([tipo, n]) => `${n} ${n === 1 ? (ROTULO_TIPO_GRANADA[tipo] ?? tipo) : (PLURAL_TIPO[tipo] ?? `${tipo}s`)}`)
    .join(' + ')
}

// Monta o payload de criação de tática a partir de um candidato detectado:
// {titulo, tipo, local, lado, papeis: [{ordem, descricao, obrigatorio, granadas}]}
// (granadas = objetos crus do round, não IDs ainda — o caller faz o dedupe/criação
// na biblioteca e substitui por granadaIds antes do POST /api/taticas-curadas).
export function montarTatica(candidato, callouts) {
  if (!candidato?.regiao) return null // descarte candidato sem região (defensivo — detectar() já filtra)

  const tipo = candidato.lado === 'T' ? 'execute' : 'setup'
  const local = candidato.regiao
  const rotuloTipo = tipo === 'execute' ? 'Execute' : 'Setup'
  const titulo = `${rotuloTipo} ${local} (${tituloContagemTipos(candidato.granadasRepresentativas)})`

  const porThrower = new Map()
  for (const g of candidato.granadasRepresentativas) {
    const lista = porThrower.get(g.throwerSteamId) ?? []
    lista.push(g)
    porThrower.set(g.throwerSteamId, lista)
  }

  const throwers = [...porThrower.values()]
    .map((granadas) => [...granadas].sort((a, b) => a.tick - b.tick))
    .sort((a, b) => a[0].tick - b[0].tick)

  const papeis = throwers.map((granadas, i) => {
    const partes = granadas.map((g) => {
      const nomeAlvo = calloutMaisProximo(callouts, g.alvoX, g.alvoY)?.nome
      const rotulo = ROTULO_TIPO_GRANADA[g.tipo] ?? g.tipo
      return nomeAlvo ? `${rotulo} ${nomeAlvo}` : rotulo
    })
    return {
      ordem: i,
      descricao: `Jogador ${i + 1}: ${partes.join(' + ')}`,
      obrigatorio: true,
      granadas,
    }
  })

  return { titulo, tipo, local, lado: candidato.lado, papeis }
}
