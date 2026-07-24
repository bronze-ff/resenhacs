import { Router } from 'express'
import { calcularEstilos, calcularBadges, melhorSequenciaDeVitorias } from '../analise.js'
import { worldToRadar, isMapaCalibrado } from '../mapCalibration.js'
import { partidaVisivelExpr } from '../friendships.js'

function pct(parte, total) {
  if (!total) return 0
  return Math.round((parte / total) * 1000) / 10
}

// Filtro opcional de período (?from=YYYY-MM-DD&to=YYYY-MM-DD) — anexa condições sobre
// m.played_at aos params e devolve o pedaço de SQL. `to` é inclusivo (fim do dia).
function periodoWhere(from, to, params) {
  let sql = ''
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    params.push(from)
    sql += ` and m.played_at >= $${params.length}`
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    params.push(to)
    sql += ` and m.played_at < ($${params.length}::date + interval '1 day')`
  }
  return sql
}

// Escopa por AMIZADE a regra de visibilidade por participação (ver friendships.js): a
// partida entra se o próprio viewer jogou nela, OU se um amigo `accepted` do viewer jogou.
// Mesma convenção do periodoWhere (anexa aos params, devolve o SQL, alias 'm'). Call sites
// que usam outro alias (ex.: aces com 'mh') aplicam .replaceAll('m.', 'mh.') no retorno — o
// fragmento só usa o alias 'm.' e 'm.id', que a troca cobre.
function visivelWhere(viewerSteamId, params) {
  if (!viewerSteamId) return ''
  params.push(viewerSteamId)
  return ` and ${partidaVisivelExpr('m', `$${params.length}`)}`
}

async function statsAgregados(db, steamId, from, to, viewerSteamId) {
  const params = [steamId]
  const periodo = periodoWhere(from, to, params)
  const visivel = visivelWhere(viewerSteamId, params)
  const { rows } = await db.query(
    `select count(*)::int as partidas,
            coalesce(sum(case when mp.won then 1 else 0 end), 0)::int as vitorias,
            coalesce(sum(mp.kills), 0)::int as kills,
            coalesce(sum(mp.deaths), 0)::int as deaths,
            coalesce(sum(mp.assists), 0)::int as assists,
            coalesce(sum(mp.headshot_kills), 0)::int as hs,
            coalesce(sum(mp.damage), 0)::int as damage,
            coalesce(sum(mp.rounds_played), 0)::int as rounds,
            avg(mp.rating) as rating,
            coalesce(sum(mp.utility_damage), 0)::int as utility_damage,
            coalesce(sum(mp.shots_fired), 0)::int as shots_fired,
            coalesce(sum(mp.shots_hit), 0)::int as shots_hit,
            coalesce(sum(mp.entry_kills), 0)::int as entry_kills,
            coalesce(sum(mp.entry_deaths), 0)::int as entry_deaths,
            coalesce(sum(mp.entry_wins), 0)::int as entry_wins,
            coalesce(sum(mp.trade_kills), 0)::int as trade_kills,
            coalesce(sum(mp.traded_deaths), 0)::int as traded_deaths,
            coalesce(sum(mp.clutch_wins), 0)::int as clutch_wins,
            coalesce(sum(mp.clutch_attempts), 0)::int as clutch_attempts,
            coalesce(sum(mp.clutch_saves), 0)::int as clutch_saves,
            coalesce(sum(mp.he_damage), 0)::int as he_damage,
            coalesce(sum(mp.molotov_damage), 0)::int as molotov_damage,
            coalesce(sum(mp.smokes_thrown), 0)::int as smokes_thrown,
            coalesce(sum(mp.flashes_thrown), 0)::int as flashes_thrown,
            coalesce(sum(mp.he_thrown), 0)::int as he_thrown,
            coalesce(sum(mp.molotovs_thrown), 0)::int as molotovs_thrown,
            coalesce(sum(mp.enemies_flashed), 0)::int as enemies_flashed,
            coalesce(sum(mp.teammates_flashed), 0)::int as teammates_flashed,
            coalesce(sum(mp.enemy_flash_duration), 0)::numeric as enemy_flash_duration,
            coalesce(sum(mp.teammate_flash_duration), 0)::numeric as teammate_flash_duration,
            coalesce(sum(mp.he_team_damage), 0)::int as he_team_damage,
            coalesce(sum(mp.molotov_team_damage), 0)::int as molotov_team_damage,
            coalesce(sum(mp.flash_assists), 0)::int as flash_assists,
            coalesce(sum(mp.enemy_flash_landed_count), 0)::int as enemy_flash_landed_count,
            coalesce(sum(mp.enemy_flash_landed_duration_sum), 0)::numeric as enemy_flash_landed_duration_sum,
            coalesce((select count(*) from highlights h join matches mh on mh.id = h.match_id
                      where h.steam_id64 = $1 and h.kind = 'ace'${periodo.replaceAll('m.', 'mh.')}${visivel.replaceAll('m.', 'mh.')}), 0)::int as aces
     from match_players mp join matches m on m.id = mp.match_id
     where mp.steam_id64 = $1${periodo}${visivel}`,
    params,
  )
  const a = rows[0]
  return {
    partidas: a.partidas,
    vitorias: a.vitorias,
    winrate: pct(a.vitorias, a.partidas),
    kills: a.kills,
    deaths: a.deaths,
    assists: a.assists,
    kd: a.deaths ? Math.round((a.kills / a.deaths) * 100) / 100 : a.kills,
    hsPct: pct(a.hs, a.kills),
    adr: a.rounds ? Math.round((a.damage / a.rounds) * 10) / 10 : 0,
    rating: a.rating === null ? null : Math.round(Number(a.rating) * 100) / 100,
    // Estilo Leetify: precisão, dano de utilitária, entries, trades, clutch.
    accuracy: pct(a.shots_hit, a.shots_fired),
    shotsFired: a.shots_fired,
    shotsHit: a.shots_hit,
    utilityDamage: a.utility_damage,
    utilityDamagePerRound: a.rounds ? Math.round((a.utility_damage / a.rounds) * 10) / 10 : 0,
    entryKills: a.entry_kills,
    entryDeaths: a.entry_deaths,
    entryWinPct: pct(a.entry_wins, a.entry_kills),
    tradeKills: a.trade_kills,
    tradedDeaths: a.traded_deaths,
    clutchWins: a.clutch_wins,
    clutchAttempts: a.clutch_attempts,
    clutchSaves: a.clutch_saves,
    clutchPct: pct(a.clutch_wins, a.clutch_attempts),
    aces: a.aces,
    // Utilitária: granadas usadas por tipo, dano de HE/molotov separado, e cegueira
    // causada em inimigo vs aliado (contagem + segundos totais).
    heDamage: a.he_damage,
    molotovDamage: a.molotov_damage,
    smokesThrown: a.smokes_thrown,
    flashesThrown: a.flashes_thrown,
    heThrown: a.he_thrown,
    molotovsThrown: a.molotovs_thrown,
    enemiesFlashed: a.enemies_flashed,
    teammatesFlashed: a.teammates_flashed,
    enemyFlashDuration: Math.round(Number(a.enemy_flash_duration) * 10) / 10,
    teammateFlashDuration: Math.round(Number(a.teammate_flash_duration) * 10) / 10,
    // "Sucesso" da flash = quantos inimigos cegados por flash jogada (não é % porque
    // uma flash pode cegar 0 a 5 inimigos de uma vez).
    enemiesFlashedPerFlash: a.flashes_thrown ? Math.round((a.enemies_flashed / a.flashes_thrown) * 100) / 100 : 0,
    // Comparação com o Leetify (2026-07-11): eles separam dano de HE/molotov em
    // inimigo vs próprio time (fogo amigo) e têm "Flash Assists" — adicionamos os três.
    heTeamDamage: a.he_team_damage,
    molotovTeamDamage: a.molotov_team_damage,
    flashAssists: a.flash_assists,
    flashAssistPct: pct(a.flash_assists, a.flashes_thrown),
    // Médias por arremesso — mesmo recorte do "Avg HE damage" / "Avg blind time" do Leetify.
    avgHeDamage: a.he_thrown ? Math.round((a.he_damage / a.he_thrown) * 10) / 10 : 0,
    avgMolotovDamage: a.molotovs_thrown ? Math.round((a.molotov_damage / a.molotovs_thrown) * 10) / 10 : 0,
    // Tempo médio de cegueira "estilo Leetify": duração do inimigo mais atingido POR
    // FLASHBANG (não a média de todo blind evento) — média só sobre flashbangs que
    // acertaram alguém. Ver enemy_flash_landed_count/_duration_sum no parser.
    avgBlindDuration: a.enemy_flash_landed_count
      ? Math.round((Number(a.enemy_flash_landed_duration_sum) / a.enemy_flash_landed_count) * 10) / 10
      : 0,
  }
}

// Melhor sequência de vitórias consecutivas, sempre no histórico INTEIRO visível ao viewer
// (badge de conquista não deve sumir/reaparecer conforme o filtro de período da tela).
async function melhorSequencia(db, steamId, viewerSteamId) {
  const params = [steamId]
  const visivel = visivelWhere(viewerSteamId, params)
  const { rows } = await db.query(
    `select mp.won from match_players mp join matches m on m.id = mp.match_id
     where mp.steam_id64 = $1 and m.status = 'parsed'${visivel} order by m.played_at asc nulls first`,
    params,
  )
  return melhorSequenciaDeVitorias(rows.map((r) => r.won))
}

// Estilo de jogo do steamId, relativo à média da REDE DE AMIZADE do viewer (mesmo período da tela).
async function estiloDoJogador(db, steamId, from, to, viewerSteamId) {
  const params = []
  const periodo = periodoWhere(from, to, params)
  const visivel = visivelWhere(viewerSteamId, params)
  const { rows } = await db.query(
    `select mp.steam_id64,
            count(*)::int as partidas,
            coalesce(sum(mp.entry_kills), 0)::int as entry_kills,
            coalesce(sum(mp.entry_deaths), 0)::int as entry_deaths,
            coalesce(sum(mp.utility_damage), 0)::int as utility_damage,
            coalesce(sum(mp.rounds_played), 0)::int as rounds,
            coalesce(sum(mp.clutch_wins), 0)::int as clutch_wins,
            coalesce(sum(mp.clutch_attempts), 0)::int as clutch_attempts,
            coalesce(sum(mp.shots_fired), 0)::int as shots_fired,
            coalesce(sum(mp.shots_hit), 0)::int as shots_hit
     from match_players mp join matches m on m.id = mp.match_id
     where true${periodo}${visivel}
     group by mp.steam_id64`,
    params,
  )
  const entrada = rows.map((r) => ({
    steamId: r.steam_id64,
    partidas: r.partidas,
    entryRate: r.partidas ? (r.entry_kills + r.entry_deaths) / r.partidas : 0,
    utilityPerRound: r.rounds ? r.utility_damage / r.rounds : 0,
    clutchPct: pct(r.clutch_wins, r.clutch_attempts),
    clutchAttempts: r.clutch_attempts,
    accuracy: pct(r.shots_hit, r.shots_fired),
  }))
  return calcularEstilos(entrada)[steamId] ?? null
}

async function evolucaoRating(db, steamId, from, to, viewerSteamId, limite = 20) {
  const params = [steamId]
  const periodo = periodoWhere(from, to, params)
  const visivel = visivelWhere(viewerSteamId, params)
  params.push(limite)
  const { rows } = await db.query(
    `select m.id, m.played_at, mp.rating
     from match_players mp join matches m on m.id = mp.match_id
     where mp.steam_id64 = $1 and m.status = 'parsed' and mp.rating is not null${periodo}${visivel}
     order by m.played_at desc nulls last limit $${params.length}`,
    params,
  )
  return rows
    .map((r) => ({ matchId: r.id, playedAt: r.played_at, rating: Number(r.rating) }))
    .reverse() // cronológico, pro gráfico ler da esquerda pra direita
}

// AWP fora do cálculo de accuracy/HS-por-acerto (quase todo hit mata, distorce o %) e
// shotguns à parte (1 weapon_fire dispara vários pellets → vários player_hurt, accuracy
// passaria de 100% se contado ingenuamente) — mesma convenção do Leetify (ver pesquisa).
const ARMAS_SEM_ACCURACY_CONFIAVEL = new Set(['awp', 'nova', 'xm1014', 'mag7', 'sawedoff'])

async function armasDoJogador(db, steamId, from, to, viewerSteamId) {
  const params = [steamId]
  const periodo = periodoWhere(from, to, params)
  const visivel = visivelWhere(viewerSteamId, params)
  const { rows } = await db.query(
    `select w.weapon,
            sum(w.kills)::int as kills,
            sum(w.hs_kills)::int as hs_kills,
            sum(w.shots_fired)::int as shots_fired,
            sum(w.shots_hit)::int as shots_hit,
            sum(w.damage)::int as damage
     from match_player_weapons w join matches m on m.id = w.match_id
     where w.steam_id64 = $1${periodo}${visivel}
     group by w.weapon
     order by kills desc`,
    params,
  )
  // Agregação multi-partida = SOMA dos totais, nunca média de porcentagens.
  return rows.map((r) => ({
    weapon: r.weapon,
    kills: r.kills,
    hsPct: pct(r.hs_kills, r.kills),
    shotsFired: r.shots_fired,
    shotsHit: r.shots_hit,
    accuracy: pct(r.shots_hit, r.shots_fired),
    temAccuracyConfiavel: !ARMAS_SEM_ACCURACY_CONFIAVEL.has(r.weapon),
    damage: r.damage,
  }))
}

// Mesmo gate de presença usado por GET /:steamId (ver comentário lá): o alvo só é visível
// se for o próprio viewer, um amigo `accepted`, ou alguém que jogou numa partida visível
// ao viewer. Extraído aqui porque agora é usado em 2 lugares neste arquivo (/compare
// precisa checar os DOIS lados, a e b).
async function temPresenca(db, steamId, viewerSteamId) {
  const presenca = await db.query(
    `select ($1 = $2
          or exists (select 1 from friendships f
                     where ((f.player_a = $2 and f.player_b = $1) or (f.player_b = $2 and f.player_a = $1))
                       and f.status = 'accepted')
          or exists (select 1 from match_players mp join matches m on m.id = mp.match_id
                     where mp.steam_id64 = $1 and ${partidaVisivelExpr('m', '$2')})) as tem`,
    [steamId, viewerSteamId],
  )
  return Boolean(presenca.rows[0]?.tem)
}

const BUY_TYPES = ['eco', 'forcado', 'semi', 'full']

async function economiaDoJogador(db, steamId, from, to, viewerSteamId) {
  const params = [steamId]
  const periodo = periodoWhere(from, to, params)
  const visivel = visivelWhere(viewerSteamId, params)
  const { rows } = await db.query(
    `select e.buy_type,
            count(*)::int as rounds,
            count(*) filter (where r.winner_team = mp.team)::int as won
     from match_players mp
     join match_round_econ e on e.match_id = mp.match_id and e.team = mp.team
     join rounds r on r.match_id = mp.match_id and r.round_number = e.round_number
     join matches m on m.id = mp.match_id
     where mp.steam_id64 = $1${periodo}${visivel}
     group by e.buy_type`,
    params,
  )
  const porTipo = Object.fromEntries(rows.map((r) => [r.buy_type, r]))
  return Object.fromEntries(
    BUY_TYPES.map((tipo) => {
      const r = porTipo[tipo]
      const rounds = r?.rounds ?? 0
      const won = r?.won ?? 0
      return [tipo, { rounds, won, winPct: pct(won, rounds) }]
    }),
  )
}

export function createProfileRouter({ db, requireAuth }) {
  const router = Router()

  // Comparação entre 2 Jogadores: stats lado a lado + confronto direto (mesmo time / times opostos).
  // Precisa vir antes de '/:steamId' — senão o Express casaria "compare" como um steamId.
  router.get('/compare', requireAuth, async (req, res) => {
    const a = String(req.query.a ?? '')
    const b = String(req.query.b ?? '')
    const { from, to } = req.query
    if (!/^\d{17}$/.test(a) || !/^\d{17}$/.test(b) || a === b) {
      return res.status(400).json({ erro: 'Informe dois SteamID64 diferentes (a e b)' })
    }
    const playersQ = await db.query(
      `select p.steam_id64, p.nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url
       from players p
       left join steam_avatares sa on sa.steam_id64 = p.steam_id64
       where p.steam_id64 in ($1, $2)`,
      [a, b],
    )
    const jogadorA = playersQ.rows.find((p) => p.steam_id64 === a)
    const jogadorB = playersQ.rows.find((p) => p.steam_id64 === b)
    if (!jogadorA || !jogadorB) return res.status(404).json({ erro: 'Jogador não encontrado' })

    // Mesmo gate de presença do GET /:steamId: sem isso, nick/avatar de qualquer SteamID64
    // válido em `players` vazariam pra qualquer conta logada, mesmo fora da rede de amizade
    // do viewer (as stats agregadas já eram corretamente escopadas, só a identidade vazava).
    const [presencaA, presencaB] = await Promise.all([
      temPresenca(db, a, req.player.steamId),
      temPresenca(db, b, req.player.steamId),
    ])
    if (!presencaA || !presencaB) return res.status(404).json({ erro: 'Jogador não encontrado' })

    const confrontoParams = [a, b]
    const confrontoPeriodo = periodoWhere(from, to, confrontoParams)
    const confrontoVisivel = visivelWhere(req.player.steamId, confrontoParams)
    const [statsA, statsB, evolA, evolB, confrontoQ] = await Promise.all([
      statsAgregados(db, a, from, to, req.player.steamId),
      statsAgregados(db, b, from, to, req.player.steamId),
      evolucaoRating(db, a, from, to, req.player.steamId),
      evolucaoRating(db, b, from, to, req.player.steamId),
      db.query(
        `select mp_a.team as team_a, mp_b.team as team_b, mp_a.won as a_venceu
         from match_players mp_a
         join match_players mp_b on mp_b.match_id = mp_a.match_id and mp_b.steam_id64 = $2
         join matches m on m.id = mp_a.match_id
         where mp_a.steam_id64 = $1${confrontoPeriodo}${confrontoVisivel}`,
        confrontoParams,
      ),
    ])

    const confronto = confrontoQ.rows
    const mesmoTime = confronto.filter((r) => r.team_a === r.team_b)
    const timesOpostos = confronto.filter((r) => r.team_a !== r.team_b)
    const aVenceuOpostos = timesOpostos.filter((r) => r.a_venceu).length

    res.json({
      a: { steamId: jogadorA.steam_id64, nick: jogadorA.nick, avatarUrl: jogadorA.avatar_url, stats: statsA, evolucao: evolA },
      b: { steamId: jogadorB.steam_id64, nick: jogadorB.nick, avatarUrl: jogadorB.avatar_url, stats: statsB, evolucao: evolB },
      confronto: {
        partidasJuntos: confronto.length,
        mesmoTime: mesmoTime.length,
        mesmoTimeVitorias: mesmoTime.filter((r) => r.a_venceu).length,
        timesOpostos: timesOpostos.length,
        aVenceu: aVenceuOpostos,
        bVenceu: timesOpostos.length - aVenceuOpostos,
      },
    })
  })

  // Posicionamento agregado: "onde ele mais mata/morre" ao longo de VÁRIAS Partidas
  // (não só uma, como o Replay 2D). Precisa vir antes de '/:steamId' — Express não
  // confundiria os dois (segmentos diferentes), mas por hábito/consistência com as
  // outras rotas de 2+ segmentos deste router.
  router.get('/:steamId/posicoes', requireAuth, async (req, res) => {
    const { steamId } = req.params
    const modo = req.query.modo === 'kills' ? 'kills' : 'mortes'

    const mapasQ = await db.query(
      `select m.map, count(*)::int as n
       from kill_positions kp join matches m on m.id = kp.match_id
       where (kp.victim = $1 or kp.killer = $1) and ${partidaVisivelExpr('m', '$2')}
       group by m.map order by n desc`,
      [steamId, req.player.steamId],
    )
    const mapas = mapasQ.rows.map((r) => ({ map: r.map, pontos: r.n }))
    const mapa = mapas.find((m) => m.map === req.query.map)?.map ?? mapas[0]?.map ?? null
    if (!mapa) return res.json({ map: null, calibrated: false, mapas: [], pontos: [] })

    const coluna = modo === 'kills' ? 'killer' : 'victim'
    const { rows } = await db.query(
      `select kp.${coluna}_x as x, kp.${coluna}_y as y
       from kill_positions kp join matches m on m.id = kp.match_id
       where kp.${coluna} = $1 and m.map = $2 and kp.${coluna}_x is not null and ${partidaVisivelExpr('m', '$3')}`,
      [steamId, mapa, req.player.steamId],
    )
    const calibrated = isMapaCalibrado(mapa)
    const pontos = calibrated
      ? rows.map((r) => worldToRadar(r.x, r.y, mapa)).filter(Boolean).map(([x, y]) => ({ x, y }))
      : []
    res.json({ map: mapa, calibrated, mapas, pontos })
  })

  // Perfil do Jogador: stats agregados, por mapa, partidas recentes e Sinergia.
  // Filtro opcional de período (?from/?to) em tudo menos a Sinergia (view pré-computada).
  router.get('/:steamId', requireAuth, async (req, res) => {
    const { steamId } = req.params
    const { from, to } = req.query
    const playerQ = await db.query(
      `select p.steam_id64, p.nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url,
              p.faceit_nick, p.faceit_elo, p.faceit_skill_level
       from players p
       left join steam_avatares sa on sa.steam_id64 = p.steam_id64
       where p.steam_id64 = $1`,
      [steamId],
    )
    let jogador = playerQ.rows[0]
    if (!jogador) {
      // Nunca fez onboarding (ex.: adversário visto só numa demo) — ainda tem perfil,
      // com nick vindo do último match_players dele e avatar do cache (steam_avatares
      // já cobre todo mundo visto em alguma demo, não só quem é visível ao viewer).
      const fallbackQ = await db.query(
        `select mp.nick, sa.avatar_url
         from match_players mp
         join matches m on m.id = mp.match_id
         left join steam_avatares sa on sa.steam_id64 = mp.steam_id64
         where mp.steam_id64 = $1 and ${partidaVisivelExpr('m', '$2')}
         order by m.played_at desc nulls last limit 1`,
        [steamId, req.player.steamId],
      )
      if (fallbackQ.rows.length === 0) return res.status(404).json({ erro: 'Jogador não encontrado' })
      jogador = { steam_id64: steamId, nick: fallbackQ.rows[0].nick, avatar_url: fallbackQ.rows[0].avatar_url }
    }

    // Só responde perfil de quem é visível ao viewer: o próprio viewer, um amigo `accepted`
    // (mesmo com 0 partidas registradas — evita 404 ao abrir o perfil de um amigo recém
    // adicionado que ainda não tem partida coletada), ou alguém que jogou em alguma partida
    // visível ao viewer (mesma regra de matches.js/friendships.js: participação-ou-amigo-de-
    // -participante). Sem esse gate, o bloco `jogador` (nick/avatar/FACEIT) e a existência de
    // jogadores fora da rede de amizade vazariam pra qualquer conta logada.
    if (!(await temPresenca(db, steamId, req.player.steamId))) {
      return res.status(404).json({ erro: 'Jogador não encontrado' })
    }

    const mapaParams = [steamId]
    const mapaPeriodo = periodoWhere(from, to, mapaParams)
    const mapaVisivel = visivelWhere(req.player.steamId, mapaParams)
    const recentesParams = [steamId]
    const recentesPeriodo = periodoWhere(from, to, recentesParams)
    const recentesVisivel = visivelWhere(req.player.steamId, recentesParams)
    const destaquesParams = [steamId]
    const destaquesPeriodo = periodoWhere(from, to, destaquesParams)
    const destaquesVisivel = visivelWhere(req.player.steamId, destaquesParams)
    const premierParams = [steamId]
    const premierVisivel = visivelWhere(req.player.steamId, premierParams)
    const clipesParams = [steamId]
    const clipesPeriodo = periodoWhere(from, to, clipesParams)
    const clipesVisivel = visivelWhere(req.player.steamId, clipesParams)

    const [stats, porMapa, recentes, sinergia, evolucao, statsGerais, sequencia, estilo, destaques, armas, economia, premierRow, clipes] = await Promise.all([
      statsAgregados(db, steamId, from, to, req.player.steamId),
      db.query(
        `select m.map, count(*)::int as partidas,
                coalesce(sum(case when mp.won then 1 else 0 end), 0)::int as vitorias,
                avg(mp.rating) as rating
         from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = $1${mapaPeriodo}${mapaVisivel} group by m.map order by partidas desc`,
        mapaParams,
      ),
      db.query(
        `select m.id, m.map, m.played_at, m.score_a, m.score_b, m.source,
                mp.kills, mp.deaths, mp.assists, mp.rating, mp.won,
                mp.damage, mp.rounds_played, mp.headshot_kills,
                mp.premier_rating_before, mp.premier_rating_after
         from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = $1 and m.status = 'parsed'${recentesPeriodo}${recentesVisivel}
         order by m.played_at desc nulls last limit 20`,
        recentesParams,
      ),
      // Sinergia recomputada de match_players (join em partidas visíveis ao viewer) em vez de
      // ler a view synergy_pairs, que é GLOBAL (agrega todo mundo). Sem isso, o perfil vazava
      // o grafo social (com quem cada jogador joga) de fora da rede de amizade do viewer.
      db.query(
        `select p.steam_id64, p.nick, coalesce(p.avatar_url, sa.avatar_url) as avatar_url,
                count(*)::int as partidas,
                count(*) filter (where mp1.won)::int as vitorias
         from match_players mp1
         join matches m on m.id = mp1.match_id and ${partidaVisivelExpr('m', '$2')}
         join match_players mp2 on mp2.match_id = mp1.match_id and mp2.team = mp1.team
           and mp2.steam_id64 <> mp1.steam_id64
         join players p on p.steam_id64 = mp2.steam_id64
         left join steam_avatares sa on sa.steam_id64 = mp2.steam_id64
         where mp1.steam_id64 = $1
         group by p.steam_id64, p.nick, p.avatar_url, sa.avatar_url
         order by partidas desc`,
        [steamId, req.player.steamId],
      ),
      evolucaoRating(db, steamId, from, to, req.player.steamId),
      // Badges são conquista de carreira — sempre no histórico INTEIRO visível, não no período filtrado.
      statsAgregados(db, steamId, undefined, undefined, req.player.steamId),
      melhorSequencia(db, steamId, req.player.steamId),
      estiloDoJogador(db, steamId, from, to, req.player.steamId),
      // "Em qual partida foi esse clutch/ace mesmo?" — lista de Highlights com link pra Partida.
      db.query(
        `select h.id, h.match_id, h.round_number, h.kind, h.description, m.map, m.played_at
         from highlights h join matches m on m.id = h.match_id
         where h.steam_id64 = $1${destaquesPeriodo}${destaquesVisivel}
         order by m.played_at desc nulls last limit 100`,
        destaquesParams,
      ),
      armasDoJogador(db, steamId, from, to, req.player.steamId),
      economiaDoJogador(db, steamId, from, to, req.player.steamId),
      db.query(
        `select mp.premier_rating_after
         from match_players mp join matches m on m.id = mp.match_id
         where mp.steam_id64 = $1 and m.status = 'parsed' and mp.premier_rating_after is not null${premierVisivel}
         order by m.played_at desc nulls last limit 1`,
        premierParams,
      ),
      // Prévia dos melhores clipes do jogador pro perfil — mesmo shape da aba Clipes
      // (clipes.js), MESMA regra de visibilidade por amizade (clipe de partida que o
      // viewer não pode ver não vaza) e mesmo cuidado com kind: subquery em highlights,
      // nunca join inner (excluiria clipes do fluxo por-jogador, migração 0042).
      db.query(
        `select ac.id, ac.clip_url, ac.clip_snapshot_url, ac.pontuacao_total, ac.pontuacao_detalhe,
                ac.round_number, ac.match_id,
                (select h.kind from highlights h
                 where h.match_id = ac.match_id and h.steam_id64 = ac.steam_id64 and h.round_number = ac.round_number
                 limit 1) as kind,
                m.map, m.played_at
         from allstar_clips ac
         join matches m on m.id = ac.match_id
         where ac.steam_id64 = $1 and ac.status = 'Processed'${clipesPeriodo}${clipesVisivel}
         order by ac.pontuacao_total desc nulls last
         limit 6`,
        clipesParams,
      ),
    ])

    const badges = calcularBadges({
      aces: statsGerais.aces,
      clutchWins: statsGerais.clutchWins,
      melhorSequencia: sequencia,
      accuracy: statsGerais.accuracy,
      entryKills: statsGerais.entryKills,
      partidas: statsGerais.partidas,
    })

    res.json({
      jogador: {
        steamId: jogador.steam_id64, nick: jogador.nick, avatarUrl: jogador.avatar_url,
        faceitNick: jogador.faceit_nick ?? null,
        faceitElo: jogador.faceit_elo ?? null,
        faceitSkillLevel: jogador.faceit_skill_level ?? null,
      },
      premierAtual: premierRow.rows[0]?.premier_rating_after != null ? Number(premierRow.rows[0].premier_rating_after) : null,
      stats,
      evolucao,
      badges,
      estilo,
      armas,
      economia,
      destaques: destaques.rows.map((d) => ({
        id: d.id,
        matchId: d.match_id,
        roundNumber: d.round_number,
        kind: d.kind,
        description: d.description,
        map: d.map,
        playedAt: d.played_at,
      })),
      clipes: clipes.rows.map((c) => ({
        id: c.id, matchId: c.match_id, steamId,
        nick: jogador.nick, avatarUrl: jogador.avatar_url,
        clipUrl: c.clip_url, clipSnapshotUrl: c.clip_snapshot_url,
        kind: c.kind, roundNumber: c.round_number, map: c.map, playedAt: c.played_at,
        pontuacao: c.pontuacao_detalhe ?? { total: c.pontuacao_total ?? 0 },
      })),
      porMapa: porMapa.rows.map((r) => ({
        map: r.map,
        partidas: r.partidas,
        vitorias: r.vitorias,
        winrate: pct(r.vitorias, r.partidas),
        rating: r.rating === null ? null : Math.round(Number(r.rating) * 100) / 100,
      })),
      recentes: recentes.rows.map((r) => ({
        id: r.id,
        map: r.map,
        playedAt: r.played_at,
        scoreA: r.score_a,
        scoreB: r.score_b,
        kills: r.kills,
        deaths: r.deaths,
        assists: r.assists ?? 0,
        rating: r.rating === null ? null : Number(r.rating),
        won: r.won,
        adr: r.rounds_played ? Math.round((r.damage / r.rounds_played) * 10) / 10 : 0,
        hsPct: r.kills ? Math.round((r.headshot_kills / r.kills) * 100) : 0,
        premierBefore: r.premier_rating_before == null ? null : Number(r.premier_rating_before),
        premierAfter: r.premier_rating_after == null ? null : Number(r.premier_rating_after),
        source: r.source,
      })),
      sinergia: sinergia.rows.map((s) => ({
        steamId: s.steam_id64,
        nick: s.nick,
        avatarUrl: s.avatar_url,
        partidas: s.partidas,
        vitorias: s.vitorias,
        winrate: pct(s.vitorias, s.partidas),
      })),
    })
  })

  return router
}
