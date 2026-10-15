import { Router } from 'express'

// Direitos do titular (LGPD art. 18): acesso/portabilidade (exportar) e eliminação
// (excluir conta). Só age sobre o PRÓPRIO jogador logado — nenhum parâmetro de quem.
//
// "Excluir" é anonimização, não DELETE da linha de players: partidas, táticas, granadas e
// competições apontam pra players por FK, e as Partidas também são dado legítimo dos
// outros 9 participantes. Some o que a conta guarda (nick, avatar, códigos, vínculos,
// amizades, clipes, envios); os números da partida ficam sob "Jogador removido".
//
// Limite assumido e dito na interface e em /privacidade: as estatísticas continuam
// ligadas ao SteamID, que vem da própria demo (e volta a cada demo reprocessada com essa
// pessoa). Por isso, se ela entrar de novo com a mesma Steam, as partidas antigas voltam
// a aparecer pra ela. Re-chavear o SteamID nas ~15 tabelas de estatística não resolveria:
// a próxima demo com esse jogador traria o SteamID de volta.
const NICK_REMOVIDO = 'Jogador removido'

export function createMinhaContaRouter({ db, requireAuth, config }) {
  const router = Router()

  router.get('/exportar', requireAuth, async (req, res) => {
    const eu = req.player.steamId
    const [jogador, partidas, amizades, curso, clipes, submissoes, uploads] = await Promise.all([
      db.query(
        `select steam_id64, nick, avatar_url, faceit_id, faceit_nick, faceit_elo, faceit_skill_level,
                conta_criada_em, created_at, tour_concluido,
                match_auth_code is not null as codigo_historico_configurado
         from players where steam_id64 = $1`,
        [eu],
      ),
      db.query(
        `select m.id as partida_id, m.map, m.played_at, m.source, mp.team, mp.kills, mp.deaths,
                mp.assists, mp.headshot_kills, mp.damage, mp.rounds_played, mp.rating, mp.won
         from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = $1 order by m.played_at desc nulls last`,
        [eu],
      ),
      db.query(
        `select player_a, player_b, status, requested_by, accepted_at
         from friendships where player_a = $1 or player_b = $1`,
        [eu],
      ),
      db.query('select * from curso_progresso where steam_id64 = $1', [eu]),
      db.query(
        `select id, match_id, round_number, status, clip_url, created_at
         from allstar_clips where steam_id64 = $1`,
        [eu],
      ),
      db.query('select competicao_id, allstar_clip_id from competicao_submissoes where steam_id64 = $1', [eu]),
      db.query(
        `select id, share_code, played_at, status, adicionado_em
         from uploads_pendentes where adicionado_por = $1`,
        [eu],
      ),
    ])
    res.attachment(`resenha-meus-dados-${eu}.json`)
    res.json({
      geradoEm: new Date().toISOString(),
      jogador: jogador.rows[0] ?? null,
      partidas: partidas.rows,
      amizades: amizades.rows,
      cursoProgresso: curso.rows,
      clipes: clipes.rows,
      submissoesEmCompeticoes: submissoes.rows,
      demosEnviadas: uploads.rows,
    })
  })

  router.delete('/', requireAuth, async (req, res) => {
    // Confirmação explícita no corpo: nenhum clique acidental (ou requisição forjada)
    // apaga a conta.
    if (req.body?.confirmacao !== 'EXCLUIR') {
      return res.status(400).json({ erro: 'Confirme digitando EXCLUIR' })
    }
    const eu = req.player.steamId
    const cliente = await db.connect()
    try {
      await cliente.query('begin')
      await cliente.query('delete from friendships where player_a = $1 or player_b = $1', [eu])
      await cliente.query('delete from curso_progresso where steam_id64 = $1', [eu])
      await cliente.query('delete from competicao_submissoes where steam_id64 = $1', [eu])
      await cliente.query('delete from allstar_clips where steam_id64 = $1', [eu])
      // Todos os status (pendente, processando, falhou, concluida, limpo): a linha guarda
      // quem enviou e o share code. O Coletor não lê adicionado_por depois de pegar o
      // item, então apagar um "processando" só faz o update final dele não achar a linha;
      // a Partida que ele terminar de ingerir é dado dos 10 jogadores, não desta conta.
      // O arquivo no R2 vira órfão e cai na limpeza de uploads órfãos do Coletor.
      await cliente.query('delete from uploads_pendentes where adicionado_por = $1', [eu])
      await cliente.query('update matches set discovered_by = null where discovered_by = $1', [eu])
      await cliente.query(
        'update match_players set nick = $2, is_tracked = false where steam_id64 = $1',
        [eu, NICK_REMOVIDO],
      )
      await cliente.query('delete from steam_avatares where steam_id64 = $1', [eu])
      await cliente.query(
        `update players set
           nick = $2, avatar_url = null, match_auth_code = null, last_share_code = null,
           faceit_id = null, faceit_nick = null, faceit_elo = null, faceit_skill_level = null,
           faceit_elo_atualizado_em = null, conta_criada_em = null, tour_concluido = false,
           is_super_admin = false, tokens_validos_apos = now()
         where steam_id64 = $1`,
        [eu, NICK_REMOVIDO],
      )
      await cliente.query('commit')
    } catch (e) {
      await cliente.query('rollback').catch(() => {})
      throw e
    } finally {
      cliente.release()
    }
    res.clearCookie('resenha_token', { httpOnly: true, sameSite: 'lax', secure: config.isProduction })
    res.json({ ok: true })
  })

  return router
}
