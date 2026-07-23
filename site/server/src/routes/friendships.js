import { Router } from 'express'
import { parCanonico } from '../friendships.js'

// Rotas de amizade mútua (substituem grupos). Toda linha de friendships é gravada em
// par canônico (player_a < player_b); a direção do pedido vive em requested_by.
export function createFriendshipsRouter({ db, requireAuth }) {
  const router = Router()

  // Lista meus amigos accepted + pendentes recebidos (outro pediu) + enviados (eu pedi).
  router.get('/', requireAuth, async (req, res) => {
    const eu = req.player.steamId
    const { rows } = await db.query(
      `select case when f.player_a = $1 then f.player_b else f.player_a end as steam_id64,
              coalesce(p.nick, '') as nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url,
              f.status, f.requested_by
       from friendships f
       join players p on p.steam_id64 = case when f.player_a = $1 then f.player_b else f.player_a end
       left join steam_avatares sa on sa.steam_id64 = p.steam_id64
       where f.player_a = $1 or f.player_b = $1
       order by p.nick asc`,
      [eu],
    )
    const amigos = rows.filter((r) => r.status === 'accepted')
    const recebidos = rows.filter((r) => r.status === 'pending' && r.requested_by !== eu)
    const enviados = rows.filter((r) => r.status === 'pending' && r.requested_by === eu)
    const enxuga = ({ steam_id64, nick, avatar_url }) => ({ steamId: steam_id64, nick, avatarUrl: avatar_url })
    res.json({ amigos: amigos.map(enxuga), recebidos: recebidos.map(enxuga), enviados: enviados.map(enxuga) })
  })

  // Pede amizade. Se já existe um pending inverso (o outro já me pediu), aceita direto.
  router.post('/', requireAuth, async (req, res) => {
    const eu = req.player.steamId
    const alvo = String(req.body?.steamId ?? '').trim()
    if (!alvo || alvo === eu) return res.status(400).json({ erro: 'steamId inválido' })
    const real = await db.query('select steam_id64 from players where steam_id64 = $1 and conta_criada_em is not null', [alvo])
    if (real.rows.length === 0) return res.status(404).json({ erro: 'Esse jogador não tem conta no Resenha' })
    const [a, b] = parCanonico(eu, alvo)
    // Aceita direto se já havia pendente do outro lado; senão cria pending meu.
    const upd = await db.query(
      `update friendships set status = 'accepted', accepted_at = now()
       where player_a = $1 and player_b = $2 and status = 'pending' and requested_by = $3 returning 1`,
      [a, b, alvo],
    )
    if (upd.rowCount > 0) return res.status(200).json({ status: 'accepted' })
    await db.query(
      `insert into friendships (player_a, player_b, status, requested_by)
       values ($1, $2, 'pending', $3) on conflict (player_a, player_b) do nothing`,
      [a, b, eu],
    )
    res.status(201).json({ status: 'pending' })
  })

  // Aceita um pedido recebido (pending em que EU não sou o requested_by). `eu` é sempre
  // ou `a` ou `b` no par canônico, então dá pra checar "requested_by <> eu" reaproveitando
  // o placeholder de $1/$2 correspondente, sem precisar de um terceiro parâmetro.
  router.post('/:steamId/aceitar', requireAuth, async (req, res) => {
    const eu = req.player.steamId
    const [a, b] = parCanonico(eu, req.params.steamId)
    const euEhA = a === eu
    const upd = await db.query(
      `update friendships set status = 'accepted', accepted_at = now()
       where player_a = $1 and player_b = $2 and status = 'pending' and requested_by <> $${euEhA ? 1 : 2} returning 1`,
      [a, b],
    )
    if (upd.rowCount === 0) return res.status(404).json({ erro: 'Nenhum pedido pendente desse jogador' })
    res.json({ ok: true })
  })

  // Remove a amizade/pedido em qualquer direção ou status (recusar/desfazer/cancelar).
  router.delete('/:steamId', requireAuth, async (req, res) => {
    const [a, b] = parCanonico(req.player.steamId, req.params.steamId)
    const del = await db.query('delete from friendships where player_a = $1 and player_b = $2 returning 1', [a, b])
    if (del.rowCount === 0) return res.status(404).json({ erro: 'Amizade não encontrada' })
    res.json({ ok: true })
  })

  return router
}
