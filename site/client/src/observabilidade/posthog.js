import posthog from 'posthog-js'
import { REDACTED, redigirString } from './scrub.js'

// Acesso estático. Sem a chave, o módulo não inicializa (dev e teste seguem no-op).
const chave = import.meta.env.VITE_POSTHOG_KEY
const host = import.meta.env.VITE_POSTHOG_HOST

let iniciado = false

// Só no topo do evento. `token` não entra aqui: só a chave do projeto fica intacta.
const TRANSPORTE_TOPO = new Set([
  'distinct_id',
  '$session_id',
  '$window_id',
  '$device_id',
  '$insert_id',
  '$time',
  '$lib',
  '$lib_version',
  'uuid',
])

function tokenDoProjeto(valor) {
  const configurada = import.meta.env.VITE_POSTHOG_KEY
  return typeof configurada === 'string' && configurada !== '' && valor === configurada
}

function isentoNoTopo(nome, valor) {
  if (nome === 'token') return tokenDoProjeto(valor)
  return TRANSPORTE_TOPO.has(nome)
}

// Mesma palavra do scrub. Chave aninhada com esse nome redige o valor inteiro.
const PALAVRA = /(?<!re)senha|token|authorization|cookie/i

const APAGAR = new Set(['$ip', '$set', '$set_once', 'email', 'nick', 'avatarUrl', 'faceitNick'])

// Click id como o PostHog grava ($fbclid) e como a query chega (fbclid).
const CLICK_ID = new Set(['$gclid', 'gclid', '$fbclid', 'fbclid', '$msclkid', 'msclkid'])
const REFERER_ATRIBUICAO = new Set(['$initial_referrer', '$initial_referring_domain', '$referring_domain'])

function chaveDeAtribuicao(chave) {
  return (
    chave.startsWith('$utm_') ||
    chave.startsWith('utm_') ||
    chave.startsWith('$initial_utm_') ||
    chave.startsWith('$session_entry_') ||
    CLICK_ID.has(chave) ||
    REFERER_ATRIBUICAO.has(chave)
  )
}

function limparValor(valor, chave, noTopo) {
  if (noTopo && typeof chave === 'string' && isentoNoTopo(chave, valor)) return valor
  if (typeof chave === 'string' && PALAVRA.test(chave)) return REDACTED
  if (typeof valor === 'string') return redigirString(valor)
  if (Array.isArray(valor)) return valor.map((item) => limparValor(item, undefined, false))
  if (valor && typeof valor === 'object') {
    const saida = {}
    for (const [k, v] of Object.entries(valor)) {
      if (noTopo && isentoNoTopo(k, v)) {
        saida[k] = v
        continue
      }
      if (APAGAR.has(k) || chaveDeAtribuicao(k)) continue
      saida[k] = limparValor(v, k, false)
    }
    return saida
  }
  return valor
}

export function limparEventoPosthog(evento) {
  if (!evento || typeof evento !== 'object') return evento
  return limparValor(evento, undefined, true)
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
