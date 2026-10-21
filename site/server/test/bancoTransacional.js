import { vi } from 'vitest'

// Simula o bloqueio por chave entre conexões, mantendo a lógica das rotas real.
export function bancoTransacional(query) {
  const travas = new Map()
  const clientes = []
  const db = { query, connect: vi.fn(async () => {
    const liberar = []
    const client = {
      emTransacao: false,
      release: vi.fn(),
      query: vi.fn(async (sql, params = []) => {
        if (sql === 'begin') { client.emTransacao = true; return { rows: [] } }
        if (sql === 'commit' || sql === 'rollback') {
          client.emTransacao = false
          liberar.splice(0).forEach((fn) => fn())
          return { rows: [] }
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          const chave = JSON.stringify(params)
          const anterior = travas.get(chave) ?? Promise.resolve()
          let soltar
          const atual = new Promise((resolve) => { soltar = resolve })
          travas.set(chave, atual)
          await anterior
          liberar.push(soltar)
          return { rows: [] }
        }
        return query(sql, params)
      }),
    }
    clientes.push(client)
    return client
  }) }
  return { db, clientes }
}
