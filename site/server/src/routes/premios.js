import { Router } from 'express'
import { partidaVisivelExpr } from '../friendships.js'
import { calcularPremios, janelaDoPeriodo } from '../premios.js'
import { UTIL_INIMIGO_SQL } from '../danoUtilitaria.js'

// O grupo é brasileiro: "semana" e "mês" seguem o calendário de São Paulo.
const FUSO = 'America/Sao_Paulo'

function hojeEmSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

// Prêmios da "Resenha da semana / do mês": GET /api/premios?periodo=semana|mes&ref=YYYY-MM-DD.
// Só Partidas visíveis ao viewer e só o círculo dele (ele + amigos accepted).
export function createPremiosRouter({ db, requireAuth, hoje = hojeEmSaoPaulo }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const tipo = req.query.periodo === 'mes' ? 'mes' : 'semana'
    const periodo = janelaDoPeriodo(tipo, req.query.ref, hoje())
    const { rows } = await db.query(
      `select m.id as match_id, m.map, m.duration_seconds, m.tem_demo,
              mp.steam_id64, p.nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url,
              mp.team, mp.won, mp.kills, mp.deaths, mp.headshot_kills, mp.rating,
              mp.clutch_wins, mp.clutch_attempts, ${UTIL_INIMIGO_SQL} as utility_damage, mp.team_kills, mp.he_team_damage,
              mp.molotov_team_damage, mp.teammates_flashed, mp.teammate_flash_duration,
              mp.traded_deaths
       from matches m
       join match_players mp on mp.match_id = m.id
       join players p on p.steam_id64 = mp.steam_id64
       left join steam_avatares sa on sa.steam_id64 = mp.steam_id64
       where m.status = 'parsed'
         and m.played_at >= ($2::date::timestamp at time zone '${FUSO}')
         and m.played_at < ($3::date::timestamp at time zone '${FUSO}')
         and mp.steam_id64 in (
           select $1::text
           union
           select case when f.player_a = $1 then f.player_b else f.player_a end
           from friendships f
           where (f.player_a = $1 or f.player_b = $1) and f.status = 'accepted'
         )
         and ${partidaVisivelExpr('m', '$1')}
       limit 20000`,
      [req.player.steamId, periodo.inicio, periodo.fim],
    )
    res.json({ periodo, ...calcularPremios(rows, tipo) })
  })

  return router
}
