import { Router } from 'express'

// Checklist de "Primeiros passos" do Início: o que falta o jogador configurar pra o site
// funcionar sozinho. Só dados do próprio viewer (nenhum parâmetro de quem).
export function createPrimeirosPassosRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const eu = req.player.steamId
    const { rows } = await db.query(
      `select
         (p.match_auth_code is not null and p.last_share_code is not null) as codigo_historico,
         (p.faceit_id is not null) as faceit,
         (select count(*)::int from friendships f
           where f.status = 'accepted' and (f.player_a = $1 or f.player_b = $1)) as amigos,
         (select count(*)::int from match_players mp
           join matches m on m.id = mp.match_id
           where mp.steam_id64 = $1 and m.status = 'parsed') as partidas
       from players p where p.steam_id64 = $1`,
      [eu],
    )
    const r = rows[0] ?? {}
    res.json({
      codigoHistorico: r.codigo_historico === true,
      faceit: r.faceit === true,
      amigos: r.amigos ?? 0,
      partidas: r.partidas ?? 0,
    })
  })

  return router
}
