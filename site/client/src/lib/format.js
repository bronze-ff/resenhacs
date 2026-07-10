export function nomeMapa(map) {
  if (!map) return 'Mapa desconhecido'
  const limpo = map.replace(/^de_/, '')
  return limpo.charAt(0).toUpperCase() + limpo.slice(1)
}

export function dataRelativa(iso) {
  if (!iso) return 'data desconhecida'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'data desconhecida'
  const diff = Date.now() - d.getTime()
  const dias = Math.floor(diff / 86400000)
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'ontem'
  if (dias < 30) return `há ${dias} dias`
  return d.toLocaleDateString('pt-BR')
}

// Data/hora absoluta no fuso do navegador (ex.: "08/07/2026 21:04") — pedido do grupo:
// "ontem" relativo engana perto da virada do dia; played_at no banco é UTC.
export function dataHora(iso) {
  if (!iso) return 'data desconhecida'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'data desconhecida'
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

// Tag de origem da Partida: baixada pelo bot (valve_mm) ou enviada manualmente (upload).
export function origemPartida(source) {
  return source === 'upload'
    ? { label: 'MANUAL', title: 'Demo enviada manualmente' }
    : { label: 'AUTO', title: 'Baixada automaticamente pelo Coletor' }
}

// Verde/vermelho/neutro para rating estilo HLTV.
export function corRating(rating) {
  if (rating == null) return 'text-texto-fraco'
  if (rating >= 1.15) return 'text-emerald-400'
  if (rating <= 0.85) return 'text-rose-400'
  return 'text-texto'
}
