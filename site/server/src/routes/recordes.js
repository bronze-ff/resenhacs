import { Router } from 'express'

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

export function createRecordesRouter({ db, requireAuth, requireGroupMember }) {
  const router = Router()

  // "Recordes do grupo" (hall da fama): maiores marcas já registradas pelo grupo —
  // mais kills numa Partida, melhor ADR, maior sequência de vitórias, mais clutches
  // numa Resenha (noite). Escopado ao grupo ativo em todas as queries.
  router.get('/', requireAuth, requireGroupMember, async (req, res) => {
    const matchesQ = await db.query(
      `select id, map, played_at from matches where status = 'parsed' and group_id = $1
       order by played_at asc nulls last`,
      [req.groupId],
    )
    const playersQ = await db.query(
      `select mp.match_id, mp.steam_id64, p.nick, mp.kills, mp.damage, mp.rounds_played,
              mp.won, mp.clutch_wins, coalesce(p.avatar_url, sa.avatar_url) as avatar_url
       from match_players mp
       join players p on p.steam_id64 = mp.steam_id64
       left join steam_avatares sa on sa.steam_id64 = mp.steam_id64
       where mp.match_id in (select id from matches where status = 'parsed' and group_id = $1)`,
      [req.groupId],
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
    let maiorSequencia = null
    let atual = { vitorias: 0, inicio: null }
    for (const m of matchesQ.rows) {
      const resultado = resultadoDeUmaPartida(jogadoresPorPartida.get(m.id) ?? [])
      if (resultado === 'vitoria') {
        if (atual.vitorias === 0) atual.inicio = m.played_at
        atual.vitorias += 1
        atual.fim = m.played_at
        if (!maiorSequencia || atual.vitorias > maiorSequencia.vitorias) {
          maiorSequencia = { vitorias: atual.vitorias, inicio: atual.inicio, fim: atual.fim }
        }
      } else {
        atual = { vitorias: 0, inicio: null }
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
      for (const mid of s.matchIds) {
        for (const r of jogadoresPorPartida.get(mid) ?? []) {
          porJogador.set(r.steam_id64, (porJogador.get(r.steam_id64) ?? 0) + r.clutch_wins)
        }
      }
      for (const [steamId, clutches] of porJogador) {
        if (clutches > 0 && (!maisClutchesNaNoite || clutches > maisClutchesNaNoite.clutches)) {
          const r = (jogadoresPorPartida.get(s.matchIds[0]) ?? []).find((j) => j.steam_id64 === steamId)
            ?? [...jogadoresPorPartida.values()].flat().find((j) => j.steam_id64 === steamId)
          maisClutchesNaNoite = {
            steamId, nick: r?.nick ?? steamId, avatarUrl: r?.avatar_url ?? null,
            clutches, sessaoInicio: s.inicio,
          }
        }
      }
    }

    res.json({ maisKills, melhorAdr, maiorSequencia, maisClutchesNaNoite })
  })

  return router
}
