import { Router } from 'express'
import { partidaVisivelExpr } from '../friendships.js'
import { montarMapas, separarPeriodos } from '../mapas.js'
import { inicioDoDiaSql, fimDoDiaSql } from '../fuso.js'

// GET /api/mapas?jogador=&de=&ate=&compararDe=&compararAte=
// Desempenho por mapa de um Jogador (padrão: o viewer), período atual vs comparação,
// com winrate de rounds por lado e a média do grupo. Complementa /api/lado-mapa (que é
// só do grupo, sem período) e o porMapa do perfil (sem lado nem comparação).
//
// Visibilidade: só entram Partidas visíveis ao viewer (friendships.js). Pedir um
// `jogador` fora da rede devolve lista vazia, não vaza nada.
// "Grupo" = o viewer + amigos `accepted`; a média é o winrate de rounds por lado dos
// times em que algum deles jogou, dentro da janela de datas do período atual.

const LIMITE_PARTIDAS = 2000

export function createMapasRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const viewer = req.player.steamId
    const jogador = req.query.jogador ? String(req.query.jogador) : viewer
    if (!/^\d{17}$/.test(jogador)) return res.status(400).json({ erro: 'Jogador inválido' })
    const filtros = {
      de: req.query.de ? String(req.query.de) : undefined,
      ate: req.query.ate ? String(req.query.ate) : undefined,
      compararDe: req.query.compararDe ? String(req.query.compararDe) : undefined,
      compararAte: req.query.compararAte ? String(req.query.compararAte) : undefined,
    }

    const partidasQ = await db.query(
      `select m.id, m.map, m.played_at, m.score_a, m.score_b, mp.team, mp.won
       from match_players mp join matches m on m.id = mp.match_id
       where mp.steam_id64 = $1 and m.status = 'parsed' and ${partidaVisivelExpr('m', '$2')}
       order by m.played_at desc nulls last
       limit ${LIMITE_PARTIDAS}`,
      [jogador, viewer],
    )
    const partidas = partidasQ.rows.map((r) => ({
      id: r.id,
      map: r.map,
      playedAt: r.played_at,
      scoreA: r.score_a,
      scoreB: r.score_b,
      team: r.team,
      won: r.won,
    }))

    const periodos = separarPeriodos(partidas, filtros)
    const ids = [...periodos.atual, ...periodos.anterior].map((p) => p.id)
    const janela = periodos.intervaloAtual ?? { de: null, ate: null }

    const grupoParams = [viewer]
    let grupoPeriodo = ''
    if (janela.de) {
      grupoParams.push(janela.de)
      grupoPeriodo += ` and m.played_at >= ${inicioDoDiaSql(`$${grupoParams.length}`)}`
    }
    if (janela.ate) {
      grupoParams.push(janela.ate)
      grupoPeriodo += ` and m.played_at < ${fimDoDiaSql(`$${grupoParams.length}`)}`
    }

    const [roundsQ, grupoQ] = await Promise.all([
      ids.length
        ? db.query('select match_id, side_a, winner_team from rounds where match_id = any($1::uuid[])', [ids])
        : Promise.resolve({ rows: [] }),
      // Um time em que alguém do grupo jogou já é, por definição, uma Partida visível ao
      // viewer (ele jogou ou um amigo accepted jogou) — mesmo critério de partidaVisivelExpr.
      db.query(
        `select m.map,
                case gt.team
                  when 'A' then r.side_a
                  when 'B' then case r.side_a when 'CT' then 'T' when 'T' then 'CT' end
                end as lado,
                count(*)::int as rounds,
                sum(case when r.winner_team = gt.team then 1 else 0 end)::int as vitorias
         from (
           select distinct mp.match_id, mp.team
           from match_players mp
           where mp.steam_id64 = $1
              or exists (
                select 1 from friendships f
                where f.status = 'accepted'
                  and ((f.player_a = $1 and f.player_b = mp.steam_id64)
                    or (f.player_b = $1 and f.player_a = mp.steam_id64)))
         ) gt
         join matches m on m.id = gt.match_id
         join rounds r on r.match_id = m.id
         where m.status = 'parsed' and r.side_a is not null${grupoPeriodo}
         group by m.map, lado`,
        grupoParams,
      ),
    ])

    const resultado = montarMapas({
      partidas,
      rounds: roundsQ.rows.map((r) => ({ matchId: r.match_id, sideA: r.side_a, winnerTeam: r.winner_team })),
      grupo: grupoQ.rows.filter((g) => g.lado),
      filtros,
    })
    res.json({ jogador, ...resultado })
  })

  return router
}
