import { FACEIT_DEMO_HOSTS } from '../src/config.js'
import { linkDaPartida } from '../src/filtro.js'

export function renderizarHistorico(document, historico) {
  const lista = document.getElementById('historico')
  lista.replaceChildren()
  document.getElementById('vazio').hidden = historico.length > 0
  for (const tentativa of historico) {
    const item = document.createElement('li')
    const estado = document.createElement('strong')
    estado.textContent = tentativa.estado
    const data = document.createElement('time')
    const instante = new Date(tentativa.data)
    data.textContent = Number.isNaN(instante.getTime()) ? 'Data indisponível' : instante.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    if (!Number.isNaN(instante.getTime())) data.dateTime = instante.toISOString()
    const mensagem = document.createElement('p')
    mensagem.textContent = tentativa.mensagem
    item.append(estado, data, mensagem)
    const href = linkDaPartida(tentativa.matchId)
    if (href) {
      const link = document.createElement('a')
      link.href = href
      link.textContent = 'Ver Partida'
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      item.append(link)
    }
    lista.append(item)
  }
}

export function iniciarPopup(document, chrome) {
  const conteudo = document.getElementById('conteudo')
  const conexao = document.getElementById('conexao')
  const conectar = document.getElementById('conectar')
  const desconectar = document.getElementById('desconectar')
  const feedback = document.getElementById('feedback')
  document.getElementById('preparacao').hidden = FACEIT_DEMO_HOSTS.length > 0

  async function atualizar(tipo = 'resenha-estado') {
    conteudo.setAttribute('aria-busy', 'true')
    feedback.hidden = true
    try {
      const estado = await chrome.runtime.sendMessage({ tipo })
      if (!estado || typeof estado.conectada !== 'boolean' || !Array.isArray(estado.historico)) throw new Error('Estado indisponível')
      conexao.textContent = estado.conectada ? 'Conectada ao ResenhaCS' : 'Conecte sua conta para enviar Demos'
      conectar.hidden = estado.conectada
      desconectar.hidden = !estado.conectada
      renderizarHistorico(document, estado.historico)
      if (tipo === 'resenha-desconectar') conectar.focus()
    } catch {
      conexao.textContent = 'Não foi possível consultar a conexão'
      feedback.textContent = 'Feche e abra a extensão para tentar novamente. Você também pode conectar pelo site.'
      feedback.hidden = false
    } finally {
      conteudo.setAttribute('aria-busy', 'false')
    }
  }
  desconectar.addEventListener('click', async () => {
    desconectar.disabled = true
    await atualizar('resenha-desconectar')
    desconectar.disabled = false
  })
  chrome.storage.onChanged.addListener((alteracoes, area) => {
    if (area === 'local' && (alteracoes.token || alteracoes.historico)) void atualizar()
  })
  return atualizar('resenha-historico-lido')
}

if (typeof document !== 'undefined' && globalThis.chrome?.runtime) void iniciarPopup(document, globalThis.chrome)
