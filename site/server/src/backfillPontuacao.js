// site/server/src/backfillPontuacao.js
// Rodado UMA VEZ pelo controller direto em produção depois da migração 0047 — clipes
// gerados antes da fórmula por componente (Task 2) ficariam com pontuacao_total null
// pra sempre, senão. Não é um cron, não roda sozinho. Ver
// docs/superpowers/specs/2026-07-22-competicoes-clipes-design.md.
import { calcularPontuacao } from './clipesScore.js'

export async function backfillPontuacao(db) {
  // allstar_clips não guarda match_id/steam_id64/round_number direto (só
  // highlight_id) — junta com highlights, mesmo padrão usado no webhook
  // (routes/allstar.js) e na rota de clipes (routes/clipes.js).
  const { rows: pendentes } = await db.query(
    `select ac.id, h.match_id, h.steam_id64, h.round_number
     from allstar_clips ac
     join highlights h on h.id = ac.highlight_id
     where ac.status = 'Processed' and ac.pontuacao_total is null`,
  )
  let atualizados = 0
  let falhas = 0
  for (const clipe of pendentes) {
    try {
      const { rows: kills } = await db.query(
        'select weapon, headshot from kill_positions where match_id = $1 and round_number = $2 and killer = $3',
        [clipe.match_id, clipe.round_number, clipe.steam_id64],
      )
      const { rows: highlightRows } = await db.query(
        "select kind from highlights where match_id = $1 and steam_id64 = $2 and round_number = $3 and kind like 'clutch_%' limit 1",
        [clipe.match_id, clipe.steam_id64, clipe.round_number],
      )
      const clutchKind = highlightRows[0]?.kind ? highlightRows[0].kind.replace('clutch_', '') : null
      const armasDistintas = new Set(kills.map((k) => k.weapon)).size
      const headshots = kills.filter((k) => k.headshot).length
      const resultado = calcularPontuacao({ kills: kills.length, headshots, clutchKind, armasDistintas })
      await db.query(
        'update allstar_clips set pontuacao_total = $1, pontuacao_detalhe = $2 where id = $3',
        [resultado.total, JSON.stringify(resultado), clipe.id],
      )
      atualizados += 1
    } catch {
      falhas += 1
    }
  }
  return { atualizados, falhas }
}
