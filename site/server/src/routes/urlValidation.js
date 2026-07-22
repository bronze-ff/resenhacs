// Validação de URL compartilhada entre clips.js (URL que o Jogador cola) e allstar.js
// (URL que o próprio Allstar manda de volta no webhook) — extraída pra cá pra não
// duplicar a mesma checagem de protocolo/host em dois lugares (finding #5).
export function parseHttpUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // Só http(s): uma URL javascript:/data: parseia sem erro e o client renderiza href
  // direto — seria XSS armazenado clicável.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  return parsed
}

// Compara host por sufixo de domínio (host === dominio OU host termina em ".dominio"),
// nunca substring solta — "allstar.gg.evil.com" não pode colar como se fosse allstar.gg.
export function hostMatchesDomain(host, dominio) {
  const h = host.replace(/^www\./, '')
  return h === dominio || h.endsWith(`.${dominio}`)
}
