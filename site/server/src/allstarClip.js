// Pedido de clipe de vídeo real ao Allstar (ADR-0004, docs/allstar/) — SOB DEMANDA
// (disparado por clique de um jogador na tela da Partida), restrito a uma allowlist
// de steamId64 até o preço por clipe ser confirmado com o suporte deles.

const BASE = 'https://prt.allstar.gg/cs'

// kind de highlight (coletor/src/coletor/transform.py: MULTIKILL_KIND / f"clutch_1v{vs}")
// -> endpoint do Allstar (Swagger da conta de parceiro RESENHACS, ver ADR-0004). Multi-
// kill/ace usa "mh" (Multi-kill Highlight); qualquer outra coisa (clutch etc.) usa
// "potg" (melhor jogada) — cobre os dois use cases que a doc confirma sem ambiguidade.
const ENDPOINT_POR_KIND = { ace: 'mh', quad: 'mh', triple: 'mh' }
const ENDPOINT_PADRAO = 'potg'

export function endpointParaKind(kind) {
  return ENDPOINT_POR_KIND[kind] ?? ENDPOINT_PADRAO
}

// Pede um clipe pro highlight. Devolve o requestId. Propaga qualquer erro de rede/API
// — quem chama decide o que fazer (a rota devolve 502 pro client).
export async function pedirClipe({ apiKey, kind, steamId, nick, demoUrl, roundNumber, webhookUrl, metadata }) {
  const endpoint = endpointParaKind(kind)
  const payload = {
    steamId, demoUrl, webhookUrl, rounds: [roundNumber], username: nick || steamId,
    ...(metadata ? { metadata } : {}),
  }
  const res = await fetch(`${BASE}/clip/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const texto = await res.text().catch(() => '')
    throw new Error(`Allstar respondeu ${res.status}: ${texto.slice(0, 200)}`)
  }
  const resp = await res.json()
  const requestId = resp.requestId ?? resp._id
  if (!requestId) throw new Error(`Allstar sem requestId na resposta (chaves: ${Object.keys(resp).join(', ')})`)
  return requestId
}
