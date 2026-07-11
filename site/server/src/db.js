import pg from 'pg'

// max: 1 é o padrão certo pra serverless (Vercel), NÃO um pool "normal" de servidor
// long-lived — cada invocação de função pode virar uma instância própria, e o Supabase
// já faz pooling por cima (pooler.supabase.com). Com max: 5 aqui, bastavam ~3 instâncias
// concorrentes pra estourar o limite de 15 conexões do pooler em modo "session" (visto
// em produção: EMAXCONNSESSION). Isso ajuda mas não resolve sozinho — a causa raiz é
// usar a porta 5432 (session mode) em vez de 6543 (transaction mode, feito pra
// serverless); troca de DATABASE_URL fica pendente, é uma env var da Vercel.
export function createDb(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 1 })
  return {
    query: (text, params) => pool.query(text, params),
    close: () => pool.end(),
  }
}
