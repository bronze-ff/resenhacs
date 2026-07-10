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

// Verde/vermelho/neutro para rating estilo HLTV.
export function corRating(rating) {
  if (rating == null) return 'text-texto-fraco'
  if (rating >= 1.15) return 'text-emerald-400'
  if (rating <= 0.85) return 'text-rose-400'
  return 'text-texto'
}
