export function loadConfig(env = process.env) {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'STEAM_API_KEY']
  const missing = required.filter((k) => !env[k])
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente faltando: ${missing.join(', ')}`)
  }
  return {
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
    steamApiKey: env.STEAM_API_KEY,
    appUrl: env.APP_URL ?? 'http://localhost:5173',
    port: Number(env.PORT ?? 3001),
    isProduction: env.NODE_ENV === 'production',
  }
}
