// Conexão com a extensão FACEIT (I9). O site pede um token de escopo mínimo
// (POST /api/extensao/token, com o cookie da sessão) e entrega à extensão por
// chrome.runtime.sendMessage. A extensão só aceita a mensagem vinda deste domínio.
// O token nunca vai para log, estado da tela, Sentry ou PostHog.

// shortcut: ID vazio até a 1ª publicação na Chrome Web Store; vazio, o site não pede nem
// entrega token (falha fechada). Trocar pelo ID da loja depois de publicar.
export const EXTENSAO_ID = ''

// Resolve { ok: true } ou { ok: false, motivo: 'indisponivel' | 'sem-extensao' | 'extensao' | 'servidor', mensagem? }.
// Conectado só com ACK { ok: true } da extensão (ela responde depois de guardar o token).
// Sem resposta: sem-extensao. Resposta negativa: extensao (mensagem neutra na tela).
export async function conectarExtensao({
  extensaoId = EXTENSAO_ID,
  runtime = globalThis.chrome?.runtime,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!extensaoId) return { ok: false, motivo: 'indisponivel' }
  // Sem chrome.runtime (outro navegador, ou nenhuma extensão expõe a API): nem pede token.
  if (typeof runtime?.sendMessage !== 'function') return { ok: false, motivo: 'sem-extensao' }

  let token
  try {
    const res = await fetchImpl('/api/extensao/token', { method: 'POST' })
    const corpo = await res.json().catch(() => ({}))
    if (!res.ok) return typeof corpo?.erro === 'string' ? { ok: false, motivo: 'servidor', mensagem: corpo.erro } : { ok: false, motivo: 'servidor' }
    token = corpo?.token
  } catch {
    return { ok: false, motivo: 'servidor' }
  }
  if (typeof token !== 'string' || !token) return { ok: false, motivo: 'servidor' }

  return new Promise((resolve) => {
    try {
      // Só as duas chaves do contrato (T3): campo extra faz a extensão descartar.
      runtime.sendMessage(extensaoId, { tipo: 'resenha-token', token }, (resposta) => {
        if (runtime.lastError || resposta == null) resolve({ ok: false, motivo: 'sem-extensao' })
        else resolve(resposta.ok === true ? { ok: true } : { ok: false, motivo: 'extensao' })
      })
    } catch {
      resolve({ ok: false, motivo: 'sem-extensao' })
    }
  })
}
