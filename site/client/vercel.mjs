// Config da Vercel avaliada no build (VERCEL_ENV e PREVIEW_API_URL daquele deployment).
// Rewrite externo de /api/* no CDN: o projeto resenha não invoca função. O middleware
// antigo (site/client/middleware.js) contava uma invocação a mais em toda chamada.
//
// O browser continua falando só com a origem do site. Cookie de sessão fica first-party
// (SameSite=Lax). Chamar resenhacs.vercel.app direto seria cookie de terceiro: vercel.app
// está na lista de sufixos públicos, e Safari/iOS bloqueia.

export const PRODUCTION_API_URL = 'https://resenhacs.vercel.app'

export const MENSAGEM_API_INDISPONIVEL =
  'API indisponivel neste ambiente de preview. Configure PREVIEW_API_URL nas ' +
  'Environment Variables do projeto na Vercel (escopo Preview/Development) ' +
  'com a origem https do backend de staging.'

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://eu-assets.i.posthog.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  'img-src \'self\' data: blob: https:',
  "media-src 'self' blob: https:",
  "connect-src 'self' https://eu.i.posthog.com https://eu-assets.i.posthog.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
  'frame-src https://www.youtube-nocookie.com https://allstar.gg https://*.allstar.gg',
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const SEGURANCA = [
  ['X-Frame-Options', 'DENY'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'same-origin'],
  ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload'],
  ['Content-Security-Policy-Report-Only', CSP],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'],
]

// Resposta de /api carrega cookie de sessão. Sem isto o CDN pode guardar o corpo
// (rewrite externo passou a poder cachear) e entregar Set-Cookie de um Jogador a outro.
const SEM_CACHE = [
  ['Cache-Control', 'private, no-store'],
  ['CDN-Cache-Control', 'no-store'],
  ['Vercel-CDN-Cache-Control', 'no-store'],
]

function lista(pares) {
  return pares.map(([key, value]) => ({ key, value }))
}

function objeto(pares) {
  return Object.fromEntries(pares)
}

// Só https, sem usuário/senha na URL. Caminho, query e barra final não entram:
// o rewrite sempre prefixa /api no destino (o mesmo efeito do URL absoluto antigo).
export function origemPreview(valor) {
  if (typeof valor !== 'string') return null
  const texto = valor.trim()
  if (!texto) return null
  let url
  try {
    url = new URL(texto)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  return url.origin
}

export function resolveApiOrigin(env = {}) {
  if (env.VERCEL_ENV === 'production') return PRODUCTION_API_URL
  return origemPreview(env.PREVIEW_API_URL)
}

function configComApi(origin) {
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    rewrites: [
      { source: '/api', destination: `${origin}/api` },
      { source: '/api/(.*)', destination: `${origin}/api/$1` },
      { source: '/(.*)', destination: '/index.html' },
    ],
    headers: [
      { source: '/api', headers: lista(SEM_CACHE) },
      { source: '/api/(.*)', headers: lista(SEM_CACHE) },
      { source: '/(.*)', headers: lista(SEGURANCA) },
    ],
  }
}

// Preview/Development sem staging não pode cair no banco de produção. 503 estático,
// sem função. `routes` (e não rewrites) porque o formato novo não tem status.
function configSemApi() {
  const cabecalhos = objeto([...SEGURANCA, ...SEM_CACHE, ['Content-Type', 'text/plain; charset=utf-8']])
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    routes: [
      { src: '^/.*', headers: objeto(SEGURANCA), continue: true },
      { handle: 'filesystem' },
      {
        src: '^/api(?:/.*)?$',
        status: 503,
        dest: '/api-indisponivel.txt',
        headers: cabecalhos,
      },
      { src: '^/(.*)', dest: '/index.html', headers: objeto(SEGURANCA) },
    ],
  }
}

export function buildClientConfig(env = {}) {
  const origin = resolveApiOrigin(env)
  if (!origin) return configSemApi()
  return configComApi(origin)
}

export const config = buildClientConfig(process.env)
