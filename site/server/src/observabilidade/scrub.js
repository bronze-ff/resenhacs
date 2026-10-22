// Minimização por allowlist. Este arquivo é igual em
// site/client/src/observabilidade/scrub.js e aqui: cada deploy da Vercel
// só enxerga o próprio Root Directory. O teste compara os dois.
// O Coletor espelha em coletor/src/coletor/observabilidade.py.
//
// No topo do evento só entram as chaves de CHAVES_EVENTO. Cada valor passa pelo
// scrub recursivo. logger, profile, debug_meta e o resto são descartados.
// contexts fica só com trace. request só com method + URL (origem + caminho);
// user só com id. Headers, cookies, body e query saem inteiros.
// Palavra sensível (palavras.js) ou PII na string restante redige a string inteira.

import { PALAVRA, chaveSensivel } from './palavras.js'

export { chaveSensivel }
export const REDACTED = '[Redacted]'

const CHAVES_EVENTO = [
  'event_id',
  'timestamp',
  'start_timestamp',
  'level',
  'platform',
  'release',
  'environment',
  'exception',
  'message',
  'logentry',
  'breadcrumbs',
  'tags',
  'contexts',
  'sdk',
  'request',
  'user',
  'transaction',
  'type',
  'fingerprint',
]

const DESCARTAR = /^(headers|cookies|cookie|set-cookie|query_string|query|body|request_body|response_body|env|authorization)$/i

const PII = [
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  /\b\d{11}\b/,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
  /\b\d{14}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  // 8 a 13 dígitos, com espaço, ponto, hífen, parênteses ou +. Cobre fixo, celular e
  // 0800/0300/0500/0900. A data ISO YYYY-MM-DD fica de fora. SteamID (17) não cabe
  // no teto e placar curto não chega em 8 dígitos. (?<!\d)/(?!\d) barram dígito colado.
  /(?<!\d)(?!\d{4}-\d{2}-\d{2}(?!\d))\+?(?:\d[\s.()\-+]*){7,12}\d(?!\d)/,
  /\b[A-Z]{3}-?\d{4}\b/i,
  /\b[A-Z]{3}\d[A-Z]\d{2}\b/i,
]

const URL_RE = /https?:\/\/[^\s<>"']+/gi
// Preservar BOM mantém os limites de palavra iguais aos do unquote do Python.
const DECODIFICADOR_UTF8 = new TextDecoder('utf-8', { ignoreBOM: true })

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

function redigirCamada(valor) {
  URL_RE.lastIndex = 0
  let texto = valor.replace(URL_RE, cortarUrl)
  // Caminho relativo: a string inteira ou depois de espaço/aspas. // fica de fora.
  texto = texto.replace(/(^|[\s"'`(])(\/(?!\/)[^\s"'`<>)]*)/g, (trecho, pre, path) => pre + cortarUrl(path))
  if (PALAVRA.test(texto) || PII.some((re) => re.test(texto))) return REDACTED
  return texto
}

export function redigirString(valor) {
  if (typeof valor !== 'string') return valor
  let camada = valor
  let saida = valor
  for (let decodificacoes = 0; ; decodificacoes++) {
    const sanitizado = redigirCamada(camada)
    if (sanitizado === REDACTED) return REDACTED
    if (sanitizado !== camada) saida = sanitizado
    const decodificado = camada.replace(/(?:%[0-9A-Fa-f]{2})+/g, (trecho) =>
      DECODIFICADOR_UTF8.decode(Uint8Array.from(trecho.slice(1).split('%'), (byte) => Number.parseInt(byte, 16))))
    if (decodificado === camada) return saida
    // Mais de três camadas falham fechado, mesmo sem um padrão sensível aparente.
    if (decodificacoes === 3) return REDACTED
    camada = decodificado
  }
}

export function scrubValor(valor, chave) {
  if (chaveSensivel(chave)) return REDACTED
  if (typeof valor === 'string') return redigirString(valor)
  if (Array.isArray(valor)) return valor.map((item) => scrubValor(item))
  if (valor && typeof valor === 'object') {
    const saida = {}
    for (const [k, v] of Object.entries(valor)) {
      if (DESCARTAR.test(k)) continue
      saida[k] = scrubValor(v, k)
    }
    return saida
  }
  return valor
}

function contextsMinimos(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return undefined
  const trace = valor.trace
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) return {}
  return { trace: scrubValor(trace) }
}

function minimizarBreadcrumbs(valor) {
  if (Array.isArray(valor)) {
    return valor.map((item) => minimizarBreadcrumb(item)).filter((item) => item != null)
  }
  if (!valor || typeof valor !== 'object') return undefined
  const saida = {}
  for (const [k, v] of Object.entries(valor)) {
    if (k === 'values' && Array.isArray(v)) {
      saida.values = v.map((item) => minimizarBreadcrumb(item)).filter((item) => item != null)
      continue
    }
    if (DESCARTAR.test(k)) continue
    saida[k] = scrubValor(v, k)
  }
  return saida
}

export function minimizarEvento(evento) {
  if (!evento || typeof evento !== 'object') return evento
  const saida = {}
  for (const chave of CHAVES_EVENTO) {
    if (!Object.hasOwn(evento, chave)) continue
    if (chave === 'breadcrumbs') {
      const migalhas = minimizarBreadcrumbs(evento.breadcrumbs)
      if (migalhas) saida.breadcrumbs = migalhas
      continue
    }
    if (chave === 'contexts') {
      const contexts = contextsMinimos(evento.contexts)
      if (contexts) saida.contexts = contexts
      continue
    }
    saida[chave] = scrubValor(evento[chave])
  }
  if (saida.request && typeof saida.request === 'object') {
    const method = typeof saida.request.method === 'string' ? saida.request.method : undefined
    const url = typeof saida.request.url === 'string' ? saida.request.url : undefined
    saida.request = {}
    if (method) saida.request.method = method
    if (url) saida.request.url = url
  }
  if (saida.user && typeof saida.user === 'object') {
    const id = saida.user.id
    saida.user = id != null && id !== '' ? { id: typeof id === 'string' ? id : redigirString(String(id)) } : {}
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
  return scrubValor(breadcrumb)
}
