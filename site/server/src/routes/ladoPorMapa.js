import { Router } from 'express'

export function createLadoPorMapaRouter({ db, requireAuth, requireGroupMember }) {
  const router = Router()

  // "A gente é muito pior de T na Mirage?" (FIL-51) — winrate do GRUPO por lado (CT/T)
  // em cada mapa. Só conta rounds de partidas onde todos os Jogadores rastreados
  // estavam no MESMO time fixo (A ou B) naquela partida — grupo dividido em times
  // opostos não tem "o lado do grupo" bem definido, fica de fora (mesmo critério de
  // "misto" usado em Feed.jsx/sessions.js). side_a só existe em partidas reprocessadas
  // depois do FIL-51 (coletor/src/coletor/parse.py) — partidas antigas não aparecem
  // até serem reprocessadas.
  router.get('/', requireAuth, requireGroupMember, async (req, res) => {
    const { rows } = await db.query(
      `select m.map,
              case grp.time_do_grupo
                when 'A' then r.side_a
                when 'B' then case r.side_a when 'CT' then 'T' when 'T' then 'CT' end
              end as lado,
              count(*)::int as rounds,
              sum(case when r.winner_team = grp.time_do_grupo then 1 else 0 end)::int as vitorias
       from matches m
       join rounds r on r.match_id = m.id
       join (
         select match_id, min(team) as time_do_grupo
         from match_players
         where is_tracked
         group by match_id
         having count(distinct team) = 1
       ) grp on grp.match_id = m.id
       where m.status = 'parsed' and m.group_id = $1 and r.side_a is not null
       group by m.map, lado
       order by m.map, lado`,
      [req.groupId],
    )
    res.json(
      rows.map((r) => ({
        map: r.map,
        lado: r.lado,
        rounds: r.rounds,
        vitorias: r.vitorias,
        winrate: r.rounds ? Math.round((r.vitorias / r.rounds) * 1000) / 10 : 0,
      })),
    )
  })

  return router
}
