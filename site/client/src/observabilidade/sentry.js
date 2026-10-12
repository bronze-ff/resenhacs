import { minimizarBreadcrumb, minimizarEvento, minimizarSpan } from './scrub.js'

// Acesso estático: o Vite só embute o valor quando a propriedade é literal.
const dsn = import.meta.env.VITE_SENTRY_DSN
const ambienteExplicito = import.meta.env.VITE_SENTRY_ENVIRONMENT
const release = import.meta.env.VITE_SENTRY_RELEASE

let cliente = null

export function ambienteSentry() {
  if (ambienteExplicito) return ambienteExplicito
  return import.meta.env.PROD ? 'producao' : 'dev'
}

export async function iniciarSentry() {
  if (!dsn || cliente) return
  const Sentry = await import('@sentry/react')
  Sentry.init({
    dsn,
    environment: ambienteSentry(),
    release: release || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
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
  cliente = Sentry
}

export function capturarErro(erro) {
  if (!dsn || !cliente) return
  cliente.captureException(erro)
}
