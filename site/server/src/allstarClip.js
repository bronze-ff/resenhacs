// Pedido de clipe de vídeo real ao Allstar (ADR-0004, docs/allstar/) — SOB DEMANDA
// (disparado por clique de um jogador na tela da Partida), restrito a uma allowlist
// de steamId64 até o preço por clipe ser confirmado com o suporte deles.
//
// Endpoint confirmado por sondagem real na API (2026-07-20, chave RESENHACS):
// - GET  https://prt.allstar.gg/cs/clips           -> 200 (base SEM /api; o exemplo
//   "POST /api/clip_request" do Getting Started devolve 404 "resource not available")
// - POST https://prt.allstar.gg/cs/clip/potg       -> 400 MISSING REQUIRED BODY com
//   corpo vazio e 201 {requestId} com {steamId, demoUrl} — rota existe e o use case
//   POTG está habilitado na conta.
// - POST https://prt.allstar.gg/cs/clip/mh         -> 403 "Failed to find use case
//   for your API Key" — MH NÃO está habilitado na conta (era a causa raiz do 502
//   original). TODO: quando o Allstar habilitar MH (multi-kill), mapear ace/quad/
//   triple pra /cs/clip/mh em vez de tudo cair em POTG.
const URL_CLIP = 'https://prt.allstar.gg/cs/clip/potg'

// Pede um clipe pro highlight. Devolve o requestId. Propaga qualquer erro de rede/API
// — quem chama decide o que fazer (a rota devolve 502 pro client).
export async function pedirClipe({ apiKey, steamId, nick, demoUrl, roundNumber, webhookUrl, metadata }) {
  const payload = {
    steamId, demoUrl, webhookUrl, rounds: [roundNumber], username: nick || steamId,
    ...(metadata ? { metadata } : {}),
  }
  const res = await fetch(URL_CLIP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const texto = await res.text().catch(() => '')
    throw new Error(`Allstar respondeu ${res.status}: ${texto.slice(0, 200)}`)
  }
  // 204 = dedupe do lado deles (mesmo steamId+demoUrl já pedido), sem corpo — não
  // há requestId pra correlacionar o webhook, então tratamos como erro explícito.
  // Na prática não deve acontecer: a URL assinada do R2 muda a cada pedido.
  if (res.status === 204) {
    throw new Error('Allstar deduplicou o pedido (204, sem requestId)')
  }
  const resp = await res.json()
  const requestId = resp.requestId ?? resp._id
  if (!requestId) throw new Error(`Allstar sem requestId na resposta (chaves: ${Object.keys(resp).join(', ')})`)
  return requestId
}
