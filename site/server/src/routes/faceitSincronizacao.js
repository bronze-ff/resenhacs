import { Router } from 'express'

// Status da importação FACEIT do PRÓPRIO Jogador (Minha conta → Contas vinculadas):
// quando o Coletor varreu o histórico dele pela última vez e quantas Partidas FACEIT
// dele estão no Resenha. Sem parâmetro de quem: sempre req.player.steamId. Não devolve
// o id FACEIT.
export function createFaceitSincronizacaoRouter({ db, requireAuth }) {
  const router = Router()

  router.get('/', requireAuth, async (req, res) => {
    const { rows } = await db.query(
      `select p.faceit_id is not null as vinculada,
              p.faceit_sincronizado_em,
              count(m.id)::int as importadas,
              count(m.id) filter (where not m.tem_demo)::int as sem_demo
         from players p
         left join match_players mp on mp.steam_id64 = p.steam_id64
         left join matches m on m.id = mp.match_id and m.faceit_match_id is not null
        where p.steam_id64 = $1
        group by p.steam_id64, p.faceit_id, p.faceit_sincronizado_em`,
      [req.player.steamId],
    )
    const r = rows[0]
    if (!r) return res.status(404).json({ erro: 'Jogador não encontrado' })
    res.json({
      vinculada: Boolean(r.vinculada),
      ultimaSincronizacao: r.faceit_sincronizado_em ? new Date(r.faceit_sincronizado_em).toISOString() : null,
      partidasImportadas: r.importadas ?? 0,
      partidasSemDemo: r.sem_demo ?? 0,
    })
  })

  return router
}
