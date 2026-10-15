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
