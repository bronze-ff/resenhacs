// "Resenha da semana / do mês": prêmios de zoeira calculados das Partidas do período
// (lógica pura; a rota só busca as linhas). Referência: Leetify Recap.

const DIA_MS = 24 * 60 * 60 * 1000

function isoData(d) {
  return d.toISOString().slice(0, 10)
}

// Datas como dia de calendário (sem fuso): tudo em UTC meia-noite, só pra aritmética.
function paraData(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d))
}

function dataValida(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = paraData(iso)
  return !Number.isNaN(d.getTime()) && isoData(d) === iso
}

// Janela [inicio, fim) do período que contém `ref`. Semana começa na segunda.
// `hoje` (YYYY-MM-DD) decide se existe período seguinte navegável.
export function janelaDoPeriodo(tipo, ref, hoje) {
  const base = dataValida(ref) ? paraData(ref) : paraData(hoje)
  let inicio
  let fim
  if (tipo === 'mes') {
    inicio = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1))
    fim = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1))
  } else {
    const dow = (base.getUTCDay() + 6) % 7 // segunda = 0
    inicio = new Date(base.getTime() - dow * DIA_MS)
    fim = new Date(inicio.getTime() + 7 * DIA_MS)
  }
  const anterior = tipo === 'mes'
    ? new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() - 1, 1))
    : new Date(inicio.getTime() - 7 * DIA_MS)
  const proximo = fim.getTime() <= paraData(hoje).getTime() ? isoData(fim) : null
  return { tipo: tipo === 'mes' ? 'mes' : 'semana', inicio: isoData(inicio), fim: isoData(fim), anterior: isoData(anterior), proximo }
}

// Mínimos de amostra por tipo de período (um Jogador com 1 Partida não "carrega o mês").
const MINIMOS = {
  semana: { partidas: 2, killsHs: 30, dupla: 2, mapa: 2 },
  mes: { partidas: 4, killsHs: 80, dupla: 3, mapa: 2 },
}

const n = (v) => Number(v ?? 0)
const arred = (v, casas = 2) => Math.round(v * 10 ** casas) / 10 ** casas

function jogadorDe(r) {
  return { steamId: r.steam_id64, nick: r.nick, avatarUrl: r.avatar_url ?? null }
}

// Escolhe o Jogador com maior (ou menor) métrica entre os que passam no filtro.
function melhor(lista, metrica, { menor = false, filtro = () => true } = {}) {
  let vencedor = null
  for (const j of lista) {
    if (!filtro(j)) continue
    const v = metrica(j)
    if (v == null || Number.isNaN(v)) continue
    if (!vencedor || (menor ? v < vencedor.v : v > vencedor.v) || (v === vencedor.v && j.partidas > vencedor.j.partidas)) {
      vencedor = { j, v }
    }
  }
  return vencedor
}

export function calcularPremios(linhas, tipo = 'semana') {
  const min = MINIMOS[tipo] ?? MINIMOS.semana

  const partidas = new Map() // match_id -> { map, duration, linhas: [] }
  const porJogador = new Map()
  for (const r of linhas) {
    if (!partidas.has(r.match_id)) partidas.set(r.match_id, { map: r.map, duration: r.duration_seconds, linhas: [] })
    partidas.get(r.match_id).linhas.push(r)

    if (!porJogador.has(r.steam_id64)) {
      porJogador.set(r.steam_id64, {
        ...jogadorDe(r), partidas: 0, comRating: 0, somaRating: 0, kills: 0, hs: 0,
        clutches: 0, utilidade: 0, teamKills: 0, danoTime: 0, aliadosCegados: 0, segCegados: 0,
        mortesSemTrade: 0, partidasComDemo: 0,
      })
    }
    const j = porJogador.get(r.steam_id64)
    j.partidas += 1
    if (r.rating != null) { j.comRating += 1; j.somaRating += n(r.rating) }
    j.kills += n(r.kills)
    j.hs += n(r.headshot_kills)
    j.clutches += n(r.clutch_wins)
    j.utilidade += n(r.utility_damage)
    j.teamKills += n(r.team_kills)
    j.danoTime += n(r.he_team_damage) + n(r.molotov_team_damage)
    j.aliadosCegados += n(r.teammates_flashed)
    j.segCegados += n(r.teammate_flash_duration)
    // Trade só existe com Demo: Partida FACEIT só com stats grava traded_deaths=0
    // (default) e faria toda morte dela virar "sem trade".
    if (r.tem_demo !== false) {
      j.partidasComDemo += 1
      j.mortesSemTrade += Math.max(0, n(r.deaths) - n(r.traded_deaths))
    }
  }
  const jogadores = [...porJogador.values()]
  const comMinimo = (j) => j.partidas >= min.partidas

  // Resultado do GRUPO numa Partida: todos os Jogadores do círculo venceram/perderam.
  // Misto (grupo dos dois lados) ou empate não conta pra winrate.
  const resultado = (p) => {
    if (p.linhas.every((l) => l.won === true)) return 'V'
    if (p.linhas.every((l) => l.won === false)) return 'D'
    return null
  }
  let vitorias = 0
  let derrotas = 0
  let segundos = 0
  let comDuracao = 0
  const porMapa = new Map()
  const duplas = new Map()
  for (const p of partidas.values()) {
    if (p.duration != null) { segundos += n(p.duration); comDuracao += 1 }
    const res = resultado(p)
    if (res === 'V') vitorias += 1
    if (res === 'D') derrotas += 1
    if (res && p.map) {
      const m = porMapa.get(p.map) ?? { map: p.map, v: 0, d: 0 }
      if (res === 'V') m.v += 1
      else m.d += 1
      porMapa.set(p.map, m)
    }
    // Duplas: todo par do círculo no MESMO time dessa Partida.
    const ordenadas = [...p.linhas].sort((a, b) => (a.steam_id64 < b.steam_id64 ? -1 : 1))
    for (let i = 0; i < ordenadas.length; i++) {
      for (let k = i + 1; k < ordenadas.length; k++) {
        const a = ordenadas[i]
        const b = ordenadas[k]
        if (a.team !== b.team || a.won == null) continue
        const chave = `${a.steam_id64}|${b.steam_id64}`
        const d = duplas.get(chave) ?? { a: jogadorDe(a), b: jogadorDe(b), partidas: 0, vitorias: 0 }
        d.partidas += 1
        if (a.won) d.vitorias += 1
        duplas.set(chave, d)
      }
    }
  }

  const premios = []
  const individual = (id, titulo, descricao, achado, formato, tom) => {
    if (!achado) return
    premios.push({ id, titulo, descricao, jogadores: [jogadorDe({ steam_id64: achado.j.steamId, nick: achado.j.nick, avatar_url: achado.j.avatarUrl })], valor: achado.v, formato, tom })
  }

  // O mínimo conta só Partidas com rating: FACEIT sem Demo não tem, e 1 Partida com rating
  // entre 4 passava no filtro como se fosse uma média de 4.
  individual('carregou', 'Carregou', `Maior rating médio (mín. ${min.partidas} partidas)`,
    melhor(jogadores, (j) => (j.comRating ? arred(j.somaRating / j.comRating) : null), { filtro: (j) => j.comRating >= min.partidas }), 'decimal2', 'bom')
  // Rei do clutch, Fogo amigo e Flashador são POR PARTIDA, com o mínimo de partidas do
  // período: somar o período premiava quem jogou mais, não quem clutcha/erra mais.
  individual('clutch', 'Rei do clutch', `Clutches vencidos por partida (mín. ${min.partidas} partidas)`,
    melhor(jogadores, (j) => arred(j.clutches / j.partidas), { filtro: (j) => comMinimo(j) && j.clutches > 0 }), 'decimal2', 'bom')
  individual('granadeiro', 'Granadeiro', 'Dano de utilitária por partida',
    melhor(jogadores, (j) => Math.round(j.utilidade / j.partidas), { filtro: (j) => comMinimo(j) && j.utilidade > 0 }), 'int', 'bom')
  individual('fogo-amigo', 'Fogo amigo', `Dano no próprio time por partida, TK vale 100 (mín. ${min.partidas} partidas)`,
    melhor(jogadores, (j) => Math.round((j.danoTime + j.teamKills * 100) / j.partidas), { filtro: (j) => comMinimo(j) && j.danoTime + j.teamKills > 0 }), 'int', 'ruim')
  individual('flashador', 'Flashador amigo', `Cegueira no próprio time por partida (mín. ${min.partidas} partidas)`,
    melhor(jogadores, (j) => arred(j.segCegados / j.partidas, 1), { filtro: (j) => comMinimo(j) && j.aliadosCegados > 0 }), 'segundos', 'ruim')
  individual('baiter', 'Baiter', 'Mortes sem trade por partida',
    melhor(jogadores, (j) => (j.partidasComDemo ? arred(j.mortesSemTrade / j.partidasComDemo, 1) : null), { filtro: (j) => j.partidasComDemo >= min.partidas }), 'decimal1', 'ruim')
  individual('alface', 'Mão de alface', `Menor HS% (mín. ${min.killsHs} kills)`,
    melhor(jogadores, (j) => arred((j.hs / j.kills) * 100, 1), { menor: true, filtro: (j) => j.kills >= min.killsHs }), 'pct100', 'ruim')

  const dupla = [...duplas.values()]
    .filter((d) => d.partidas >= min.dupla)
    .map((d) => ({ ...d, winrate: arred((d.vitorias / d.partidas) * 100, 1) }))
    .sort((x, y) => y.winrate - x.winrate || y.partidas - x.partidas)[0]
  if (dupla) {
    premios.push({
      id: 'dupla', titulo: 'Dupla imbatível', descricao: `Winrate jogando juntos (${dupla.vitorias}/${dupla.partidas})`,
      jogadores: [dupla.a, dupla.b], valor: dupla.winrate, formato: 'pct100', tom: 'bom',
    })
  }

  const mapa = [...porMapa.values()]
    .filter((m) => m.v + m.d >= min.mapa)
    .map((m) => ({ ...m, winrate: arred((m.v / (m.v + m.d)) * 100, 1) }))
    .sort((x, y) => x.winrate - y.winrate || y.v + y.d - (x.v + x.d))[0]
  if (mapa) {
    premios.push({
      id: 'mapa-maldito', titulo: 'Mapa maldito', descricao: `Pior winrate do grupo (${mapa.v}V ${mapa.d}D)`,
      jogadores: [], mapa: mapa.map, valor: mapa.winrate, formato: 'pct100', tom: 'ruim',
    })
  }

  return {
    numeros: {
      partidas: partidas.size,
      // null = nenhuma Partida do período tem duração gravada (o Coletor ainda não grava
      // matches.duration_seconds); 0h seria mentira com 169 Partidas jogadas.
      horas: comDuracao ? Math.round(segundos / 360) / 10 : null,
      vitorias,
      derrotas,
      winrate: vitorias + derrotas > 0 ? arred((vitorias / (vitorias + derrotas)) * 100, 1) : null,
      clutches: jogadores.reduce((s, j) => s + j.clutches, 0),
    },
    premios,
  }
}
