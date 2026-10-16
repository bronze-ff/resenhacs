// Cliente da API pública da DEMO-SLAP (https://api-doc.demo-slap.net, v2.5.0): grava
// clipe de VÍDEO REAL do CS2 a partir da Demo, num tick escolhido e na visão de um
// jogador. É o que a Allstar não faz (a API de parceiro dela só escolhe "a melhor
// jogada" sozinha, sem round/kill — ver allstarClip.js).
//
// Fluxo: analyze/url (1x por Partida) → render-custom com [{tick, duration, povSteamId}]
// → render/{analyze}/status até `done` → (montagem) render-fragmovie → URLs assinadas.
// Os ids são de espaços diferentes; ver o glossário no topo da doc deles.
const BASE = 'https://api.demo-slap.net/public-api'

export class ErroDemoSlap extends Error {
  constructor(status, mensagem) {
    super(`DEMO-SLAP respondeu ${status}: ${mensagem}`)
    this.status = status
    // Texto da própria DEMO-SLAP (ex.: "Not enough credits", tick fora do round).
    // Não traz dado pessoal; pode ir pro Jogador.
    this.mensagem = mensagem
  }
}

async function chamar(apiKey, metodo, caminho, corpo) {
  const res = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { 'x-api-key': apiKey, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  })
  if (!res.ok) {
    const texto = await res.text().catch(() => '')
    let mensagem = texto.slice(0, 200)
    try { mensagem = JSON.parse(texto).message ?? mensagem } catch { /* corpo não-JSON */ }
    throw new ErroDemoSlap(res.status, mensagem)
  }
  return res.json()
}

export function criarClienteDemoSlap(apiKey) {
  const enc = encodeURIComponent
  return {
    analisar: async (url) => (await chamar(apiKey, 'POST', '/analyze/url', { url })).jobId,
    statusAnalise: (jobId) => chamar(apiKey, 'GET', `/analyze/${enc(jobId)}/status`),
    dadosAnalise: (jobId) => chamar(apiKey, 'GET', `/analyze/${enc(jobId)}/data`),
    renderizar: async (jobId, customClips, opcoes = {}) =>
      (await chamar(apiKey, 'POST', `/render-custom/${enc(jobId)}`, { ...opcoes, customClips })).jobIds ?? [],
    statusRender: (jobId) => chamar(apiKey, 'GET', `/render/${enc(jobId)}/status`),
    dadosRender: (jobId) => chamar(apiKey, 'GET', `/render/${enc(jobId)}/data`),
    juntar: async (jobId, videoJobIds, introTitle) =>
      (await chamar(apiKey, 'POST', `/render-fragmovie/${enc(jobId)}`, { videoJobIds, introTitle, name: introTitle })).jobId,
    statusMontagem: (id) => chamar(apiKey, 'GET', `/render-fragmovie/${enc(id)}/status`),
    dadosMontagem: (id) => chamar(apiKey, 'GET', `/render-fragmovie/${enc(id)}/data`),
  }
}

// Janela de cada clipe em torno da kill. Uma kill sozinha ganha mais contexto;
// numa montagem cada trecho é curto pra o vídeo não ficar arrastado.
export const JANELA = {
  sozinha: { antes: 4, depois: 3 },
  montagem: { antes: 3, depois: 2 },
}

// Monta o customClips da DEMO-SLAP: começa `antes` segundos antes da kill e dura
// antes+depois. O tick nunca fica negativo.
export function montarClipes(kills, tickRate) {
  const janela = kills.length > 1 ? JANELA.montagem : JANELA.sozinha
  const taxa = tickRate > 0 ? tickRate : 64
  return kills.map((k) => ({
    tick: Math.max(0, Math.round(k.tick - janela.antes * taxa)),
    duration: janela.antes + janela.depois,
    povSteamId: k.pov,
  }))
}

// Resume o mapa {videoJobId: {status, errorMessage}} só pros ids deste clipe.
export function resumirStatusRender(mapa, ids) {
  const itens = ids.map((id) => mapa?.[id])
  const erro = itens.find((i) => i?.status === 'error')
  if (erro) return { status: 'error', erro: erro.errorMessage || 'Falha ao gravar o clipe' }
  if (itens.length > 0 && itens.every((i) => i?.status === 'done')) return { status: 'done' }
  return { status: 'working' }
}
