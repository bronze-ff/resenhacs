import posthog from 'posthog-js'

// Acesso estático. Sem a chave, o módulo não inicializa (dev e teste seguem no-op).
const chave = import.meta.env.VITE_POSTHOG_KEY
const host = import.meta.env.VITE_POSTHOG_HOST

let iniciado = false

function limparPropriedades(evento) {
  if (!evento || typeof evento !== 'object') return evento
  const props = evento.properties
  if (props && typeof props === 'object') {
    delete props.$ip
    delete props.$set
    delete props.$set_once
    delete props.email
    delete props.nick
    delete props.avatarUrl
    delete props.faceitNick
  }
  return evento
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
    before_send: limparPropriedades,
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
