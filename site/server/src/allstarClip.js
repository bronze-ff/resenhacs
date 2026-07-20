// Pedido de clipe de vídeo real ao Allstar (ADR-0004, docs/allstar/) — SOB DEMANDA
// (disparado por clique de um jogador na tela da Partida), restrito a uma allowlist
// de steamId64 até o preço por clipe ser confirmado com o suporte deles.
//
// Endpoint único /api/clip_request com `useCase` no corpo — é o ÚNICO exemplo
// completo e confirmado na doc oficial (Getting Started); os endpoints por use case
// (/cs/clip/potg, /cs/clip/mh etc.) vieram de uma leitura menos confiável do Swagger
// e devolveram 404 "resource not available" no teste real — não usar até confirmar.
const URL_CLIP_REQUEST = 'https://prt.allstar.gg/api/clip_request'

// kind de highlight (coletor/src/coletor/transform.py: MULTIKILL_KIND / f"clutch_1v{vs}")
// -> useCase do Allstar. Multi-kill/ace usa "MH" (Multi-kill Highlight); qualquer
// outra coisa (clutch etc.) usa "POTG" (melhor jogada).
const USE_CASE_POR_KIND = { ace: 'MH', quad: 'MH', triple: 'MH' }
const USE_CASE_PADRAO = 'POTG'

export function useCaseParaKind(kind) {
  return USE_CASE_POR_KIND[kind] ?? USE_CASE_PADRAO
}

// Pede um clipe pro highlight. Devolve o requestId. Propaga qualquer erro de rede/API
// — quem chama decide o que fazer (a rota devolve 502 pro client).
export async function pedirClipe({ apiKey, kind, steamId, nick, demoUrl, roundNumber, webhookUrl, metadata }) {
  const payload = {
    steamId, demoUrl, webhookUrl, rounds: [roundNumber], username: nick || steamId,
    useCase: useCaseParaKind(kind),
    ...(metadata ? { metadata } : {}),
  }
  const res = await fetch(URL_CLIP_REQUEST, {
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
