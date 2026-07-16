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
    // R2 (Cloudflare) — o bucket é PRIVADO de propósito (replays/demos têm dados
    // reais dos 10 participantes de cada Partida, incluindo randoms não whitelistados
    // que nunca consentiram ficar públicos). O server faz proxy autenticado; nunca
    // expor a URL bruta do R2 pro client.
    r2AccountId: env.R2_ACCOUNT_ID ?? null,
    r2AccessKeyId: env.R2_ACCESS_KEY_ID ?? null,
    r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY ?? null,
    r2Bucket: env.R2_BUCKET ?? null,
    // OAuth de vínculo FACEIT (Fase A) — client id é público, mas fica em env var pra
    // poder trocar sem novo deploy. Sem ele, a rota de vínculo devolve 503 (mesmo padrão
    // do upload manual quando falta config de Coletor).
    faceitClientId: env.FACEIT_CLIENT_ID ?? null,
    // Alguns apps FACEIT criados como "Authorization Code with PKCE" ainda exigem
    // Basic Auth (client_id:client_secret) no POST do token endpoint, mesmo com PKCE —
    // opcional aqui: se não vier, a troca de token segue só com code_verifier.
    faceitClientSecret: env.FACEIT_CLIENT_SECRET ?? null,
  }
}
