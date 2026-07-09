import pg from 'pg'

export function createDb(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 5 })
  return {
    query: (text, params) => pool.query(text, params),
    close: () => pool.end(),
  }
}
