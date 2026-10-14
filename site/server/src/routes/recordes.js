import { Router } from 'express'
import { partidaVisivelExpr } from '../friendships.js'
import { recordesPessoais } from '../recordesPessoais.js'

// Mesmo gap de "Resenha" que sessions.js usa pra agrupar Partidas da mesma noite —
// duplicado aqui (não importado) porque é só uma linha de lógica e criar um módulo
// compartilhado pra isso seria mais peso do que economia.
const GAP_MS = 3 * 60 * 60 * 1000

function resultadoDeUmaPartida(jogadoresDoGrupo) {
  if (jogadoresDoGrupo.length === 0) return null
  if (jogadoresDoGrupo.every((p) => p.won === true)) return 'vitoria'
  if (jogadoresDoGrupo.every((p) => p.won === false)) return 'derrota'
  return 'outro' // empate ou misto — quebra a sequência, mas não é "derrota" pra fins de exibição
}

export function createRecordesRouter({ db, requireAuth }) {
  const router = Router()

  // "Recordes" (hall da fama): maiores marcas já registradas nas Partidas visíveis ao
  // viewer (eu + amigos accepted) — mais kills numa Partida, melhor ADR, maior sequência
  // de vitórias, mais clutches numa Resenha (noite).
  router.get('/', requireAuth, async (req, res) => {
    const eu = req.player.steamId
    // Sem LIMIT aqui a query varria TODO o histórico de Partidas visíveis (e o join de
    // Jogadores abaixo) a cada request — caro e sem teto conforme o círculo de amigos
    // cresce/joga mais, e um vetor de DoS barato. 750 Partidas é uma janela generosa
    // (bem além do que um grupo de amigos acumula em meses de uso real); o efeito
    // colateral aceito é que "Recordes" vira uma janela móvel das últimas 750 Partidas
    // em vez de all-time estrito — se o produto realmente precisar de all-time sem teto
    // algum dia, isso pede um agregado incremental (tabela própria), não dá pra fazer só
    // com LIMIT. "id desc" desempata o "order by played_at" (podem repetir) garantindo
    // que as duas queries abaixo recortem exatamente o mesmo conjunto de Partidas.
    const recentes = `order by played_at desc nulls last, id desc limit 750`
    const matchesQ = await db.query(
      `select id, map, played_at from (
         select id, map, played_at from matches m where status = 'parsed'
           and ${partidaVisivelExpr('m', '$1')} ${recentes}
       ) recentes order by played_at asc nulls last`,
      [eu],
    )
    const playersQ = await db.query(
      `select mp.match_id, mp.steam_id64, p.nick, mp.kills, mp.damage, mp.rounds_played,
              mp.won, mp.clutch_wins, coalesce(p.avatar_url, sa.avatar_url) as avatar_url
       from match_players mp
       join players p on p.steam_id64 = mp.steam_id64
       left join steam_avatares sa on sa.steam_id64 = mp.steam_id64
       where mp.match_id in (
         select id from matches m where status = 'parsed' and ${partidaVisivelExpr('m', '$1')} ${recentes}
       )`,
      [eu],
    )

    const matchesPorId = new Map(matchesQ.rows.map((m) => [m.id, m]))
    const jogadoresPorPartida = new Map()
    for (const r of playersQ.rows) {
      if (!jogadoresPorPartida.has(r.match_id)) jogadoresPorPartida.set(r.match_id, [])
      jogadoresPorPartida.get(r.match_id).push(r)
    }

    const linha = (r) => ({
      steamId: r.steam_id64, nick: r.nick, avatarUrl: r.avatar_url,
      matchId: r.match_id, map: matchesPorId.get(r.match_id)?.map ?? null,
      playedAt: matchesPorId.get(r.match_id)?.played_at ?? null,
    })

    // Mais kills numa Partida.
    let maisKills = null
    // Melhor ADR numa Partida (dano/rounds — só quem jogou pelo menos 1 round).
    let melhorAdr = null
    for (const r of playersQ.rows) {
      if (!maisKills || r.kills > maisKills.kills) maisKills = { ...linha(r), kills: r.kills }
      if (r.rounds_played > 0) {
        const adr = Math.round((r.damage / r.rounds_played) * 10) / 10
        if (!melhorAdr || adr > melhorAdr.adr) melhorAdr = { ...linha(r), adr }
      }
    }

    // Maior sequência de vitórias do GRUPO (não de um jogador): percorre as Partidas
    // em ordem cronológica contando vitórias seguidas; derrota/empate/misto zera.
    // fimMatchId aponta pra Partida que fechou a sequência — é ela que o card leva o
    // clique, já que "onde a sequência terminou" é o ponto de referência mais natural.
    let maiorSequencia = null
    let atual = { vitorias: 0, inicio: null, fimMatchId: null }
    for (const m of matchesQ.rows) {
      const resultado = resultadoDeUmaPartida(jogadoresPorPartida.get(m.id) ?? [])
      if (resultado === 'vitoria') {
        if (atual.vitorias === 0) atual.inicio = m.played_at
        atual.vitorias += 1
        atual.fim = m.played_at
        atual.fimMatchId = m.id
        if (!maiorSequencia || atual.vitorias > maiorSequencia.vitorias) {
          maiorSequencia = { vitorias: atual.vitorias, inicio: atual.inicio, fim: atual.fim, fimMatchId: atual.fimMatchId }
        }
      } else {
        atual = { vitorias: 0, inicio: null, fimMatchId: null }
      }
    }

    // Mais clutches numa Resenha (noite): agrupa as mesmas Partidas em sessões
    // (gap de 3h) e soma clutch_wins por Jogador dentro de cada sessão.
    let maisClutchesNaNoite = null
    let sessaoAtual = null
    let ultimoTs = null
    const sessoes = []
    for (const m of matchesQ.rows) {
      const ts = m.played_at ? new Date(m.played_at).getTime() : null
      if (!sessaoAtual || (ts != null && ultimoTs != null && ts - ultimoTs > GAP_MS)) {
        sessaoAtual = { inicio: m.played_at, matchIds: [] }
        sessoes.push(sessaoAtual)
      }
      sessaoAtual.matchIds.push(m.id)
      if (ts != null) ultimoTs = ts
    }
    for (const s of sessoes) {
      const porJogador = new Map()
      // matchId da última Partida da sessão em que o Jogador realmente teve clutch —
      // é o ponto de referência do card, já que a "Resenha" inteira não tem uma Partida
      // única representá-la.
      const ultimoMatchComClutchPorJogador = new Map()
      for (const mid of s.matchIds) {
        for (const r of jogadoresPorPartida.get(mid) ?? []) {
          porJogador.set(r.steam_id64, (porJogador.get(r.steam_id64) ?? 0) + r.clutch_wins)
          if (r.clutch_wins > 0) ultimoMatchComClutchPorJogador.set(r.steam_id64, mid)
        }
      }
      for (const [steamId, clutches] of porJogador) {
        if (clutches > 0 && (!maisClutchesNaNoite || clutches > maisClutchesNaNoite.clutches)) {
          const r = (jogadoresPorPartida.get(s.matchIds[0]) ?? []).find((j) => j.steam_id64 === steamId)
            ?? [...jogadoresPorPartida.values()].flat().find((j) => j.steam_id64 === steamId)
          maisClutchesNaNoite = {
            steamId, nick: r?.nick ?? steamId, avatarUrl: r?.avatar_url ?? null,
            clutches, sessaoInicio: s.inicio, matchId: ultimoMatchComClutchPorJogador.get(steamId) ?? null,
          }
        }
      }
    }

    res.json({ maisKills, melhorAdr, maiorSequencia, maisClutchesNaNoite })
  })

  // Recordes PESSOAIS do viewer batidos nos últimos 14 dias (aviso do Feed). Só olha as
  // Partidas do próprio viewer — são sempre visíveis pra ele, não precisa do filtro de
  // amizade. As últimas 750 Partidas vêm linha a linha; o que é mais velho que isso entra
  // só como agregado (máximo e contagem por métrica) — sem ele, um recorde de carreira
  // fora da janela sumiria e uma marca menor seria anunciada como recorde.
  router.get('/pessoais', requireAuth, async (req, res) => {
    const janela = `select m.id from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = $1 and m.status = 'parsed'
         order by m.played_at desc nulls last, m.id desc limit 750`
    const [recentesQ, baseQ] = await Promise.all([
      db.query(
        `select mp.match_id, m.map, m.played_at, mp.kills, mp.damage, mp.rounds_played,
                mp.rating, mp.utility_damage
         from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = $1 and m.id in (${janela})
         order by m.played_at asc nulls last, m.id asc`,
        [req.player.steamId],
      ),
      db.query(
        `select max(mp.kills) as kills_max, count(*)::int as kills_n,
                max(round(mp.damage::numeric / mp.rounds_played, 1)) filter (where mp.rounds_played > 0) as adr_max,
                count(*) filter (where mp.rounds_played > 0)::int as adr_n,
                max(mp.rating) as rating_max, count(mp.rating)::int as rating_n,
                max(mp.utility_damage) as utilitaria_max, count(mp.utility_damage)::int as utilitaria_n
         from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = $1 and m.status = 'parsed' and m.id not in (${janela})`,
        [req.player.steamId],
      ),
    ])
    const b = baseQ.rows[0] ?? {}
    const base = {}
    for (const chave of ['kills', 'adr', 'rating', 'utilitaria']) {
      const max = b[`${chave}_max`]
      if (max != null) base[chave] = { max: Number(max), n: Number(b[`${chave}_n`] ?? 0) }
    }
    const desde = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    res.json(recordesPessoais(recentesQ.rows, { desde, base }))
  })

  return router
}
