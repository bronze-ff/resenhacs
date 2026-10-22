import { API_BASE, FACEIT_DEMO_HOSTS, SITE_ORIGIN } from './config.js'
import { filtrarDownload, linkDaPartida } from './filtro.js'

const MENSAGENS = new Set([
  'Link de Demo inválido', 'Partida FACEIT inválida', 'Partida não encontrada no ResenhaCS',
  'Esta partida já tem demo processada', 'Esta partida não aceita envio de demo',
  'Já existe um envio em andamento pra esta partida', 'Limite de envios da extensão atingido. Tente amanhã.',
  'Você já tem 5 demos esperando processamento. Aguarde o Coletor processar antes de enviar mais.',
])
const RECONEXAO = 'Conecte a extensão de novo no site.'
const FALHA = 'Não foi possível enviar a Demo. Tente baixar novamente pelo Watch Demo.'

function esquema(valor, chaves) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor) &&
    Object.keys(valor).length === chaves.length && chaves.every((chave) => Object.hasOwn(valor, chave))
}
function tokenValido(token) { return typeof token === 'string' && token.length > 0 && token.length <= 2048 && !/\s/.test(token) }

export function iniciarBackground(chrome, { fetchFn = globalThis.fetch, hosts = FACEIT_DEMO_HOSTS, agora = () => new Date().toISOString() } = {}) {
  let fila = Promise.resolve()
  const serializar = (tarefa) => {
    const proxima = fila.then(tarefa)
    fila = proxima.catch(() => {})
    return proxima
  }
  const falhaLocal = () => console.warn('Não foi possível atualizar a extensão.')
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(falhaLocal)
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(falhaLocal)

  async function badge(novos) {
    await chrome.action.setBadgeBackgroundColor({ color: '#ff6a1a' })
    await chrome.action.setBadgeText({ text: novos > 99 ? '99+' : novos ? String(novos) : '' })
  }

  async function registrar(faceitMatchId, estado, mensagem, matchId) {
    const salvo = await chrome.storage.local.get(['historico', 'novos'])
    const item = { data: agora(), estado, mensagem }
    if (faceitMatchId) item.faceitMatchId = faceitMatchId
    if (linkDaPartida(matchId)) item.matchId = matchId
    const novos = (salvo.novos || 0) + (estado === 'enviado' ? 1 : 0)
    await chrome.storage.local.set({ historico: [item, ...(salvo.historico || [])].slice(0, 20), novos })
    await badge(novos)
  }

  async function post(caminho, token, dados) {
    const resposta = await fetchFn(`${API_BASE}/${caminho}`, {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(dados ? { body: JSON.stringify(dados) } : {}), signal: AbortSignal.timeout(15000),
    })
    return { status: resposta.status, corpo: await resposta.json().catch(() => null) }
  }

  async function processar(id, dados) {
    const { downloadIds = [] } = await chrome.storage.session.get('downloadIds')
    if (downloadIds.includes(id)) return
    // Marca antes da rede: eventos repetidos e reinício do worker nunca reenviam o id.
    await chrome.storage.session.set({ downloadIds: [...downloadIds, id] })
    const { faceitMatchId } = dados
    if (!faceitMatchId) return registrar(null, 'erro', 'Não reconheci a Partida desse download.')
    const { token } = await chrome.storage.local.get('token')
    if (!tokenValido(token)) return registrar(faceitMatchId, 'erro', 'Conecte a extensão no site para enviar a Demo.')
    try {
      const renovacao = await post('renovar', token)
      if (renovacao.status === 401) {
        await chrome.storage.local.remove('token')
        return registrar(faceitMatchId, 'erro', RECONEXAO)
      }
      if (renovacao.status !== 200 || !tokenValido(renovacao.corpo?.token)) return registrar(faceitMatchId, 'erro', FALHA)
      await chrome.storage.local.set({ token: renovacao.corpo.token })
      const envio = await post('envio', renovacao.corpo.token, dados)
      if (envio.status === 401) {
        await chrome.storage.local.remove('token')
        return registrar(faceitMatchId, 'erro', RECONEXAO)
      }
      if (envio.status === 202) {
        return registrar(faceitMatchId, 'enviado', 'Demo enviada ao ResenhaCS.', envio.corpo?.matchId)
      }
      const mensagem = MENSAGENS.has(envio.corpo?.erro) ? envio.corpo.erro : FALHA
      const estado = envio.status === 404 ? 'Partida não encontrada'
        : envio.status === 409 && mensagem === 'Esta partida já tem demo processada' ? 'já tinha Demo'
          : envio.status === 409 && mensagem === 'Já existe um envio em andamento pra esta partida' ? 'envio em andamento' : 'erro'
      // Só mensagens contratadas entram no histórico; o server nunca pode ecoar o link.
      return registrar(faceitMatchId, estado, mensagem, envio.corpo?.matchId)
    } catch {
      return registrar(faceitMatchId, 'erro', FALHA)
    }
  }

  function criado(item) {
    const dados = filtrarDownload(item, hosts)
    if (!dados || !Number.isSafeInteger(item.id) || item.id < 0) return Promise.resolve()
    return serializar(() => processar(item.id, dados)).catch(falhaLocal)
  }
  chrome.downloads.onCreated.addListener(criado)
  chrome.downloads.onChanged.addListener(async (delta) => {
    if (!Number.isSafeInteger(delta.id) || (!delta.finalUrl && !delta.filename && !delta.url && delta.state?.current !== 'complete')) return
    try {
      const [item] = await chrome.downloads.search({ id: delta.id })
      if (item) await criado(item)
    } catch { falhaLocal() }
  })

  async function estado() {
    const salvo = await chrome.storage.local.get(['token', 'historico', 'novos'])
    return { conectada: tokenValido(salvo.token), historico: salvo.historico || [], novos: salvo.novos || 0 }
  }
  function responder(tarefa, resposta) {
    serializar(tarefa).then(resposta).catch(() => resposta({ erro: 'Não foi possível atualizar a extensão. Tente novamente.' }))
    return true
  }
  chrome.runtime.onMessageExternal.addListener((mensagem, sender, resposta) => {
    if (sender.origin !== SITE_ORIGIN || !esquema(mensagem, ['tipo', 'token']) || mensagem.tipo !== 'resenha-token' || !tokenValido(mensagem.token)) return false
    return responder(async () => {
      await chrome.storage.local.set({ token: mensagem.token, historico: [], novos: 0 })
      await badge(0)
      return { ok: true }
    }, resposta)
  })
  chrome.runtime.onMessage.addListener((mensagem, sender, resposta) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup/popup.html') ||
      !esquema(mensagem, ['tipo']) || !['resenha-estado', 'resenha-historico-lido', 'resenha-desconectar'].includes(mensagem.tipo)) return false
    return responder(async () => {
      if (mensagem.tipo === 'resenha-desconectar') {
        await chrome.storage.local.remove(['token', 'historico', 'novos'])
        await badge(0)
      } else if (mensagem.tipo === 'resenha-historico-lido') {
        await chrome.storage.local.set({ novos: 0 })
        await badge(0)
      }
      return estado()
    }, resposta)
  })
}

if (globalThis.chrome?.downloads) iniciarBackground(globalThis.chrome)
