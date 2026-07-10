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
    // Upload manual de demo (roda o Coletor Python local via child_process). Só faz
    // sentido em dev/self-hosted — indefinido no ambiente serverless da Vercel, onde
    // a rota fica desligada (não há Python nem filesystem persistente na função).
    coletorDir: env.COLETOR_DIR ?? null,
    pythonBin: env.COLETOR_PYTHON ?? null,
  }
}
