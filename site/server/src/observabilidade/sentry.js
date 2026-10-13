import { minimizarBreadcrumb, minimizarEvento, minimizarSpan } from './scrub.js'

const dsn = process.env.SENTRY_DSN

function ambiente() {
  if (process.env.SENTRY_ENVIRONMENT) return process.env.SENTRY_ENVIRONMENT
  if (process.env.VERCEL_ENV === 'production') return 'producao'
  if (process.env.VERCEL_ENV === 'preview') return 'homologacao'
  return 'dev'
}

let capturar = () => {}

if (dsn) {
  const Sentry = await import('@sentry/node')
  Sentry.init({
    dsn,
    environment: ambiente(),
    release: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    sampleRate: 1,
    includeLocalVariables: false,
    integrations(integracoes) {
      const resto = integracoes.filter((i) => i.name !== 'Console' && i.name !== 'Http' && i.name !== 'RequestData')
      return [...resto, Sentry.httpIntegration({ maxRequestBodySize: 'none', spans: false })]
    },
    beforeSend(evento) {
      return minimizarEvento(evento)
    },
    beforeBreadcrumb(breadcrumb) {
      return minimizarBreadcrumb(breadcrumb)
    },
    beforeSendSpan(span) {
      return minimizarSpan(span)
    },
  })
  capturar = (erro) => Sentry.captureException(erro)
}

export function capturarErro(erro) {
  capturar(erro)
}
