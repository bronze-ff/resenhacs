import posthog from 'posthog-js'
import { soOrigemCaminho } from './scrub.js'

// Acesso estático. Sem a chave, o módulo não inicializa (dev e teste seguem no-op).
const chave = import.meta.env.VITE_POSTHOG_KEY
const host = import.meta.env.VITE_POSTHOG_HOST

let iniciado = false

// Identificadores do evento. Não são URL e não são reescritos, mesmo com ? ou #.
const TRANSPORTE = new Set([
  'uuid',
  'event',
  'timestamp',
  'distinct_id',
  'token',
  '$session_id',
  '$window_id',
  '$insert_id',
  '$device_id',
  '$lib',
  '$lib_version',
  '$sent_at',
  'ip',
  'event_id',
  'sdk',
  'span_id',
  'parent_span_id',
  'trace_id',
])

const APAGAR = new Set(['$ip', '$set', '$set_once', 'email', 'nick', 'avatarUrl', 'faceitNick'])

function chaveDeUrl(chave) {
  return (
    /^\$initial_/i.test(chave) ||
    /^\$prev_pageview_/i.test(chave) ||
    /(?:^|\$|_)(current_url|pathname|referrer|referring_domain|href|url)$/i.test(chave)
  )
}

function pareceUrl(valor) {
  return /^https?:\/\//i.test(valor) || (valor.startsWith('/') && !valor.startsWith('//'))
}

function semQuery(valor) {
  const pelaUrl = soOrigemCaminho(valor)
  if (pelaUrl !== valor) return pelaUrl
  const corte = valor.search(/[?#]/)
  return corte === -1 ? valor : valor.slice(0, corte)
}

function limparValor(valor, chave) {
  if (typeof chave === 'string' && TRANSPORTE.has(chave)) return valor
  if (typeof valor === 'string') {
    if ((typeof chave === 'string' && chaveDeUrl(chave)) || pareceUrl(valor)) return semQuery(valor)
    return valor
  }
  if (Array.isArray(valor)) return valor.map((item) => limparValor(item))
  if (valor && typeof valor === 'object') {
    const saida = {}
    for (const [k, v] of Object.entries(valor)) {
      if (TRANSPORTE.has(k)) {
        saida[k] = v
        continue
      }
      if (APAGAR.has(k)) continue
      saida[k] = limparValor(v, k)
    }
    return saida
  }
  return valor
}

export function limparEventoPosthog(evento) {
  if (!evento || typeof evento !== 'object') return evento
  return limparValor(evento)
}

export function iniciarPosthog() {
  if (!chave || iniciado) return
  posthog.init(chave, {
    api_host: host || 'https://eu.i.posthog.com',
    person_profiles: 'identified_only',
    persistence: 'memory',
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    disable_session_recording: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    respect_dnt: true,
    before_send: limparEventoPosthog,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '*',
    },
  })
  iniciado = true
}

export function identificarJogador(steamId) {
  if (!chave || steamId == null || steamId === '') return
  iniciarPosthog()
  posthog.identify(String(steamId))
}

export function esquecerJogador() {
  if (!chave || !iniciado) return
  posthog.reset()
}
