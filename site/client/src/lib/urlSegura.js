// Link que vem da API (URL de clipe, link do prêmio…) só vira href se for http(s).
// O servidor já valida na gravação; isto é a segunda barreira contra um `javascript:`
// gravado antes dessa validação existir (XSS armazenado ao clicar).
export function hrefSeguro(url) {
  if (typeof url !== 'string') return undefined
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined
  } catch {
    return undefined
  }
}

// Domínios cujo player pode abrir em iframe na página. O resto vira link.
export const DOMINIOS_IFRAME_CLIPE = ['allstar.gg']

// URL http(s) cujo host é um dos `dominios` por sufixo de domínio (host igual ou
// terminando em ".dominio"), como hostMatchesDomain do server: "allstar.gg.evil.com"
// não passa.
export function hostPermitido(url, dominios) {
  if (!hrefSeguro(url) || !Array.isArray(dominios)) return false
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  return dominios.some((d) => host === d || host.endsWith(`.${d}`))
}
