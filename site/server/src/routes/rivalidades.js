import { Router } from 'express'
import { partidaVisivelExpr } from '../friendships.js'
import { calcularRivalidades } from '../rivalidades.js'

// Rivalidades e duplas de um Jogador contra/com os outros Jogadores do grupo, só nas
// Partidas visíveis ao viewer (eu + amigos accepted). Kills vêm de kill_positions sem
// team kill (is_team_kill, migration 0054); partidas juntos/contra de match_players.
export function createRivalidadesRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/:steamId', requireAuth, async (req, res) => {
    const { steamId } = req.params
    if (!/^\d{1,20}$/.test(steamId)) return res.status(400).json({ erro: 'SteamID inválido' })
    const viewer = req.player.steamId

    // Mesmo gate do Perfil: só responde de quem é o viewer, amigo accepted ou alguém
    // presente em Partida visível. Fora disso é 404 (não revela que o Jogador existe).
    const presenca = await db.query(
      `select ($1 = $2
            or exists (select 1 from friendships f
                       where ((f.player_a = $2 and f.player_b = $1) or (f.player_b = $2 and f.player_a = $1))
                         and f.status = 'accepted')
            or exists (select 1 from match_players mp join matches m on m.id = mp.match_id
                       where mp.steam_id64 = $1 and ${partidaVisivelExpr('m', '$2')})) as tem`,
      [steamId, viewer],
    )
    if (!presenca.rows[0]?.tem) return res.status(404).json({ erro: 'Jogador não encontrado' })

    // Só outros JOGADORES (join em players): adversário aleatório da fila não é rival.
    const { rows } = await db.query(
      `with vis as (
         select m.id from matches m
         where m.status = 'parsed' and ${partidaVisivelExpr('m', '$2')}
       ),
       duelos as (
         select case when kp.killer = $1 then kp.victim else kp.killer end as outro,
                count(*) filter (where kp.killer = $1)::int as matei,
                count(*) filter (where kp.victim = $1)::int as morri
         from kill_positions kp
         where kp.match_id in (select id from vis)
           and coalesce(kp.is_team_kill, false) = false
           and kp.killer is not null and kp.killer <> kp.victim
           and (kp.killer = $1 or kp.victim = $1)
         group by 1
       ),
       partidas as (
         select b.steam_id64 as outro,
                count(*) filter (where a.team <> b.team)::int as contra,
                count(*) filter (where a.team = b.team)::int as juntos,
                count(*) filter (where a.team = b.team and a.won is true)::int as juntos_vitorias
         from match_players a
         join match_players b on b.match_id = a.match_id and b.steam_id64 <> a.steam_id64
         where a.steam_id64 = $1 and a.match_id in (select id from vis)
         group by b.steam_id64
       )
       select p.steam_id64, p.nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url,
              coalesce(d.matei, 0)::int as matei, coalesce(d.morri, 0)::int as morri,
              pt.contra, pt.juntos, pt.juntos_vitorias
       from partidas pt
       join players p on p.steam_id64 = pt.outro
       left join duelos d on d.outro = pt.outro
       left join steam_avatares sa on sa.steam_id64 = p.steam_id64`,
      [steamId, viewer],
    )

    res.json(calcularRivalidades(rows))
  })

  return router
}
