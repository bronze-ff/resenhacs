import posthog from 'posthog-js'
import { REDACTED, chaveSensivel, redigirString } from './scrub.js'

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

// URL de página carrega identificador de TERCEIRO (/jogador/<SteamID64 de outra pessoa>,
// /partida/<uuid>). O pageview só precisa saber QUE página foi — o id vira placeholder.
const STEAM_ID = /\b7656119\d{10}\b/g
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

// Só campos de URL/caminho: o distinct_id (SteamID do próprio usuário, via identify)
// precisa continuar intacto.
const CAMPO_DE_URL = /url|pathname|referrer|href/i

export function anonimizarIds(texto) {
  return texto.replace(STEAM_ID, ':steamid').replace(UUID, ':id')
}

function objetoPlano(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false
  const proto = Object.getPrototypeOf(valor)
  return proto === Object.prototype || proto === null
}

function limparValor(valor, chave, noTopo) {
  // O SDK grava a project key em properties.token. Sem ela a ingestão rejeita.
  // Só esse valor exato fica; qualquer outro `token` continua redigido.
  if (chave === 'token' && tokenDoProjeto(valor)) return valor
  if (noTopo && typeof chave === 'string' && isentoNoTopo(chave, valor)) return valor
  if (chaveSensivel(chave)) return REDACTED
  if (typeof valor === 'string') {
    const ehUrl = typeof chave === 'string' && CAMPO_DE_URL.test(chave)
    return redigirString(ehUrl ? anonimizarIds(valor) : valor)
  }
  if (Array.isArray(valor)) return valor.map((item) => limparValor(item, undefined, false))
  // Date e outras instâncias não são objeto plano. Object.entries(date) é [] e viraria {}.
  if (valor && typeof valor === 'object' && objetoPlano(valor)) {
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

// Opção "não medir meu uso" (LGPD: oposição ao tratamento por interesse legítimo). Fica
// só neste navegador; sem acesso ao storage, vale o padrão (medir, sem cookie).
const CHAVE_SEM_METRICAS = 'resenha_sem_metricas'

export function metricasDesligadas() {
  try {
    return localStorage.getItem(CHAVE_SEM_METRICAS) === '1'
  } catch {
    return false
  }
}

export function definirMetricas(ativas) {
  try {
    if (ativas) localStorage.removeItem(CHAVE_SEM_METRICAS)
    else localStorage.setItem(CHAVE_SEM_METRICAS, '1')
  } catch {
    // storage indisponível: só a sessão atual respeita a escolha
  }
  if (!chave) return
  if (ativas) {
    iniciarPosthog()
    if (iniciado) posthog.opt_in_capturing()
  } else if (iniciado) {
    posthog.opt_out_capturing()
    posthog.reset()
  }
}

export function iniciarPosthog() {
  if (!chave || iniciado || metricasDesligadas()) return
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
  if (!iniciado) return
  posthog.identify(String(steamId))
}

export function esquecerJogador() {
  if (!chave || !iniciado) return
  posthog.reset()
}
