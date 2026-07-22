// site/server/test/backfillPontuacao.test.js
import { describe, it, expect, vi } from 'vitest'
import { backfillPontuacao } from '../src/backfillPontuacao.js'

describe('backfillPontuacao', () => {
  it('calcula e grava pontuacao pra clipes Processed sem pontuacao_total ainda', async () => {
    const gravados = []
    const db = {
      query: vi.fn().mockImplementation((sql, params) => {
        // allstar_clips não guarda match_id/steam_id64/round_number direto (só
        // highlight_id) — a query real junta com highlights pra pegar esses campos.
        if (sql.includes('from allstar_clips ac') && sql.includes('join highlights h')) {
          return Promise.resolve({ rows: [
            { id: 'c1', match_id: 'm1', steam_id64: '765', round_number: 5 },
          ] })
        }
        if (sql.includes('from kill_positions')) {
          return Promise.resolve({ rows: [{ weapon: 'ak47', headshot: true }, { weapon: 'ak47', headshot: false }] })
        }
        if (sql.includes('from highlights')) return Promise.resolve({ rows: [] })
        if (sql.includes('update allstar_clips set pontuacao_total')) {
          gravados.push(params)
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      }),
    }
    const resultado = await backfillPontuacao(db)
    expect(resultado).toEqual({ atualizados: 1, falhas: 0 })
    expect(gravados).toHaveLength(1)
    expect(gravados[0][2]).toBe('c1') // id do clipe no where
  })

  it('sem clipes pendentes: devolve zero sem erro', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const resultado = await backfillPontuacao(db)
    expect(resultado).toEqual({ atualizados: 0, falhas: 0 })
  })

  it('erro num clipe nao derruba os outros', async () => {
    const db = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (sql.includes('from allstar_clips ac') && sql.includes('join highlights h')) {
          return Promise.resolve({ rows: [
            { id: 'c1', match_id: 'm1', steam_id64: '765', round_number: 5 },
            { id: 'c2', match_id: 'm2', steam_id64: '999', round_number: 3 },
          ] })
        }
        if (sql.includes('from kill_positions')) {
          // O id do clipe vai como PARAMETRO bound (killer = $3), nunca no texto da
          // SQL — inspecionar params (não sql.includes) é o jeito certo de simular
          // uma falha isolada num clipe específico (aqui, o de steam_id64 '765').
          if (params[2] === '765') throw new Error('falha simulada pro clipe c1')
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      }),
    }
    const resultado = await backfillPontuacao(db)
    // c1 falha (exceção em kill_positions), c2 processa normalmente — confirma que o
    // try/catch por-clipe isola a falha em vez de derrubar o loop inteiro.
    expect(resultado).toEqual({ atualizados: 1, falhas: 1 })
  })
})
