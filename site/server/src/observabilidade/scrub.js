// Minimização por allowlist compartilhada com site/client/src/observabilidade/scrub.js
// e coletor/src/coletor/observabilidade.py. Mantenha os três alinhados.
//
// Allowlist: request só com method + URL (origem + caminho); user só com id.
// Headers, cookies, body e query saem inteiros — não são mascarados campo a campo.
// Palavra sensível ou PII na string restante redige a string inteira.
// Campos de transporte do SDK (event_id, sdk, span_id, …) não são percorridos.

export const REDACTED = '[Redacted]'

const TRANSPORTE = new Set([
  'event_id',
  'timestamp',
  'start_timestamp',
  'platform',
  'sdk',
  'level',
  'logger',
  'span_id',
  'parent_span_id',
  'trace_id',
  'op',
  'origin',
  'dist',
  'environment',
  'release',
  'server_name',
  'debug_meta',
  'measurements',
  'profile',
  'type',
  'category',
])

const DESCARTAR = /^(headers|cookies|cookie|set-cookie|query_string|query|body|request_body|response_body|env|authorization)$/i

// `(?<!re)` evita que "resenha" (marca do produto) dispare "senha".
// "token" segue sem fronteira de palavra para pegar access_token.
const PALAVRA = /(?<!re)senha|token|authorization|cookie/i

const PII = [
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  /\b\d{11}\b/,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
  /\b\d{14}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  // Fixo (8 dígitos) e celular (9). +55 opcional; DDD com ou sem parênteses;
  // separador pode ser espaço, ponto, hífen, barra ou nada.
  /(?<!\d)\+?(?:55[\s./-]*)?\(?\d{2}\)?[\s./-]*9?[\s./-]*\d{4}[\s./-]*\d{4}(?!\d)/,
  /\b[A-Z]{3}-?\d{4}\b/i,
  /\b[A-Z]{3}\d[A-Z]\d{2}\b/i,
]

const URL_RE = /https?:\/\/[^\s<>"']+/gi

export function soOrigemCaminho(valor) {
  if (typeof valor !== 'string' || valor === '') return valor
  if (valor.startsWith('/') && !valor.startsWith('//')) {
    const corte = valor.search(/[?#]/)
    return corte === -1 ? valor : valor.slice(0, corte)
  }
  try {
    const u = new URL(valor)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return valor
    return `${u.origin}${u.pathname}`
  } catch {
    return valor
  }
}

function cortarUrl(url) {
  const limpa = url.replace(/[),.;]+$/, '')
  return soOrigemCaminho(limpa) + url.slice(limpa.length)
}

export function redigirString(valor) {
  if (typeof valor !== 'string') return valor
  URL_RE.lastIndex = 0
  let texto = valor.replace(URL_RE, cortarUrl)
  // Caminho relativo: a string inteira ou depois de espaço/aspas. // fica de fora.
  texto = texto.replace(/(^|[\s"'`(])(\/(?!\/)[^\s"'`<>)]*)/g, (trecho, pre, path) => pre + cortarUrl(path))
  if (PALAVRA.test(texto) || PII.some((re) => re.test(texto))) return REDACTED
  return texto
}

function chaveSensivel(chave) {
  return typeof chave === 'string' && PALAVRA.test(chave)
}

export function scrubValor(valor, chave) {
  if (typeof chave === 'string' && TRANSPORTE.has(chave)) return valor
  if (chaveSensivel(chave)) return REDACTED
  if (typeof valor === 'string') return redigirString(valor)
  if (Array.isArray(valor)) return valor.map((item) => scrubValor(item))
  if (valor && typeof valor === 'object') {
    const saida = {}
    for (const [k, v] of Object.entries(valor)) {
      if (TRANSPORTE.has(k)) {
        saida[k] = v
        continue
      }
      if (DESCARTAR.test(k)) continue
      saida[k] = scrubValor(v, k)
    }
    return saida
  }
  return valor
}

export function minimizarEvento(evento) {
  if (!evento || typeof evento !== 'object') return evento
  const saida = scrubValor(evento)
  if (saida.request && typeof saida.request === 'object') {
    const method = typeof saida.request.method === 'string' ? saida.request.method : undefined
    const url = typeof saida.request.url === 'string' ? redigirString(saida.request.url) : undefined
    saida.request = {}
    if (method) saida.request.method = method
    if (url) saida.request.url = url
  }
  if (saida.user && typeof saida.user === 'object') {
    const id = saida.user.id
    saida.user = id != null && id !== '' ? { id: redigirString(String(id)) } : {}
  }
  return saida
}

function limparBloco(bloco) {
  if (!bloco || typeof bloco !== 'object') return
  for (const k of Object.keys(bloco)) {
    if (DESCARTAR.test(k) || /query|header|cookie|body|fragment/i.test(k) || PALAVRA.test(k)) {
      delete bloco[k]
    }
  }
}

export function minimizarSpan(span) {
  if (!span || typeof span !== 'object') return span
  const saida = scrubValor(span)
  limparBloco(saida.data)
  limparBloco(saida.attributes)
  return saida
}

export function minimizarBreadcrumb(breadcrumb) {
  if (!breadcrumb || typeof breadcrumb !== 'object') return breadcrumb
  if (breadcrumb.category === 'console') return null
  return minimizarEvento(breadcrumb)
}
