// Pedido de clipe de vídeo real ao Allstar (ADR-0004, docs/allstar/) — SOB DEMANDA
// (disparado por clique de um jogador na tela da Partida), restrito a uma allowlist
// de steamId64 até o preço por clipe ser confirmado com o suporte deles.
//
// Descoberta empírica (2026-07-21, dashboard Allstar + sondagem real na API, chave
// RESENHACS): só os use cases POTG e BP estão habilitados na nossa conta (PMH/MH/SH
// devolvem 403 "Failed to find use case"). Schema de cada um (developer.allstar.gg/
// dashboard/api-reference):
// - csPOTGRequestBody: demoUrl, webhookUrl, metadata — SEM steamId, SEM round. Escolhe
//   sozinho a melhor jogada da PARTIDA INTEIRA, de QUALQUER jogador — foi assim que um
//   pedido pro highlight do bronze devolveu o clipe de outro jogador (bug real
//   reportado pelo usuário, confirmado batendo o clipTitle "Dust 2 3K" contra os kills
//   do round pedido: ninguém fez 3K naquele round).
// - csBPRequestBody: demoUrl, steamId, username, webhookUrl, metadata — aceita steamId,
//   então só devolve jogada DAQUELE jogador. Ainda sem controle de round (escolhe a
//   melhor jogada do jogador na partida inteira) — por isso o pedido virou "gerar o
//   melhor clipe da partida pra esse jogador", não mais "gerar o clipe DESSE round".
const URL_CLIP_BP = 'https://prt.allstar.gg/cs/clip/bp'

// Pede o melhor clipe da partida pra um jogador. Devolve o requestId. Propaga qualquer
// erro de rede/API — quem chama decide o que fazer (a rota devolve 502 pro client).
export async function pedirMelhorClipeDoJogador({ apiKey, steamId, nick, demoUrl, webhookUrl, metadata }) {
  const payload = {
    steamId, demoUrl, webhookUrl, username: nick || steamId,
    ...(metadata ? { metadata } : {}),
  }
  const res = await fetch(URL_CLIP_BP, {
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
  if (res.status === 204) {
    throw new Error('Allstar deduplicou o pedido (204, sem requestId)')
  }
  const resp = await res.json()
  const requestId = resp.requestId ?? resp._id
  if (!requestId) throw new Error(`Allstar sem requestId na resposta (chaves: ${Object.keys(resp).join(', ')})`)
  return requestId
}
