import { Router } from 'express'
import { keyFromR2Url, streamObject, presignDownload } from '../r2.js'
import { partidaVisivelExpr } from '../friendships.js'
import { calcularStatsPorLado } from '../statsLado.js'
import { pedirMelhorClipeDoJogador } from '../allstarClip.js'

// Categoria de arma pro Head to Head (estilo Leetify: agrupa kills por família de
// arma em vez de listar cada uma). Faca/granadas caem em "Outras".
const CATEGORIA_ARMA = {
  ak47: 'Rifles', m4a1: 'Rifles', m4a1_silencer: 'Rifles', galilar: 'Rifles', famas: 'Rifles',
  aug: 'Rifles', sg556: 'Rifles',
  ssg08: 'Snipers', awp: 'Snipers', g3sg1: 'Snipers', scar20: 'Snipers',
  mp9: 'SMGs', mac10: 'SMGs', mp7: 'SMGs', ump45: 'SMGs', p90: 'SMGs', bizon: 'SMGs', mp5sd: 'SMGs',
  deagle: 'Pistolas', usp_silencer: 'Pistolas', hkp2000: 'Pistolas', glock: 'Pistolas', p250: 'Pistolas',
  fiveseven: 'Pistolas', tec9: 'Pistolas', cz75a: 'Pistolas', elite: 'Pistolas', revolver: 'Pistolas',
  nova: 'Shotguns', xm1014: 'Shotguns', sawedoff: 'Shotguns', mag7: 'Shotguns',
  m249: 'Pesadas', negev: 'Pesadas',
}
function categoriaArma(weapon) {
  return CATEGORIA_ARMA[weapon] ?? 'Outras'
}

export function createMatchesRouter({ db, requireAuth, r2Client, r2Bucket, config }) {
  const router = Router()

  // Feed: Partidas parseadas, com os Jogadores do grupo que jogaram cada uma.
  // Filtros opcionais: ?from=YYYY-MM-DD&to=YYYY-MM-DD&map=de_mirage&source=valve_mm|upload
  // ?ids=uuid,uuid,... — Partidas específicas (ex.: todas de uma "Resenha" clicada no
  // Feed); ignora os demais filtros e a paginação, já que o conjunto já vem delimitado.
  router.get('/', requireAuth, async (req, res) => {
    const cond = ["m.status = 'parsed'"]
    const params = [req.player.steamId]
    cond.push(partidaVisivelExpr('m', `$${params.length}`))
    const { from, to, map, source, mvp, ids } = req.query
    if (ids) {
      const lista = String(ids).split(',').filter((s) => /^[0-9a-f-]{36}$/i.test(s))
      if (lista.length === 0) return res.json([])
      params.push(lista)
      cond.push(`m.id = any($${params.length})`)
    }
    // Paginação: limit 1..100 (default 20), offset >=0 (default 0). O shape da
    // resposta continua um array puro — o client sabe que acabou quando uma
    // página volta com menos itens que `limit` (não precisamos de um flag extra).
    let limit = parseInt(req.query.limit, 10)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) limit = 20
    if (ids) limit = 100
    let offset = parseInt(req.query.offset, 10)
    if (!Number.isInteger(offset) || offset < 0) offset = 0
    if (!ids && from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
      params.push(from)
      cond.push(`m.played_at >= $${params.length}`)
    }
    if (!ids && to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      params.push(to)
      // inclusivo: até o fim do dia informado
      cond.push(`m.played_at < ($${params.length}::date + interval '1 day')`)
    }
    if (!ids && map && /^[a-z0-9_]+$/.test(map)) {
      params.push(map)
      cond.push(`m.map = $${params.length}`)
    }
    if (!ids && (source === 'valve_mm' || source === 'upload')) {
      params.push(source)
      cond.push(`m.source = $${params.length}`)
    }
    let mvpJoin = ''
    if (!ids && mvp && /^\d{17}$/.test(mvp)) {
      params.push(mvp)
      mvpJoin = `join lateral (
         select mp2.steam_id64
         from match_players mp2
         where mp2.match_id = m.id and mp2.is_tracked
         order by mp2.rating desc nulls last, mp2.kills desc
         limit 1
       ) mvp_filter on mvp_filter.steam_id64 = $${params.length}`
    }
    const { rows } = await db.query(
      `select m.id, m.map, m.played_at, m.score_a, m.score_b, m.status, m.source,
         m.team_a_name, m.team_b_name, m.plataforma_manual,
         coalesce(json_agg(json_build_object('steamId', mp.steam_id64, 'nick', mp.nick, 'won', mp.won))
           filter (where mp.is_tracked), '[]') as tracked,
         mvp.mvp
       from matches m
       left join match_players mp on mp.match_id = m.id
       left join lateral (
         -- jsonb (não json): o GROUP BY m.id, mvp.mvp exige operador de igualdade,
         -- que o tipo json não tem — com json o Postgres rejeita a query inteira.
         select jsonb_build_object(
           'steamId', mp3.steam_id64, 'nick', mp3.nick, 'rating', mp3.rating,
           'avatarUrl', coalesce(p3.avatar_url, sa3.avatar_url)
         ) as mvp
         from match_players mp3
         left join players p3 on p3.steam_id64 = mp3.steam_id64
         left join steam_avatares sa3 on sa3.steam_id64 = mp3.steam_id64
         where mp3.match_id = m.id and mp3.is_tracked
         order by mp3.rating desc nulls last, mp3.kills desc
         limit 1
       ) mvp on true
       ${mvpJoin}
       where ${cond.join(' and ')}
       group by m.id, mvp.mvp
       order by m.played_at desc nulls last, m.created_at desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, offset],
    )
    res.json(
      rows.map((m) => ({
        id: m.id,
        map: m.map,
        playedAt: m.played_at,
        scoreA: m.score_a,
        scoreB: m.score_b,
        source: m.source,
        plataformaManual: m.plataforma_manual,
        teamAName: m.team_a_name,
        teamBName: m.team_b_name,
        tracked: m.tracked,
        mvp: m.mvp ? { ...m.mvp, rating: m.mvp.rating === null ? null : Number(m.mvp.rating) } : null,
      })),
    )
  })

  // Status da sincronização: quantas Partidas descobertas ainda esperam download/parse.
  // (Precisa vir antes de '/:id' — senão o Express casaria "sync-status" como um id.)
  router.get('/sync-status', requireAuth, async (req, res) => {
    // 'pending'/'failed' ainda não têm match_players (a partida não foi parseada ainda),
    // então partidaVisivelExpr (que checa participação via match_players) nunca dá match
    // pra elas — usamos discovered_by (steamId de quem descobriu, ver matches.discovered_by
    // e coletor/src/coletor/main.py:cmd_discover) escopado por "eu ou um amigo meu"
    // em vez disso. 'parsed'/last_played_at seguem por participação/amizade como o resto.
    const eu = req.player.steamId
    const descobertoPorMimOuAmigo = `(m.discovered_by = $1 or exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and ((f.player_a = $1 and f.player_b = m.discovered_by) or (f.player_b = $1 and f.player_a = m.discovered_by))
    ))`
    const { rows } = await db.query(
      `select
         count(*) filter (where status = 'pending' and ${descobertoPorMimOuAmigo})::int as pending,
         count(*) filter (where status = 'failed' and ${descobertoPorMimOuAmigo})::int as failed,
         count(*) filter (where status = 'parsed' and ${partidaVisivelExpr('m', '$1')})::int as parsed,
         max(played_at) filter (where status = 'parsed' and ${partidaVisivelExpr('m', '$1')}) as last_played_at
       from matches m`,
      [eu],
    )
    const r = rows[0]
    res.json({ pending: r.pending, failed: r.failed, parsed: r.parsed, lastPlayedAt: r.last_played_at })
  })

  // Detalhe: placar dos 10 Participantes, rounds, highlights e clipes.
  router.get('/:id', requireAuth, async (req, res) => {
    const { id } = req.params
    const matchQ = await db.query(
      `select mt.id, mt.map, mt.played_at, mt.score_a, mt.score_b, mt.source, mt.status, mt.demo_url, mt.replay_url,
              mt.ended_early, mt.abandoned_by_steam_id64, mt.plataforma_manual,
              coalesce(ap.nick, amp.nick) as abandoned_by_nick
       from matches mt
       left join players ap on ap.steam_id64 = mt.abandoned_by_steam_id64
       left join match_players amp on amp.match_id = mt.id and amp.steam_id64 = mt.abandoned_by_steam_id64
       where mt.id = $1 and ${partidaVisivelExpr('mt', '$2')}`,
      [id, req.player.steamId],
    )
    if (matchQ.rows.length === 0) return res.status(404).json({ erro: 'Partida não encontrada' })
    const m = matchQ.rows[0]

    const [players, rounds, highlights, clips, econ, weapons, allstarClips] = await Promise.all([
      db.query(
        `select mp.steam_id64, mp.nick, mp.team, mp.kills, mp.deaths, mp.assists, mp.headshot_kills,
                mp.damage, mp.rounds_played, mp.rating, mp.kast_pct, mp.won, mp.is_tracked, mp.team_kills,
                mp.he_damage, mp.molotov_damage, mp.smokes_thrown, mp.flashes_thrown,
                mp.he_thrown, mp.molotovs_thrown, mp.enemies_flashed, mp.teammates_flashed,
                mp.enemy_flash_duration, mp.teammate_flash_duration,
                mp.he_team_damage, mp.molotov_team_damage, mp.flash_assists,
                mp.premier_rating_before, mp.premier_rating_after,
                mp.faceit_elo_before, mp.faceit_elo_after,
                coalesce(p.avatar_url, sa.avatar_url) as avatar_url
         from match_players mp
         left join players p on p.steam_id64 = mp.steam_id64
         left join steam_avatares sa on sa.steam_id64 = mp.steam_id64
         where mp.match_id = $1
         order by mp.team, mp.rating desc nulls last, mp.kills desc`,
        [id],
      ),
      db.query(
        'select round_number, winner_team, win_reason from rounds where match_id = $1 order by round_number',
        [id],
      ),
      db.query(
        `select h.id, h.steam_id64, h.round_number, h.kind, h.description, h.frame, mp.nick
         from highlights h
         left join match_players mp on mp.match_id = h.match_id and mp.steam_id64 = h.steam_id64
         where h.match_id = $1 order by h.round_number`,
        [id],
      ),
      db.query(
        `select id, steam_id64, url, provider, title, highlight_id
         from clips where match_id = $1 order by created_at`,
        [id],
      ),
      db.query(
        `select round_number, team, equip_value, buy_type
         from match_round_econ where match_id = $1 order by round_number`,
        [id],
      ),
      // Kills por arma, por Jogador, só dessa Partida — recolhido por padrão na UI,
      // pra conferir "com que arma ele matou" sem esperar a agregação de carreira.
      db.query(
        `select steam_id64, weapon, kills, hs_kills, shots_fired, shots_hit, damage
         from match_player_weapons where match_id = $1 order by steam_id64, kills desc`,
        [id],
      ),
      // Clipe real do Allstar por JOGADOR (não mais por highlight — ver allstarClip.js):
      // no máximo 1 por (match, steamId), gerado sob demanda na aba Clipes.
      db.query(
        `select steam_id64, status, clip_url, clip_snapshot_url, round_number
         from allstar_clips where match_id = $1`,
        [id],
      ),
    ])
    const armasPorJogador = new Map()
    for (const w of weapons.rows) {
      if (!armasPorJogador.has(w.steam_id64)) armasPorJogador.set(w.steam_id64, [])
      armasPorJogador.get(w.steam_id64).push({
        weapon: w.weapon,
        kills: w.kills,
        hsKills: w.hs_kills,
        shotsFired: w.shots_fired,
        shotsHit: w.shots_hit,
        damage: w.damage,
      })
    }
    const allstarClipPorJogador = new Map(
      allstarClips.rows.map((c) => [
        c.steam_id64,
        {
          status: c.status,
          clipUrl: c.status === 'Processed' ? c.clip_url : null,
          clipSnapshotUrl: c.clip_snapshot_url,
          roundNumber: c.round_number,
        },
      ]),
    )

    res.json({
      id: m.id,
      map: m.map,
      playedAt: m.played_at,
      scoreA: m.score_a,
      scoreB: m.score_b,
      source: m.source,
      plataformaManual: m.plataforma_manual,
      status: m.status,
      // O R2 é privado de propósito (dados reais dos participantes) — nunca expor a
      // URL bruta do bucket. O client busca via esses paths, autenticados e
      // proxiados pelo próprio servidor (ver rotas /:id/demo e /:id/replay abaixo).
      demoUrl: m.demo_url ? `/api/matches/${m.id}/demo` : null,
      replayUrl: m.replay_url ? `/api/matches/${m.id}/replay` : null,
      // Placar sem nenhum time batendo 13 (MR12) só é possível por abandono/forfeit
      // técnico — ver coletor/src/coletor/parse.py:_detectar_abandono. abandonedBy é
      // best-effort (só quando dá pra atribuir a exatamente 1 jogador).
      endedEarly: m.ended_early,
      abandonedBy: m.abandoned_by_steam_id64
        ? { steamId: m.abandoned_by_steam_id64, nick: m.abandoned_by_nick }
        : null,
      players: players.rows.map((p) => ({
        steamId: p.steam_id64,
        nick: p.nick,
        avatarUrl: p.avatar_url,
        team: p.team,
        kills: p.kills,
        teamKills: p.team_kills,
        deaths: p.deaths,
        assists: p.assists,
        headshotKills: p.headshot_kills,
        damage: p.damage,
        roundsPlayed: p.rounds_played,
        rating: p.rating === null ? null : Number(p.rating),
        kastPct: p.kast_pct != null ? Number(p.kast_pct) : null,
        premierBefore: p.premier_rating_before == null ? null : Number(p.premier_rating_before),
        premierAfter: p.premier_rating_after == null ? null : Number(p.premier_rating_after),
        faceitEloBefore: p.faceit_elo_before == null ? null : Number(p.faceit_elo_before),
        faceitEloAfter: p.faceit_elo_after == null ? null : Number(p.faceit_elo_after),
        won: p.won,
        isTracked: p.is_tracked,
        weapons: armasPorJogador.get(p.steam_id64) ?? [],
        // Clipe real do Allstar (ADR-0004) — ver allstarClip.js. null = nunca pedido.
        allstarClip: allstarClipPorJogador.get(p.steam_id64) ?? null,
        // Taxa de duelo: de todo confronto que terminou em morte envolvendo esse
        // Jogador (matou OU morreu), quanto % ele venceu. Não identifica "quase matou"
        // (precisaria de dado de engajamento que não temos) — só confrontos concluídos.
        duelWinPct: p.kills + p.deaths > 0 ? Math.round((p.kills / (p.kills + p.deaths)) * 1000) / 10 : null,
        utilitaria: {
          heDamage: p.he_damage,
          molotovDamage: p.molotov_damage,
          smokesThrown: p.smokes_thrown,
          flashesThrown: p.flashes_thrown,
          heThrown: p.he_thrown,
          molotovsThrown: p.molotovs_thrown,
          enemiesFlashed: p.enemies_flashed,
          teammatesFlashed: p.teammates_flashed,
          enemyFlashDuration: Number(p.enemy_flash_duration),
          teammateFlashDuration: Number(p.teammate_flash_duration),
          heTeamDamage: p.he_team_damage,
          molotovTeamDamage: p.molotov_team_damage,
          flashAssists: p.flash_assists,
        },
      })),
      rounds: rounds.rows.map((r) => ({
        roundNumber: r.round_number,
        winnerTeam: r.winner_team,
        winReason: r.win_reason,
      })),
      highlights: highlights.rows.map((h) => ({
        id: h.id,
        steamId: h.steam_id64,
        nick: h.nick,
        roundNumber: h.round_number,
        kind: h.kind,
        description: h.description,
        frame: h.frame,
      })),
      clips: clips.rows.map((c) => ({
        id: c.id,
        steamId: c.steam_id64,
        url: c.url,
        provider: c.provider,
        title: c.title,
        highlightId: c.highlight_id,
      })),
      economia: econ.rows.map((e) => ({
        roundNumber: e.round_number,
        team: e.team,
        equipValue: e.equip_value,
        buyType: e.buy_type,
      })),
    })
  })

  // Detalhe round-a-round de UM Jogador nessa Partida: o que matou/morreu, com que arma
  // e o gasto/itens comprados naquele round. Carregado só quando o modal abre pra esse
  // Jogador (recolhido por padrão na UI) — não bloa o payload do /:id pros outros 9.
  router.get('/:id/jogador/:steamId/detalhe', requireAuth, async (req, res) => {
    const { id, steamId } = req.params
    const matchQ = await db.query(
      `select id from matches where id = $1 and ${partidaVisivelExpr('matches', '$2')}`,
      [id, req.player.steamId],
    )
    if (matchQ.rows.length === 0) return res.status(404).json({ erro: 'Partida não encontrada' })

    const [kills, econ, compras] = await Promise.all([
      db.query(
        `select round_number, tick, killer, victim, weapon, victim_weapon, headshot
         from kill_positions
         where match_id = $1 and (killer = $2 or victim = $2)
         order by round_number, tick`,
        [id, steamId],
      ),
      db.query(
        `select round_number, equip_value, buy_type
         from match_player_round_econ
         where match_id = $1 and steam_id64 = $2
         order by round_number`,
        [id, steamId],
      ),
      db.query(
        `select round_number, item, cost, tick
         from match_player_purchases
         where match_id = $1 and steam_id64 = $2
         order by round_number, tick`,
        [id, steamId],
      ),
    ])

    const porRound = new Map()
    const linha = (rn) => {
      if (!porRound.has(rn)) {
        porRound.set(rn, { roundNumber: rn, matou: [], morreu: null, equipValue: null, buyType: null, compras: [] })
      }
      return porRound.get(rn)
    }
    for (const k of kills.rows) {
      if (k.killer === steamId) linha(k.round_number).matou.push({ weapon: k.weapon, headshot: k.headshot, tick: k.tick })
      // victimWeapon: o que ELE (a vítima) tinha na mão — diferente de "weapon" (arma
      // de quem matou). Responde "eu morri de AWP mas tava jogando de pistola".
      if (k.victim === steamId) {
        linha(k.round_number).morreu = { weapon: k.weapon, victimWeapon: k.victim_weapon, headshot: k.headshot, tick: k.tick }
      }
    }
    for (const e of econ.rows) {
      const l = linha(e.round_number)
      l.equipValue = e.equip_value
      l.buyType = e.buy_type
    }
    for (const c of compras.rows) {
      linha(c.round_number).compras.push({ item: c.item, cost: c.cost })
    }

    res.json({
      steamId,
      rounds: [...porRound.values()].sort((a, b) => a.roundNumber - b.roundNumber),
    })
  })

  // Head to Head: jogador de referência (steamId) comparado contra TODOS os
  // adversários do time contrário nessa Partida (estilo Leetify) — kills por
  // categoria de arma, dano e flashes, nas duas direções, numa chamada só.
  router.get('/:id/head-to-head/:steamId', requireAuth, async (req, res) => {
    const { id, steamId } = req.params
    const jogadorQ = await db.query(
      `select mp.team from matches m join match_players mp on mp.match_id = m.id
       where m.id = $1 and ${partidaVisivelExpr('m', '$2')} and mp.steam_id64 = $3`,
      [id, req.player.steamId, steamId],
    )
    if (jogadorQ.rows.length === 0) return res.status(404).json({ erro: 'Partida ou jogador não encontrado' })
    const timeReferencia = jogadorQ.rows[0].team

    const oponentesQ = await db.query(
      `select mp.steam_id64, mp.nick, mp.team, coalesce(p.avatar_url, sa.avatar_url) as avatar_url
       from match_players mp
       left join players p on p.steam_id64 = mp.steam_id64
       left join steam_avatares sa on sa.steam_id64 = mp.steam_id64
       where mp.match_id = $1 and mp.team != $2`,
      [id, timeReferencia],
    )
    const oponentes = oponentesQ.rows
    const steamIdsOponentes = oponentes.map((o) => o.steam_id64)
    if (steamIdsOponentes.length === 0) return res.json({ steamId, oponentes: [] })

    const [kills, damage, flashes] = await Promise.all([
      db.query(
        `select killer, victim, weapon from kill_positions
         where match_id = $1 and ((killer = $2 and victim = any($3)) or (victim = $2 and killer = any($3)))`,
        [id, steamId, steamIdsOponentes],
      ),
      db.query(
        `select attacker, victim, damage from match_player_damage
         where match_id = $1 and ((attacker = $2 and victim = any($3)) or (victim = $2 and attacker = any($3)))`,
        [id, steamId, steamIdsOponentes],
      ),
      db.query(
        `select attacker, victim, count, duration_sum from match_player_flashes
         where match_id = $1 and ((attacker = $2 and victim = any($3)) or (victim = $2 and attacker = any($3)))`,
        [id, steamId, steamIdsOponentes],
      ),
    ])

    const vazio = () => ({
      kills: 0, deaths: 0, killsPorCategoria: {}, killsPorCategoriaRecebido: {},
      dano: 0, danoRecebido: 0,
      flashes: { porMim: { vezes: 0, duracao: 0 }, porEle: { vezes: 0, duracao: 0 } },
    })
    const porOponente = new Map(steamIdsOponentes.map((sid) => [sid, vazio()]))

    for (const k of kills.rows) {
      const oponente = k.killer === steamId ? k.victim : k.killer
      const linha = porOponente.get(oponente)
      if (!linha) continue
      const cat = categoriaArma(k.weapon)
      if (k.killer === steamId) {
        linha.kills += 1
        linha.killsPorCategoria[cat] = (linha.killsPorCategoria[cat] ?? 0) + 1
      } else {
        linha.deaths += 1
        linha.killsPorCategoriaRecebido[cat] = (linha.killsPorCategoriaRecebido[cat] ?? 0) + 1
      }
    }
    for (const d of damage.rows) {
      const oponente = d.attacker === steamId ? d.victim : d.attacker
      const linha = porOponente.get(oponente)
      if (!linha) continue
      if (d.attacker === steamId) linha.dano += d.damage
      else linha.danoRecebido += d.damage
    }
    for (const f of flashes.rows) {
      const oponente = f.attacker === steamId ? f.victim : f.attacker
      const linha = porOponente.get(oponente)
      if (!linha) continue
      if (f.attacker === steamId) {
        linha.flashes.porMim.vezes += f.count
        linha.flashes.porMim.duracao += Number(f.duration_sum)
      } else {
        linha.flashes.porEle.vezes += f.count
        linha.flashes.porEle.duracao += Number(f.duration_sum)
      }
    }

    res.json({
      steamId,
      oponentes: oponentes.map((o) => ({
        steamId: o.steam_id64, nick: o.nick, avatarUrl: o.avatar_url, team: o.team,
        ...porOponente.get(o.steam_id64),
      })),
    })
  })

  // Scoreboard recalculado por lado (T/CT/all) dentro da Partida — pedido do usuário
  // (estilo scope.gg/Leetify). Só funciona pra partidas com side_a gravado (processadas
  // ou reprocessadas depois do FIL-51b); sem isso os filtros T/CT devolvem roundsPlayed=0
  // pra todo mundo (calcularStatsPorLado já trata isso, não quebra).
  router.get('/:id/lado/:filtro', requireAuth, async (req, res) => {
    const { id, filtro } = req.params
    if (!['all', 'CT', 'T'].includes(filtro)) return res.status(400).json({ erro: 'Filtro inválido' })
    const matchQ = await db.query(
      `select id from matches where id = $1 and ${partidaVisivelExpr('matches', '$2')}`,
      [id, req.player.steamId],
    )
    if (matchQ.rows.length === 0) return res.status(404).json({ erro: 'Partida não encontrada' })

    const [playersQ, roundsQ, killsQ, damageQ] = await Promise.all([
      db.query(
        `select mp.steam_id64, mp.nick, mp.team, coalesce(p.avatar_url, sa.avatar_url) as avatar_url
         from match_players mp
         left join players p on p.steam_id64 = mp.steam_id64
         left join steam_avatares sa on sa.steam_id64 = mp.steam_id64
         where mp.match_id = $1`,
        [id],
      ),
      db.query('select round_number, side_a from rounds where match_id = $1', [id]),
      db.query(
        'select round_number, tick, killer, victim, assister, headshot from kill_positions where match_id = $1',
        [id],
      ),
      db.query(
        'select round_number, steam_id64, damage from match_player_round_damage where match_id = $1',
        [id],
      ),
    ])

    const stats = calcularStatsPorLado({
      players: playersQ.rows.map((p) => ({ steamId: p.steam_id64, team: p.team })),
      rounds: roundsQ.rows.map((r) => ({ roundNumber: r.round_number, sideA: r.side_a })),
      kills: killsQ.rows.map((k) => ({
        roundNumber: k.round_number, tick: k.tick, killer: k.killer, victim: k.victim,
        assister: k.assister, headshot: k.headshot,
      })),
      roundDamage: damageQ.rows.map((d) => ({ roundNumber: d.round_number, steamId: d.steam_id64, damage: d.damage })),
      filtro,
    })

    res.json(
      playersQ.rows.map((p) => ({
        steamId: p.steam_id64,
        nick: p.nick,
        avatarUrl: p.avatar_url,
        team: p.team,
        ...stats[p.steam_id64],
      })),
    )
  })

  // Pedido SOB DEMANDA do melhor clipe da partida pra um JOGADOR (ADR-0004) — o
  // jogador clica "gerar melhor clipe" na aba Clipes, nada é automático. Qualquer
  // Jogador autenticado pode gerar o PRÓPRIO clipe; gerar o clipe de OUTRO jogador da
  // partida é restrito a config.allstarSteamIds (o dono do sistema) — checado contra
  // req.player.steamId, quem tá logado, não o steamId alvo do clipe.
  //
  // Por que "por jogador" e não mais "por highlight": só POTG e BP estão habilitados
  // na nossa conta (dashboard Allstar + sondagem real, 2026-07-21) — nenhum dos dois
  // aceita mirar um round específico. POTG nem aceita steamId (podia devolver o
  // clipe de OUTRO jogador — bug real reportado pelo usuário); BP aceita steamId,
  // então garante que o clipe é sempre daquele jogador, mas ainda é "a melhor jogada
  // DELE na partida inteira", não um round escolhido. Ver allstarClip.js.
  router.post('/:id/jogador/:steamId/clipe', requireAuth, async (req, res) => {
    if (!config.allstarApiKey || !r2Client) {
      return res.status(503).json({ erro: 'Integração com o Allstar não configurada' })
    }
    const { id, steamId } = req.params
    const { rows } = await db.query(
      `select mp.steam_id64, mp.nick, m.demo_url
       from match_players mp
       join matches m on m.id = mp.match_id
       where mp.match_id = $1 and mp.steam_id64 = $2
         and ${partidaVisivelExpr('m', '$3')}`,
      [id, steamId, req.player.steamId],
    )
    const jogador = rows[0]
    if (!jogador) return res.status(404).json({ erro: 'Jogador não encontrado nessa partida' })
    const ehDono = config.allstarSteamIds.has(req.player.steamId)
    if (!ehDono && req.player.steamId !== steamId) {
      return res.status(403).json({ erro: 'Você só pode gerar o clipe do seu próprio jogador' })
    }
    if (!jogador.demo_url) return res.status(404).json({ erro: 'Demo não arquivada pra essa partida' })

    const existente = await db.query(
      'select status, clip_url from allstar_clips where match_id = $1 and steam_id64 = $2',
      [id, steamId],
    )
    if (existente.rows.length > 0 && existente.rows[0].status !== 'Error') {
      // Já pedido antes (ex.: clique duplo) — devolve o que já existe em vez de pedir
      // outro clipe do mesmo jogador. Status 'Error' passa direto: o jogador pode
      // tentar de novo (a linha antiga é substituída pelo pedido novo logo abaixo).
      return res.json({ status: existente.rows[0].status })
    }

    const demoKey = keyFromR2Url(jogador.demo_url, r2Bucket)
    if (!demoKey) return res.status(404).json({ erro: 'Demo fora do bucket configurado' })
    try {
      // URL assinada temporária — o bucket é privado, o Allstar busca o .dem sozinho
      // do lado deles, não tem como autenticar como um Jogador nosso logado. 24h de
      // validade (não o default de 2h): a fila de render deles pode demorar horas pra
      // pegar o job, e uma URL expirada no meio da fila viraria erro de download.
      const demoUrlAssinada = await presignDownload(r2Client, r2Bucket, demoKey, 86400)
      const requestId = await pedirMelhorClipeDoJogador({
        apiKey: config.allstarApiKey, steamId, nick: jogador.nick,
        demoUrl: demoUrlAssinada,
        webhookUrl: `${config.appUrl}/api/allstar/webhook`,
        metadata: [{ key: 'matchId', value: id }, { key: 'steamId', value: steamId }],
      })
      // Retry depois de Error: remove a tentativa falhada antes de gravar a nova —
      // sem isso o GET /:id devolveria duas linhas pro mesmo jogador (o unique
      // constraint em (match_id, steam_id64) rejeitaria o insert de qualquer forma).
      await db.query("delete from allstar_clips where match_id = $1 and steam_id64 = $2 and status = 'Error'", [id, steamId])
      await db.query('insert into allstar_clips (match_id, steam_id64, request_id) values ($1, $2, $3)', [id, steamId, requestId])
      res.json({ status: 'Submitted' })
    } catch (e) {
      console.error(`allstar: falha ao pedir clipe do jogador ${steamId} na partida ${id}:`, e)
      res.status(502).json({ erro: `Falha ao pedir o clipe ao Allstar: ${e.message}` })
    }
  })

  // Proxy autenticado pro replay 2D — nunca expõe a URL/credenciais do R2 ao client.
  // Partidas novas: esse objeto é só o ÍNDICE (streaming por round, ver FIL-54b) — sem
  // `frames` por round, só a contagem; o client busca cada round em /replay/round/:n.
  // Partidas antigas (arquivadas antes dessa mudança): o objeto já é o replay INTEIRO
  // (com `frames`), e o client detecta isso pela ausência de `frameCount` no round.
  router.get('/:id/replay', requireAuth, async (req, res) => {
    if (!r2Client) return res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })
    const { rows } = await db.query(
      `select replay_url from matches where id = $1 and ${partidaVisivelExpr('matches', '$2')}`,
      [req.params.id, req.player.steamId],
    )
    const key = keyFromR2Url(rows[0]?.replay_url, r2Bucket)
    if (!key) return res.status(404).json({ erro: 'Replay não disponível' })
    try {
      await streamObject(r2Client, r2Bucket, key, res)
    } catch {
      res.status(502).json({ erro: 'Falha ao buscar o replay no R2' })
    }
  })

  // Um round do replay sob demanda (streaming por round) — só existe pro formato novo
  // (índice); a chave é o mesmo prefixo do índice, trocando ".json" por "/round-{n}.json"
  // (mesma convenção do coletor em `_upload_replay`, main.py).
  router.get('/:id/replay/round/:n', requireAuth, async (req, res) => {
    if (!/^\d+$/.test(req.params.n)) return res.status(400).json({ erro: 'Round inválido' })
    if (!r2Client) return res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })
    const { rows } = await db.query(
      `select replay_url from matches where id = $1 and ${partidaVisivelExpr('matches', '$2')}`,
      [req.params.id, req.player.steamId],
    )
    const indexKey = keyFromR2Url(rows[0]?.replay_url, r2Bucket)
    if (!indexKey) return res.status(404).json({ erro: 'Replay não disponível' })
    const base = indexKey.endsWith('.json') ? indexKey.slice(0, -'.json'.length) : indexKey
    const key = `${base}/round-${req.params.n}.json`
    try {
      await streamObject(r2Client, r2Bucket, key, res)
    } catch {
      res.status(404).json({ erro: 'Round não disponível' })
    }
  })

  // Idem para o .dem bruto (arquivado por completude — ADR-0002 — não usado pela UI ainda).
  router.get('/:id/demo', requireAuth, async (req, res) => {
    if (!r2Client) return res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })
    const { rows } = await db.query(
      `select demo_url from matches where id = $1 and ${partidaVisivelExpr('matches', '$2')}`,
      [req.params.id, req.player.steamId],
    )
    const key = keyFromR2Url(rows[0]?.demo_url, r2Bucket)
    if (!key) return res.status(404).json({ erro: 'Demo não disponível' })
    try {
      await streamObject(r2Client, r2Bucket, key, res)
    } catch {
      res.status(502).json({ erro: 'Falha ao buscar o demo no R2' })
    }
  })

  return router
}
